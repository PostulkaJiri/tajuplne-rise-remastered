#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import mimetypes
import statistics
import time
import urllib.error
import urllib.request
from pathlib import Path


def summarize(results: list[dict]) -> dict:
    successful = [item for item in results if "error" not in item]
    expected = sum(len(item["expected"]) for item in successful)
    correct = sum(len(item["correct"]) for item in successful)
    false_negatives = sum(len(item["falseNegatives"]) for item in successful)
    false_positives = sum(len(item["falsePositives"]) for item in successful)
    times = sorted(item["processingMs"] for item in successful)
    return {
        "imagesTested": len(successful),
        "imagesFailed": len(results) - len(successful),
        "expectedCards": expected,
        "correctDetections": correct,
        "falseNegatives": false_negatives,
        "falsePositives": false_positives,
        "recall": correct / expected if expected else None,
        "precision": correct / (correct + false_positives) if correct + false_positives else None,
        "averageProcessingMs": statistics.mean(times) if times else None,
        "p95ProcessingMs": times[math.ceil(len(times) * 0.95) - 1] if times else None,
    }


def evaluate_case(case: dict, payload: dict, round_trip_ms: float) -> dict:
    expected = set(case["expected"])
    detected = {item["name"] for item in payload.get("cards", []) if item.get("accepted") is True}
    return {
        "image": case["image"],
        "expected": sorted(expected),
        "detected": sorted(detected),
        "correct": sorted(expected & detected),
        "falseNegatives": sorted(expected - detected),
        "falsePositives": sorted(detected - expected),
        "processingMs": float(payload["processingMs"]),
        "roundTripMs": round(round_trip_ms, 1),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sequential, local OCR fixture evaluation (no image uploads outside the supplied API).")
    parser.add_argument("--api", default="http://192.168.0.249:18080/api/v1/scan")
    parser.add_argument("--fixtures", default=str(Path(__file__).resolve().parents[1] / "tests" / "fixtures"))
    parser.add_argument("--output", type=Path, help="Write names, metrics and missing filenames as JSON; never image bytes.")
    args = parser.parse_args(argv)
    fixture_dir = Path(args.fixtures)
    truth = json.loads((fixture_dir / "ground_truth.json").read_text(encoding="utf-8"))
    results, missing_files = [], []
    for case in truth:
        image_path = fixture_dir / "scans" / case["image"]
        if not image_path.is_file():
            missing_files.append(case["image"])
            continue
        started = time.perf_counter()
        try:
            request = urllib.request.Request(
                args.api + ("&" if "?" in args.api else "?") + "debug=true",
                data=image_path.read_bytes(),
                headers={"Content-Type": mimetypes.guess_type(image_path.name)[0] or "image/jpeg"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=120) as response:
                payload = json.load(response)
            result = evaluate_case(case, payload, (time.perf_counter() - started) * 1000)
        except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as error:
            result = {"image": case["image"], "expected": case["expected"], "error": str(error)}
        results.append(result)
        print(json.dumps(result, ensure_ascii=False))
    summary = summarize(results)
    report = {"summary": summary, "results": results, "missingImages": missing_files}
    if missing_files:
        print("test fixtures missing:", ", ".join(missing_files))
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if args.output:
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not summary["imagesTested"] or summary["imagesFailed"]:
        return 2
    if missing_files or summary["falsePositives"] or any(
        len(item["expected"]) == 7 and len(item["correct"]) < 6 for item in results
    ):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
