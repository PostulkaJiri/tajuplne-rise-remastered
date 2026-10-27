from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from importlib.metadata import version
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .ocr_service import OcrService
from .settings import settings

BASE_DIR = Path(__file__).resolve().parent
CARDS_PATH = BASE_DIR / "cards.json"
STATIC_DIR = BASE_DIR.parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    cv2.setNumThreads(settings.cpu_threads)
    app.state.scan_lock = asyncio.Lock()
    app.state.ocr = OcrService(settings=settings, cards_path=CARDS_PATH)
    yield


app = FastAPI(title="Tajuplné říše OCR API", version="1.0.0", lifespan=lifespan)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )


@app.middleware("http")
async def cache_policy(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    elif request.url.path in {"/", "/index.html", "/service-worker.js", "/manifest.webmanifest"}:
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/api/v1/health")
async def health() -> dict[str, object]:
    return {
        "ok": True,
        "ocr": "PaddleOCR",
        "lang": settings.ocr_lang,
        "ocrVersion": settings.ocr_version,
        "detectionModel": settings.detection_model,
        "recognitionModel": settings.recognition_model,
        "paddleocrVersion": version("paddleocr"),
        "paddlepaddleVersion": version("paddlepaddle"),
        "device": settings.paddle_device,
        "cpuThreads": settings.cpu_threads,
        "rotations": settings.rotations,
    }


@app.get("/api/v1/cards")
async def cards() -> JSONResponse:
    return JSONResponse(content=[
        {"id": card.id, "name": card.name}
        for card in app.state.ocr.matcher.cards
    ])


@app.post("/api/v1/scan")
async def scan(request: Request, debug: bool = Query(default=False)) -> JSONResponse:
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type not in {"image/jpeg", "image/jpg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="Send raw JPEG, PNG or WebP image bytes.")

    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            length = int(content_length)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid Content-Length.")
        if length < 0:
            raise HTTPException(status_code=400, detail="Invalid Content-Length.")
        if length > settings.max_image_bytes:
            raise HTTPException(status_code=413, detail="Image is too large.")

    # One Paddle predictor is shared by all clients. Reject stale frames instead
    # of queuing concurrent inference or allocating multiple decoded images.
    if app.state.scan_lock.locked():
        raise HTTPException(status_code=429, detail="Scanner is busy. Send a fresh frame later.", headers={"Retry-After": "1"})
    async with app.state.scan_lock:
        body = bytearray()
        try:
            async with asyncio.timeout(15):
                async for chunk in request.stream():
                    if len(body) + len(chunk) > settings.max_image_bytes:
                        raise HTTPException(status_code=413, detail="Image is too large.")
                    body.extend(chunk)
        except TimeoutError:
            raise HTTPException(status_code=408, detail="Image upload timed out.")
        if not body:
            raise HTTPException(status_code=400, detail="Empty image body.")
        try:
            image = cv2.imdecode(np.frombuffer(body, dtype=np.uint8), cv2.IMREAD_COLOR)
        except cv2.error:
            image = None
        if image is None:
            raise HTTPException(status_code=400, detail="Image could not be decoded.")
        result = await run_in_threadpool(app.state.ocr.scan, image, debug)
        if not result["cards"]:
            saved = await run_in_threadpool(app.state.ocr.save_failed_debug, image)
            if debug and saved:
                result.setdefault("debug", {})["savedAs"] = saved
        return JSONResponse(content=result)


@app.get("/", include_in_schema=False)
@app.get("/index.html", include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/manifest.webmanifest", include_in_schema=False)
async def manifest() -> FileResponse:
    return FileResponse(STATIC_DIR / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/service-worker.js", include_in_schema=False)
async def service_worker() -> FileResponse:
    return FileResponse(STATIC_DIR / "service-worker.js", media_type="application/javascript")


for directory in ("js", "css", "icons"):
    app.mount(f"/{directory}", StaticFiles(directory=STATIC_DIR / directory, check_dir=False), name=directory)
