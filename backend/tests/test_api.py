from dataclasses import replace
import threading
from concurrent.futures import ThreadPoolExecutor

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
            self.owner_thread = threading.get_native_id()

        def scan(self, image, debug):
            assert threading.get_native_id() == self.owner_thread
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


def test_predictor_stays_on_its_creating_thread_across_requests(client):
    _, image = cv2.imencode('.jpg', np.full((32,32,3),255,dtype=np.uint8))
    def send():
        return client.post('/api/v1/scan',content=image.tobytes(),headers={'Content-Type':'image/jpeg'})
    for _ in range(3):
        # Distinct callers and intervening general-pool I/O must never move
        # the native predictor. FakeOcr asserts affinity on every scan.
        with ThreadPoolExecutor(max_workers=1) as caller:
            assert caller.submit(send).result(timeout=3).status_code == 200
        assert client.get('/card-images/FR99.webp').status_code == 404


def test_health_responds_during_inference_and_concurrent_scan_is_rejected(client, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    original_scan = main.app.state.ocr.scan
    def slow_scan(image, debug):
        entered.set()
        assert release.wait(timeout=3)
        return original_scan(image,debug)
    monkeypatch.setattr(main.app.state.ocr,'scan',slow_scan)
    _, image = cv2.imencode('.jpg',np.full((32,32,3),255,dtype=np.uint8))
    def send():
        return client.post('/api/v1/scan',content=image.tobytes(),headers={'Content-Type':'image/jpeg'})
    with ThreadPoolExecutor(max_workers=1) as caller:
        first = caller.submit(send)
        try:
            assert entered.wait(timeout=2)
            assert client.get('/api/v1/health').status_code == 200
            assert send().status_code == 429
        finally:
            release.set()
        assert first.result(timeout=3).status_code == 200


def test_capture_original_and_ocr_input_are_saved_privately(client, monkeypatch, tmp_path):
    from app.captures import CaptureStore
    main.app.state.captures = CaptureStore(tmp_path/'captures',True,10_000_000,minimum_free_bytes=0)
    ok, image = cv2.imencode('.jpg',np.full((40,40,3),220,dtype=np.uint8))
    assert ok
    response = client.post('/api/v1/captures',content=image.tobytes(),headers={'Content-Type':'image/jpeg'})
    assert response.status_code == 200 and response.json()['stored']
    capture_id = response.json()['id']
    assert (tmp_path/'captures'/(capture_id+'.jpg')).read_bytes()==image.tobytes()
    scanned = client.post('/api/v1/scan?source=photo&capture_id='+capture_id,content=image.tobytes(),headers={'Content-Type':'image/jpeg'})
    assert scanned.status_code==200 and scanned.json()['capture']['stored']
    assert client.get('/captures/'+capture_id+'.jpg').status_code==404
    assert client.get('/card-images/FR99.webp').status_code==404


def test_capture_failure_is_reported_without_breaking_ocr(client, tmp_path):
    from app.captures import CaptureStore
    main.app.state.captures = CaptureStore(tmp_path/'captures',True,1,minimum_free_bytes=0)
    ok,image = cv2.imencode('.jpg',np.full((32,32,3),200,dtype=np.uint8))
    response = client.post('/api/v1/scan',content=image.tobytes(),headers={'Content-Type':'image/jpeg'})
    assert response.status_code==200
    assert response.json()['capture']['stored'] is False
    assert response.json()['capture']['error']=='quota'
    assert client.post('/api/v1/captures',content=image.tobytes(),headers={'Content-Type':'image/jpeg'}).status_code==507


def test_capture_formats_limits_and_links(client, monkeypatch):
    assert client.post('/api/v1/captures',content=b'bad',headers={'Content-Type':'text/plain'}).status_code==415
    assert client.post('/api/v1/captures',content=b'bad',headers={'Content-Type':'image/jpeg'}).status_code==400
    monkeypatch.setattr(main,'settings',replace(main.settings,max_original_bytes=16))
    assert client.post('/api/v1/captures',content=b'x'*17,headers={'Content-Type':'image/jpeg'}).status_code==413
    assert client.post('/api/v1/scan?capture_id=../../etc/passwd',content=b'x',headers={'Content-Type':'image/jpeg'}).status_code==422


def test_failed_ocr_input_is_still_kept(client, monkeypatch, tmp_path):
    from app.captures import CaptureStore
    main.app.state.captures = CaptureStore(tmp_path/'captures',True,10_000_000,minimum_free_bytes=0)
    def fail(image,debug):raise RuntimeError('predictor failed')
    monkeypatch.setattr(main.app.state.ocr,'scan',fail)
    ok,image=cv2.imencode('.jpg',np.full((32,32,3),220,dtype=np.uint8))
    with pytest.raises(RuntimeError):client.post('/api/v1/scan',content=image.tobytes(),headers={'Content-Type':'image/jpeg'})
    assert len(list((tmp_path/'captures').glob('*.jpg')))==1
