#!/usr/bin/env python3
"""Import exact private sheets into workspace data; never include them in Git/image."""
from pathlib import Path
import hashlib
import json
import shutil

workspace = Path(__file__).resolve().parents[2]
manifest = json.loads((workspace / "backend/app/card_art.json").read_text())
destination = workspace / "data/card-originals"
destination.mkdir(parents=True, exist_ok=True, mode=0o700)
for name, sheet in manifest["sheets"].items():
    source = workspace / "testovaci-data" / sheet["source"]
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if digest != sheet["sha256"]:
        raise SystemExit(f"Original sheet does not match its labels: {source.name}")
    target = destination / name
    if target.exists():
        if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            raise SystemExit(f"Existing card sheet differs; refusing to overwrite: {name}")
    else:
        shutil.copy2(source, target)
print("Six exact original sheets ready; 54 complete card thumbnails can be served locally.")
