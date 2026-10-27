#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import requests


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://localhost:8080/api/v1/scan")
    parser.add_argument("--fixtures", default=str(Path(__file__).resolve().parents[1] / "tests" / "fixtures"))
    args = parser.parse_args()

    fixture_dir = Path(args.fixtures)
    truth = json.loads((fixture_dir / "ground_truth.json").read_text(encoding="utf-8"))
    scan_dir = fixture_dir / "scans"

    expected_total = 0
    correct_total = 0
    false_positive_total = 0
    missing_files = []

    for case in truth:
        image_path = scan_dir / case["image"]
        if not image_path.exists():
            missing_files.append(case["image"])
            continue

        expected = set(case["expected"])
        expected_total += len(expected)
        data = image_path.read_bytes()
        response = requests.post(
            args.api,
            params={"debug": "true"},
            data=data,
            headers={"Content-Type": "image/jpeg"},
            timeout=120,
        )
        response.raise_for_status()
        payload = response.json()
        detected = {item["name"] for item in payload.get("cards", [])}

        correct = expected & detected
        false_positive = detected - expected
        false_negative = expected - detected
        correct_total += len(correct)
        false_positive_total += len(false_positive)

        print(f"\n{case['image']}")
        print("  detected:", ", ".join(sorted(detected)) or "-")
        print("  missed:  ", ", ".join(sorted(false_negative)) or "-")
        print("  false+:  ", ", ".join(sorted(false_positive)) or "-")

    if missing_files:
        print("\nMissing fixture images:")
        for name in missing_files:
            print(" -", name)

    if expected_total:
        recall = 100.0 * correct_total / expected_total
        precision_den = correct_total + false_positive_total
        precision = 100.0 * correct_total / precision_den if precision_den else 100.0
        print("\nSummary")
        print(f"Expected cards: {expected_total}")
        print(f"Detected correctly: {correct_total}")
        print(f"False positives: {false_positive_total}")
        print(f"Recall: {recall:.1f}%")
        print(f"Precision: {precision:.1f}%")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
