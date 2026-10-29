from __future__ import annotations

import hashlib
import io
import json
from functools import lru_cache
from pathlib import Path

from PIL import Image


class CardArt:
    def __init__(self, root: Path, manifest_path: Path) -> None:
        self.root = root
        self.manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    @lru_cache(maxsize=54)
    def thumbnail(self, card_id: str) -> tuple[bytes, str]:
        card = self.manifest["cards"].get(card_id)
        if card is None:
            raise KeyError(card_id)
        with Image.open(self.root / card["sheet"]) as sheet:
            x, y = card["column"], card["row"]
            # Printed sheets have unequal card widths/heights. Boundaries are
            # measured in the white gutters to preserve every card's frame.
            layout = self.manifest["sheets"][card["sheet"]]
            xs, ys = layout["xCuts"], layout["yCuts"]
            image = sheet.crop((xs[x], ys[y], xs[x+1], ys[y+1])).convert("RGB")
            image.thumbnail((320, 454), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            image.save(output, format="WEBP", quality=88, method=4)
        data = output.getvalue()
        return data, '"' + hashlib.sha256(data).hexdigest() + '"'
