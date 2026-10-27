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


def test_every_complete_dictionary_title_is_accepted():
    m = matcher()
    for card in m.cards:
        match = m.match(card.name)
        assert match.card.id == card.id
        assert match.accepted, card.name


def test_shared_title_fragments_remain_candidates():
    m = matcher()
    for fragment in ("Elementál", "Kethský"):
        match = m.match(fragment)
        assert match is None or not match.accepted, fragment


def test_very_high_but_ambiguous_scores_do_not_bypass_margin(tmp_path):
    cards = tmp_path / "cards.json"
    cards.write_text('[{"id":"FR01","name":"abcdefghijx"},{"id":"FR02","name":"abcdefghijy"}]')
    m = CardMatcher(cards, 78, 92, 7, 58)
    match = m.match("abcdefghij")
    assert match.score > 92
    assert match.margin == 0
    assert not match.accepted


def test_close_complete_titles_keep_their_identity():
    m = matcher()
    for title, card_id in (("Král", "FR31"), ("Královna", "FR32"),
                           ("Kethský meč", "FR43"), ("Kethský štít", "FR46"),
                           ("Elementál země", "FR05"), ("Elementál vody", "FR10"),
                           ("Elementál vzduchu", "FR15"), ("Elementál ohně", "FR20")):
        match = m.match(title)
        assert match.card.id == card_id
        assert match.accepted
