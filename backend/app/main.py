from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .ocr_service import OcrService
from .settings import settings


BASE_DIR = Path(__file__).resolve().parent
CARDS_PATH = BASE_DIR / "cards.json"


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.ocr = OcrService(settings=settings, cards_path=CARDS_PATH)
    yield


app = FastAPI(
    title="Tajuplné říše OCR API",
    version="1.0.0",
    lifespan=lifespan,
)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )


@app.get("/api/v1/health")
async def health() -> dict[str, object]:
    return {
        "ok": True,
        "ocr": "PaddleOCR",
        "lang": settings.ocr_lang,
        "ocrVersion": settings.ocr_version,
        "rotations": settings.rotations,
    }


@app.get("/api/v1/cards")
async def cards() -> JSONResponse:
    return JSONResponse(content=app.state.ocr.matcher.cards and [
        {"id": card.id, "name": card.name}
        for card in app.state.ocr.matcher.cards
    ])


@app.post("/api/v1/scan")
async def scan(
    request: Request,
    debug: bool = Query(default=False),
) -> JSONResponse:
    content_type = request.headers.get("content-type", "").split(";", 1)[0].lower()
    if content_type not in {"image/jpeg", "image/jpg", "image/png", "image/webp", "application/octet-stream"}:
        raise HTTPException(status_code=415, detail="Send raw JPEG, PNG or WebP image bytes.")

    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Empty image body.")
    if len(body) > settings.max_image_bytes:
        raise HTTPException(status_code=413, detail="Image is too large.")

    encoded = np.frombuffer(body, dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="Image could not be decoded.")

    result = await run_in_threadpool(app.state.ocr.scan, image, debug)
    if not result["cards"]:
        saved = await run_in_threadpool(app.state.ocr.save_failed_debug, image)
        if debug and saved:
            result.setdefault("debug", {})["savedAs"] = saved

    return JSONResponse(content=result)
