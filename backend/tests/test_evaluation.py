import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "evaluate_fixtures.py"
spec = importlib.util.spec_from_file_location("evaluate_fixtures", SCRIPT)
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


def test_metrics_count_misses_false_positives_and_candidates():
    result = evaluation.evaluate_case(
        {"image": "scan.jpeg", "expected": ["Král", "Královna"]},
        {"processingMs": 200, "cards": [
            {"name": "Král", "accepted": True},
            {"name": "Drak", "accepted": True},
            {"name": "Královna", "accepted": False},
        ], "candidates": [{"name": "Královna"}]},
        220,
    )
    assert result["falseNegatives"] == ["Královna"]
    assert result["falsePositives"] == ["Drak"]
    summary = evaluation.summarize([result])
    assert summary["recall"] == 0.5
    assert summary["precision"] == 0.5
    assert summary["p95ProcessingMs"] == 200


def test_missing_images_do_not_claim_perfect_metrics():
    summary = evaluation.summarize([])
    assert summary["imagesTested"] == 0
    assert summary["recall"] is None
    assert summary["precision"] is None
    assert summary["averageProcessingMs"] is None


def test_failed_request_is_reported_separately():
    summary = evaluation.summarize([{"error": "timeout"}])
    assert summary["imagesFailed"] == 1
    assert summary["imagesTested"] == 0
