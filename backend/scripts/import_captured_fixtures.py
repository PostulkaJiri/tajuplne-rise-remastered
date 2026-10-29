#!/usr/bin/env python3
"""Copy only independently labelled archive photos into private regression fixtures."""
import hashlib
import json
import shutil
from pathlib import Path

workspace = Path(__file__).resolve().parents[2]
fixtures = workspace / "backend/tests/fixtures"
truth = json.loads((fixtures / "ground_truth.json").read_text(encoding="utf-8"))
destination = fixtures / "scans/captures"
destination.mkdir(parents=True, exist_ok=True, mode=0o700)
count = 0
for case in truth:
    if case.get("group") != "capture":
        continue
    name = Path(case["image"]).name
    if case["image"] != "captures/" + name or name != case["sha256"] + ".jpg":
        raise SystemExit("Unexpected captured-fixture filename; refusing to import.")
    source = workspace / "data/captures" / name
    if hashlib.sha256(source.read_bytes()).hexdigest() != case["sha256"]:
        raise SystemExit(f"Captured photograph differs from its manual labels: {name}")
    target = destination / name
    if target.exists():
        if hashlib.sha256(target.read_bytes()).hexdigest() != case["sha256"]:
            raise SystemExit(f"Existing fixture differs; refusing to overwrite: {name}")
    else:
        shutil.copy2(source, target)
    count += 1
print(f"{count} manually labelled photographs ready; private image bytes remain outside Git/image.")
