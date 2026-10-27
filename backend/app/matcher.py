from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from rapidfuzz import fuzz


def normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFD", value or "")
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    value = value.lower()
    value = value.replace("0", "o").replace("1", "l")
    value = re.sub(r"[^a-z]+", "", value)
    return value


@dataclass(frozen=True)
class Card:
    id: str
    name: str
    normalized: str


@dataclass(frozen=True)
class Match:
    card: Card
    score: float
    second_score: float
    margin: float
    accepted: bool


class CardMatcher:
    def __init__(
        self,
        cards_path: str | Path,
        accept_score: float,
        high_score: float,
        min_margin: float,
        candidate_min_score: float,
    ) -> None:
        raw = json.loads(Path(cards_path).read_text(encoding="utf-8"))
        self.cards = [
            Card(id=item["id"], name=item["name"], normalized=normalize_text(item["name"]))
            for item in raw
        ]
        self.accept_score = accept_score
        self.high_score = high_score
        self.min_margin = min_margin
        self.candidate_min_score = candidate_min_score

    @staticmethod
    def _score(cleaned: str, title: str) -> float:
        if not cleaned or not title:
            return 0.0
        # Compare the complete title. Partial matching scores a shared word
        # (e.g. "Elementál") highly against multiple different cards.
        return float(fuzz.ratio(cleaned, title))

    def match(self, text: str) -> Match | None:
        cleaned = normalize_text(text)
        if len(cleaned) < 3:
            return None

        ranked = sorted(
            ((self._score(cleaned, card.normalized), card) for card in self.cards),
            key=lambda item: item[0],
            reverse=True,
        )
        if not ranked:
            return None

        best_score, best = ranked[0]
        second_score = ranked[1][0] if len(ranked) > 1 else 0.0
        margin = best_score - second_score

        length_delta = abs(len(cleaned) - len(best.normalized))
        length_ok = length_delta <= max(4, round(len(best.normalized) * 0.40))
        accepted = (
            margin >= self.min_margin
            and length_ok
            and (best_score >= self.high_score or best_score >= self.accept_score)
        )

        if best_score < self.candidate_min_score:
            return None

        return Match(
            card=best,
            score=best_score,
            second_score=second_score,
            margin=margin,
            accepted=accepted,
        )
