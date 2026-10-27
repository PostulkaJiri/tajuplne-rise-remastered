#!/usr/bin/env python3
"""Run inside the project container: synthetic checks, never photo acceptance metrics."""
import json
import urllib.request

import cv2
import numpy as np

image = np.full((720, 1280, 3), 240, dtype=np.uint8)
cv2.rectangle(image, (80, 80), (1180, 240), (40, 40, 40), -1)
cv2.putText(image, "Kralovna", (160, 190), cv2.FONT_HERSHEY_SIMPLEX, 2.5, (255, 255, 255), 4, cv2.LINE_AA)
cv2.putText(image, "Drak", (160, 580), cv2.FONT_HERSHEY_SIMPLEX, 2, (20, 20, 20), 3, cv2.LINE_AA)
ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 80])
assert ok
runs = []
for index in range(3):
    request = urllib.request.Request(
        "http://127.0.0.1:8000/api/v1/scan?debug=true",
        data=encoded.tobytes(), headers={"Content-Type": "image/jpeg"}, method="POST",
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        result = json.load(response)
    assert {item["id"] for item in result["cards"]} == {"FR32"}, result
    assert any("drak" in item["text"].lower() for item in result["debug"]["rawTexts"]), result
    runs.append({"pass": index + 1, **result})
print(json.dumps({"kind": "synthetic smoke; not real photograph acceptance", "imageSize": [1280, 720], "jpegQuality": 80, "payloadBytes": encoded.size, "runs": runs}, ensure_ascii=False, indent=2))
