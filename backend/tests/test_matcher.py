from pathlib import Path

from app.matcher import CardMatcher, normalize_text


CARDS = Path(__file__).resolve().parents[1] / "app" / "cards.json"


def matcher() -> CardMatcher:
    return CardMatcher(
        cards_path=CARDS,
        accept_score=78,
        high_score=92,
        min_margin=7,
        candidate_min_score=58,
    )


def test_normalization_removes_diacritics_and_noise():
    assert normalize_text("  KrÁl0vna! ") == "kralovna"


def test_clear_title_matches():
    m = matcher()
    assert m.match("Královna").card.id == "FR32"
    assert m.match("Kniha proměn").card.id == "FR49"
    assert m.match("Sněhová vánice").card.id == "FR12"


def test_common_ocr_errors_still_match():
    m = matcher()
    result = m.match("KraIovna")
    assert result is not None
    assert result.card.id == "FR32"


def test_king_does_not_silently_become_queen():
    m = matcher()
    result = m.match("Král")
    assert result is not None
    assert result.card.id == "FR31"
