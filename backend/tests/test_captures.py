import json
from pathlib import Path
from app.captures import CaptureStore


def test_images_are_preserved_exactly_deduplicated_and_survive_reopen(tmp_path):
    store = CaptureStore(tmp_path, True, 10_000_000, minimum_free_bytes=0)
    data = b'original photograph bytes'
    first = store.save(data, 'image/jpeg', 'photo-original')
    assert first['stored'] and not first['duplicate']
    image = tmp_path / (first['id']+'.jpg')
    assert image.read_bytes() == data
    modified = image.stat().st_mtime_ns
    second = store.save(data, 'image/jpeg', 'photo-original')
    assert second['id'] == first['id'] and second['duplicate']
    assert image.stat().st_mtime_ns == modified
    reopened = CaptureStore(tmp_path, True, 10_000_000, minimum_free_bytes=0)
    assert reopened.save(data, 'image/jpeg', 'photo-original')['duplicate']
    assert len(list(tmp_path.glob('*.jpg'))) == 1


def test_ocr_input_links_to_original_without_becoming_ground_truth(tmp_path):
    store = CaptureStore(tmp_path, True, 10_000_000, minimum_free_bytes=0)
    original = store.save(b'full resolution', 'image/png', 'photo-original')
    result = {'processingMs':100,'cards':[{'id':'FR01'}],'candidates':[]}
    processed = store.save(b'compressed input', 'image/jpeg', 'photo', result, original['id'])
    metadata = json.loads((tmp_path/(processed['id']+'.json')).read_text())
    assert metadata['originalCaptureId'] == original['id']
    assert metadata['ocr'] == result
    assert metadata['labelsAreOcrPredictions'] is True


def test_quota_stops_saving_without_deleting_existing_data(tmp_path):
    store = CaptureStore(tmp_path, True, 10_000_000, minimum_free_bytes=0)
    first = store.save(b'first photo','image/jpeg','live')
    store.max_bytes = store.used_bytes
    rejected = store.save(b'second photo','image/jpeg','live')
    assert rejected['stored'] is False and rejected['error'] == 'quota'
    assert (tmp_path/(first['id']+'.jpg')).read_bytes() == b'first photo'
    assert len(list(tmp_path.glob('*.jpg'))) == 1


def test_disabled_capture_store_does_not_create_files(tmp_path):
    root = tmp_path/'disabled'
    assert CaptureStore(root,False,1000).save(b'photo','image/jpeg','live')['enabled'] is False
    assert not root.exists()
