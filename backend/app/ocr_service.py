from __future__ import annotations

import json
import math
import os
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from paddleocr import PaddleOCR

from .matcher import CardMatcher
from .settings import Settings


def _rotate_bound(image: np.ndarray, angle: float) -> tuple[np.ndarray, np.ndarray]:
    h, w = image.shape[:2]
    if abs(angle) < 0.001:
        identity = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]], dtype=np.float32)
        return image, identity

    center = (w / 2.0, h / 2.0)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    cos = abs(matrix[0, 0])
    sin = abs(matrix[0, 1])
    new_w = int(math.ceil(h * sin + w * cos))
    new_h = int(math.ceil(h * cos + w * sin))
    matrix[0, 2] += new_w / 2.0 - center[0]
    matrix[1, 2] += new_h / 2.0 - center[1]

    rotated = cv2.warpAffine(
        image,
        matrix,
        (new_w, new_h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(255, 255, 255),
    )
    return rotated, cv2.invertAffineTransform(matrix)


def _map_polygon(poly: np.ndarray, inverse: np.ndarray) -> np.ndarray:
    points = np.asarray(poly, dtype=np.float32).reshape(-1, 2)
    ones = np.ones((points.shape[0], 1), dtype=np.float32)
    homogeneous = np.hstack([points, ones])
    return homogeneous @ inverse.T


def _payload(result: Any) -> dict[str, Any]:
    payload = getattr(result, "json", None)
    if callable(payload):
        payload = payload()
    if isinstance(payload, str):
        payload = json.loads(payload)
    if not isinstance(payload, dict):
        return {}

    if isinstance(payload.get("res"), dict):
        payload = payload["res"]
    if isinstance(payload.get("overall_ocr_res"), dict):
        payload = payload["overall_ocr_res"]
    return payload


def _records(result: Any) -> list[tuple[str, float, np.ndarray]]:
    payload = _payload(result)
    texts = list(payload.get("rec_texts") or [])
    scores = list(payload.get("rec_scores") or [])
    polys = payload.get("rec_polys")

    if polys is None:
        boxes = payload.get("rec_boxes")
        if boxes is not None:
            polys = []
            for x0, y0, x1, y1 in np.asarray(boxes).reshape(-1, 4):
                polys.append([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])

    if polys is None:
        polys = []

    output: list[tuple[str, float, np.ndarray]] = []
    for index, text in enumerate(texts):
        if index >= len(polys):
            break
        score = float(scores[index]) if index < len(scores) else 0.0
        output.append((str(text), score, np.asarray(polys[index], dtype=np.float32)))
    return output


def _title_style_score(image: np.ndarray, poly: np.ndarray) -> float:
    """Estimate whether OCR text lies on the dark title banner.

    Identity must come only from the title. Rules text is dark on a cream panel,
    while titles use light lettering on a dark coloured banner. We therefore
    inspect the neighbourhood around the OCR polygon, not card artwork/content.
    """
    h, w = image.shape[:2]
    pts = np.asarray(poly, dtype=np.float32).reshape(-1, 2)
    x0, y0 = pts.min(axis=0)
    x1, y1 = pts.max(axis=0)
    box_h = max(2.0, y1 - y0)
    box_w = max(2.0, x1 - x0)

    pad_x = box_w * 0.12
    pad_y = box_h * 0.70
    ix0 = max(0, int(x0 - pad_x))
    iy0 = max(0, int(y0 - pad_y))
    ix1 = min(w, int(x1 + pad_x))
    iy1 = min(h, int(y1 + pad_y))
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0

    roi = image[iy0:iy1, ix0:ix1]
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    median = float(np.median(gray))
    dark_fraction = float(np.mean(gray < 175))
    very_dark_fraction = float(np.mean(gray < 120))

    darkness = max(0.0, min(1.0, (205.0 - median) / 135.0))
    score = 0.45 * darkness + 0.40 * dark_fraction + 0.15 * very_dark_fraction
    return max(0.0, min(1.0, score))


def _normalized_box(poly: np.ndarray, width: int, height: int) -> dict[str, float]:
    pts = np.asarray(poly, dtype=np.float32).reshape(-1, 2)
    x0, y0 = pts.min(axis=0)
    x1, y1 = pts.max(axis=0)
    x0 = float(np.clip(x0, 0, width))
    x1 = float(np.clip(x1, 0, width))
    y0 = float(np.clip(y0, 0, height))
    y1 = float(np.clip(y1, 0, height))
    return {
        "x0": x0 / width,
        "y0": y0 / height,
        "x1": x1 / width,
        "y1": y1 / height,
    }


class OcrService:
    def __init__(self, settings: Settings, cards_path: str | Path) -> None:
        self.settings = settings
        self.matcher = CardMatcher(
            cards_path=cards_path,
            accept_score=settings.match_accept_score,
            high_score=settings.match_high_score,
            min_margin=settings.match_min_margin,
            candidate_min_score=settings.candidate_min_score,
        )

        self.ocr = PaddleOCR(
            lang=settings.ocr_lang,
            ocr_version=settings.ocr_version,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=True,
            device=settings.paddle_device,
            enable_mkldnn=settings.paddle_device == "cpu",
            cpu_threads=settings.cpu_threads,
        )

    def scan(self, image: np.ndarray, debug: bool = False) -> dict[str, Any]:
        started = time.perf_counter()
        original_h, original_w = image.shape[:2]
        accepted_by_id: dict[str, dict[str, Any]] = {}
        candidates: list[dict[str, Any]] = []
        raw_debug: list[dict[str, Any]] = []

        for angle in self.settings.rotations:
            rotated, inverse = _rotate_bound(image, angle)
            results = self.ocr.predict(rotated)

            for result in results:
                for text, ocr_score, poly in _records(result):
                    match = self.matcher.match(text)
                    title_style = _title_style_score(rotated, poly)
                    original_poly = _map_polygon(poly, inverse)
                    box = _normalized_box(original_poly, original_w, original_h)

                    if debug:
                        raw_debug.append(
                            {
                                "text": text,
                                "ocrConfidence": round(ocr_score, 4),
                                "titleConfidence": round(title_style, 4),
                                "rotation": angle,
                                "box": box,
                            }
                        )

                    if match is None:
                        continue

                    match_conf = match.score / 100.0
                    combined = (
                        0.60 * match_conf
                        + 0.22 * max(0.0, min(1.0, ocr_score))
                        + 0.18 * title_style
                    )
                    accepted = (
                        match.accepted
                        and ocr_score >= self.settings.min_ocr_score
                        and title_style >= self.settings.min_title_style
                    )

                    item = {
                        "id": match.card.id,
                        "name": match.card.name,
                        "ocrText": text,
                        "ocrConfidence": round(float(ocr_score), 4),
                        "matchConfidence": round(match_conf, 4),
                        "secondMatchConfidence": round(match.second_score / 100.0, 4),
                        "matchMargin": round(match.margin / 100.0, 4),
                        "titleConfidence": round(title_style, 4),
                        "combinedConfidence": round(combined, 4),
                        "box": box,
                        "rotation": angle,
                        "accepted": accepted,
                    }

                    if accepted:
                        current = accepted_by_id.get(match.card.id)
                        if current is None or item["combinedConfidence"] > current["combinedConfidence"]:
                            accepted_by_id[match.card.id] = item
                    else:
                        # Do not clutter the live overlay with fuzzy matches found
                        # in the cream rules panel. Candidates still need to look
                        # at least somewhat like title-band text.
                        if (
                            ocr_score >= max(0.20, self.settings.min_ocr_score * 0.65)
                            and title_style >= self.settings.min_title_style * 0.50
                        ):
                            candidates.append(item)

        cards = sorted(
            accepted_by_id.values(),
            key=lambda item: item["combinedConfidence"],
            reverse=True,
        )

        accepted_ids = set(accepted_by_id)
        candidates = [
            item for item in sorted(
                candidates,
                key=lambda item: item["combinedConfidence"],
                reverse=True,
            )
            if item["id"] not in accepted_ids
        ][:12]

        response: dict[str, Any] = {
            "processingMs": round((time.perf_counter() - started) * 1000),
            "cards": cards,
            "candidates": candidates,
        }
        if debug:
            response["debug"] = {
                "rotations": list(self.settings.rotations),
                "rawTexts": raw_debug,
            }
        return response

    def save_failed_debug(self, image: np.ndarray) -> str | None:
        if not self.settings.debug_save_failed_scans:
            return None
        Path(self.settings.debug_dir).mkdir(parents=True, exist_ok=True)
        path = Path(self.settings.debug_dir) / f"failed-{int(time.time() * 1000)}.jpg"
        cv2.imwrite(str(path), image)
        return str(path)
