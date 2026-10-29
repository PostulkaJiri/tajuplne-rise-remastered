from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from functools import partial
from importlib.metadata import version
from pathlib import Path
from typing import Literal

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .card_art import CardArt
from .captures import CaptureStore, EXTENSIONS
from .ocr_service import OcrService
from .settings import settings

BASE_DIR = Path(__file__).resolve().parent
CARDS_PATH = BASE_DIR / "cards.json"
STATIC_DIR = BASE_DIR.parent / "static"


async def run_in_ocr_thread(app: FastAPI, function, *args, **kwargs):
    # Paddle/oneDNN predictors must stay on their creating thread. AnyIO's
    # general pool retires idle workers and cannot guarantee that affinity.
    future = asyncio.get_running_loop().run_in_executor(
        app.state.ocr_executor, partial(function, *args, **kwargs),
    )
    try:
        return await asyncio.shield(future)
    except asyncio.CancelledError:
        # Keep scan_lock held until native inference really finishes, even if
        # the request is cancelled. A stale scan must not queue another frame.
        await asyncio.shield(future)
        raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    cv2.setNumThreads(settings.cpu_threads)
    app.state.scan_lock = asyncio.Lock()
    app.state.card_art = CardArt(Path(settings.card_art_dir), BASE_DIR / "card_art.json")
    app.state.captures = CaptureStore(Path(settings.capture_dir), settings.save_captured_images, settings.capture_max_bytes)
    app.state.ocr_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="paddle-ocr")
    try:
        app.state.ocr = await run_in_ocr_thread(app, OcrService, settings=settings, cards_path=CARDS_PATH)
        yield
    finally:
        # Release the predictor on the same thread before joining its worker.
        await run_in_ocr_thread(app, setattr, app.state, "ocr", None)
        app.state.ocr_executor.shutdown(wait=True, cancel_futures=True)


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
        "detectionMaxSide": settings.detection_max_side,
        "detectionBoxThreshold": settings.detection_box_threshold,
        "titlePrefilter": settings.title_prefilter,
        "paddleocrVersion": version("paddleocr"),
        "paddlepaddleVersion": version("paddlepaddle"),
        "device": settings.paddle_device,
        "cpuThreads": settings.cpu_threads,
        "rotations": settings.rotations,
        "saveCapturedImages": settings.save_captured_images,
    }


@app.get("/api/v1/cards")
async def cards() -> JSONResponse:
    return JSONResponse(content=[
        {"id": card.id, "name": card.name}
        for card in app.state.ocr.matcher.cards
    ])


async def read_image_body(request: Request, maximum: int) -> bytes:
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            length = int(content_length)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid Content-Length.")
        if length < 0:
            raise HTTPException(status_code=400, detail="Invalid Content-Length.")
        if length > maximum:
            raise HTTPException(status_code=413, detail="Image is too large.")
    body = bytearray()
    try:
        async with asyncio.timeout(15):
            async for chunk in request.stream():
                if len(body) + len(chunk) > maximum:
                    raise HTTPException(status_code=413, detail="Image is too large.")
                body.extend(chunk)
    except TimeoutError:
        raise HTTPException(status_code=408, detail="Image upload timed out.")
    if not body:
        raise HTTPException(status_code=400, detail="Empty image body.")
    return bytes(body)


@app.get("/card-images/{card_id}.webp", include_in_schema=False)
async def card_image(card_id: str, request: Request) -> Response:
    try:
        data, etag = await run_in_threadpool(app.state.card_art.thumbnail, card_id)
    except (KeyError, FileNotFoundError):
        raise HTTPException(status_code=404, detail="Card image is unavailable.")
    headers = {"Cache-Control":"private, max-age=86400", "ETag":etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(content=data, media_type="image/webp", headers=headers)


@app.post("/api/v1/captures")
async def capture_original(request: Request) -> JSONResponse:
    content_type = request.headers.get("content-type", "").split(";",1)[0].strip().lower()
    if content_type not in EXTENSIONS:
        raise HTTPException(status_code=415, detail="Unsupported photograph format.")
    body = await read_image_body(request, settings.max_original_bytes)
    signatures = {"image/jpeg":b"\xff\xd8", "image/jpg":b"\xff\xd8", "image/png":b"\x89PNG\r\n\x1a\n"}
    if content_type in signatures and not body.startswith(signatures[content_type]):
        raise HTTPException(status_code=400, detail="Invalid photograph.")
    if content_type == "image/webp" and not (body[:4] == b"RIFF" and body[8:12] == b"WEBP"):
        raise HTTPException(status_code=400, detail="Invalid photograph.")
    if content_type in {"image/heic","image/heif"} and body[4:8] != b"ftyp":
        raise HTTPException(status_code=400, detail="Invalid photograph.")
    saved = await run_in_threadpool(app.state.captures.save, body, content_type, "photo-original")
    return JSONResponse(content=saved, status_code=200 if saved.get("stored") or not saved.get("enabled") else 507)


@app.post("/api/v1/scan")
async def scan(request: Request, debug: bool = Query(default=False),
               source: Literal["live", "photo", "test"] = "live",
               capture_id: str | None = Query(default=None, pattern=r"^[a-f0-9]{64}$")) -> JSONResponse:
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type not in {"image/jpeg", "image/jpg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="Send raw JPEG, PNG or WebP image bytes.")

    # One Paddle predictor is shared by all clients. Reject stale frames instead
    # of queuing concurrent inference or allocating multiple decoded images.
    if app.state.scan_lock.locked():
        raise HTTPException(status_code=429, detail="Scanner is busy. Send a fresh frame later.", headers={"Retry-After": "1"})
    async with app.state.scan_lock:
        body = await read_image_body(request, settings.max_image_bytes)
        try:
            image = cv2.imdecode(np.frombuffer(body, dtype=np.uint8), cv2.IMREAD_COLOR)
        except cv2.error:
            image = None
        if image is None:
            raise HTTPException(status_code=400, detail="Image could not be decoded.")
        try:
            result = await run_in_ocr_thread(app, app.state.ocr.scan, image, debug)
        except Exception:
            await run_in_threadpool(app.state.captures.save, body, content_type, source,
                                    {"processingMs":0, "cards":[], "candidates":[], "error":"ocr_failed"}, capture_id)
            raise
        result["capture"] = await run_in_threadpool(app.state.captures.save, body, content_type, source, result, capture_id)
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
