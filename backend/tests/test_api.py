from dataclasses import replace

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import main
from app.matcher import CardMatcher


@pytest.fixture
def client(monkeypatch, tmp_path):
    class FakeOcr:
        def __init__(self, settings, cards_path):
            self.matcher = CardMatcher(cards_path, 78, 92, 7, 58)

        def scan(self, image, debug):
            return {"processingMs": 1, "cards": [], "candidates": []}

        def save_failed_debug(self, image):
            return None

    monkeypatch.setattr(main, "OcrService", FakeOcr)
    monkeypatch.setattr(main, "STATIC_DIR", tmp_path)
    (tmp_path / "index.html").write_text("<html>Scorer</html>")
    (tmp_path / "service-worker.js").write_text("// worker")
    (tmp_path / "manifest.webmanifest").write_text('{"name":"Scorer"}')
    with TestClient(main.app) as client:
        yield client


def test_health_and_all_54_cards(client):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert response.headers["cache-control"] == "no-store"
    cards = client.get("/api/v1/cards").json()
    assert [card["id"] for card in cards] == [f"FR{i:02d}" for i in range(1, 55)]


@pytest.mark.parametrize("path", ["/", "/index.html", "/service-worker.js", "/manifest.webmanifest"])
def test_pwa_entrypoints_revalidate(client, path):
    response = client.get(path)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-cache"


def test_invalid_and_empty_images(client):
    assert client.post("/api/v1/scan", content=b"bad", headers={"Content-Type": "text/plain"}).status_code == 415
    assert client.post("/api/v1/scan", content=b"bad", headers={"Content-Type": "image/jpeg"}).status_code == 400
    assert client.post("/api/v1/scan", content=b"", headers={"Content-Type": "image/jpeg"}).status_code == 400


def test_streamed_upload_is_limited(client, monkeypatch):
    monkeypatch.setattr(main, "settings", replace(main.settings, max_image_bytes=16))
    chunks = iter([b"a" * 10, b"b" * 10])
    response = client.post("/api/v1/scan", content=chunks, headers={"Content-Type": "image/jpeg"})
    assert response.status_code == 413


def test_known_oversized_upload_rejected_before_decode(client, monkeypatch):
    monkeypatch.setattr(main, "settings", replace(main.settings, max_image_bytes=16))
    assert client.post("/api/v1/scan", content=b"x" * 17, headers={"Content-Type": "image/jpeg"}).status_code == 413


def test_busy_scan_is_not_queued_and_health_still_works(client):
    client.portal.call(main.app.state.scan_lock.acquire)
    try:
        response = client.post("/api/v1/scan", content=b"image", headers={"Content-Type": "image/jpeg"})
        assert response.status_code == 429
        assert response.headers["retry-after"] == "1"
        assert client.get("/api/v1/health").status_code == 200
    finally:
        client.portal.call(main.app.state.scan_lock.release)


def test_valid_image_uses_scanner(client):
    ok, data = cv2.imencode(".jpg", np.full((32, 32, 3), 255, dtype=np.uint8))
    assert ok
    response = client.post("/api/v1/scan", content=data.tobytes(), headers={"Content-Type": "image/jpeg"})
    assert response.status_code == 200
    assert response.json()["cards"] == []
