from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

EXTENSIONS = {"image/jpeg":".jpg", "image/jpg":".jpg", "image/png":".png",
              "image/webp":".webp", "image/heic":".heic", "image/heif":".heif"}
SCHEMA = "tajuplne-rise.capture.v1"


class CaptureStore:
    def __init__(self, root: Path, enabled: bool, max_bytes: int,
                 minimum_free_bytes: int = 2_000_000_000) -> None:
        self.root, self.enabled, self.max_bytes = root, enabled, max_bytes
        self.minimum_free_bytes = minimum_free_bytes
        self.lock = threading.Lock()
        self.records: dict[str, dict[str, Any]] = {}
        self.used_bytes = 0
        if enabled:
            root.mkdir(parents=True, exist_ok=True)
            self.used_bytes = sum(p.stat().st_size for p in root.iterdir() if p.is_file())
            for path in root.glob("*.json"):
                try:
                    record = json.loads(path.read_text(encoding="utf-8"))
                    expected_file = path.stem + EXTENSIONS.get(record.get("contentType"), "")
                    if (record.get("schema") == SCHEMA and record.get("id") == path.stem
                            and re.fullmatch(r"[a-f0-9]{64}", path.stem)
                            and record.get("file") == expected_file):
                        self.records[path.stem] = {"file": expected_file}
                except (ValueError, OSError):
                    continue

    def save(self, data: bytes, content_type: str, source: str,
             result: dict | None = None, parent_id: str | None = None) -> dict:
        if not self.enabled:
            return {"enabled":False, "stored":False}
        digest = hashlib.sha256(data).hexdigest()
        now = datetime.now(timezone.utc).isoformat()
        with self.lock:
            try:
                previous = self.records.get(digest)
                # Keep only a small index in RAM as the dataset grows. Full OCR
                # metadata is read on duplicate updates, never retained globally.
                record = json.loads((self.root/(digest+".json")).read_text()) if previous else {
                    "schema":SCHEMA, "id":digest, "createdAt":now, "source":source,
                    "contentType":content_type, "bytes":len(data),
                    "file":digest + EXTENSIONS[content_type],
                }
                record.update(lastSeenAt=now, observations=record.get("observations",0)+1)
                if parent_id != digest and parent_id in self.records:
                    record["originalCaptureId"] = parent_id
                if result is not None:
                    record["ocr"] = {key:result[key] for key in ("processingMs","cards","candidates")}
                    if "error" in result:
                        record["ocr"]["error"] = result["error"]
                    record["labelsAreOcrPredictions"] = True
                metadata = (json.dumps(record,ensure_ascii=False,indent=2)+"\n").encode()
                meta_path = self.root / (digest+".json")
                old_size = meta_path.stat().st_size if previous else 0
                added = (0 if previous else len(data)) + len(metadata) - old_size
                if self.used_bytes + added > self.max_bytes:
                    return {"enabled":True, "stored":False, "error":"quota"}
                if shutil.disk_usage(self.root).free < self.minimum_free_bytes + max(added,0):
                    return {"enabled":True, "stored":False, "error":"disk_space"}
                image_path = self.root / record["file"]
                if not previous:
                    if image_path.exists() or meta_path.exists():
                        return {"enabled":True, "stored":False, "error":"file_conflict"}
                    with image_path.open("xb") as output:
                        output.write(data)
                    self.used_bytes += len(data)
                temporary = self.root / (digest+"."+uuid.uuid4().hex+".tmp")
                with temporary.open("xb") as output:
                    output.write(metadata)
                os.replace(temporary, meta_path)
                self.records[digest] = {"file": record["file"]}
                self.used_bytes += len(metadata) - old_size
                return {"enabled":True, "stored":True, "id":digest, "duplicate":previous is not None}
            except OSError:
                return {"enabled":True, "stored":False, "error":"write_failed"}
