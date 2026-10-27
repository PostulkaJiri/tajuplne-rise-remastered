from __future__ import annotations

import os
from dataclasses import dataclass


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _rotations() -> tuple[float, ...]:
    raw = os.getenv("SCAN_ROTATIONS", "0,-15")
    values: list[float] = []
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        try:
            values.append(float(item))
        except ValueError:
            continue
    return tuple(values or [0.0])


@dataclass(frozen=True)
class Settings:
    ocr_lang: str = os.getenv("PADDLE_OCR_LANG", "cs")
    ocr_version: str = os.getenv("PADDLE_OCR_VERSION", "PP-OCRv5")
    detection_model: str = os.getenv("PADDLE_DETECTION_MODEL", "PP-OCRv5_mobile_det")
    recognition_model: str = os.getenv("PADDLE_RECOGNITION_MODEL", "latin_PP-OCRv5_mobile_rec")
    paddle_device: str = os.getenv("PADDLE_DEVICE", "cpu")
    detection_max_side: int = _env_int("PADDLE_DETECTION_MAX_SIDE", 960)
    detection_box_threshold: float = _env_float("PADDLE_DETECTION_BOX_THRESHOLD", 0.50)
    cpu_threads: int = _env_int("PADDLE_CPU_THREADS", 2)
    rotations: tuple[float, ...] = _rotations()

    match_accept_score: float = _env_float("MATCH_ACCEPT_SCORE", 78.0)
    match_high_score: float = _env_float("MATCH_HIGH_SCORE", 92.0)
    match_min_margin: float = _env_float("MATCH_MIN_MARGIN", 7.0)
    candidate_min_score: float = _env_float("CANDIDATE_MIN_SCORE", 58.0)

    min_ocr_score: float = _env_float("MIN_OCR_SCORE", 0.32)
    title_prefilter: bool = _env_bool("TITLE_PREFILTER", True)
    min_title_style: float = _env_float("MIN_TITLE_STYLE", 0.30)

    max_image_bytes: int = _env_int("MAX_IMAGE_BYTES", 8_000_000)
    save_captured_images: bool = _env_bool("SAVE_CAPTURED_IMAGES", False)
    capture_dir: str = os.getenv("CAPTURE_DIR", "/app/captures")
    capture_max_bytes: int = _env_int("CAPTURE_STORAGE_MAX_BYTES", 5_000_000_000)
    max_original_bytes: int = _env_int("MAX_ORIGINAL_PHOTO_BYTES", 25_000_000)
    card_art_dir: str = os.getenv("CARD_ART_DIR", "/app/card-originals")
    debug_save_failed_scans: bool = _env_bool("DEBUG_SAVE_FAILED_SCANS", False)
    debug_dir: str = os.getenv("DEBUG_SCAN_DIR", "/tmp/tajuplne-rise-scans")
    cors_origins: tuple[str, ...] = tuple(
        x.strip() for x in os.getenv("CORS_ORIGINS", "").split(",") if x.strip()
    )


settings = Settings()
