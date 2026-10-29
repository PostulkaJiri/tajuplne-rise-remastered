import io
import json
from pathlib import Path

import pytest
from PIL import Image
from app.card_art import CardArt


def test_manifest_covers_every_card_exactly_once():
    manifest = json.loads((Path(__file__).resolve().parents[1]/'app/card_art.json').read_text())
    assert set(manifest['cards']) == {f'FR{i:02d}' for i in range(1,55)}
    positions = {(v['sheet'],v['column'],v['row']) for v in manifest['cards'].values()}
    assert len(positions) == 54
    for layout in manifest['sheets'].values():
        assert len(layout['xCuts']) == len(layout['yCuts']) == 4
        assert layout['xCuts'] == sorted(set(layout['xCuts']))
        assert layout['yCuts'] == sorted(set(layout['yCuts']))


def test_thumbnail_includes_the_entire_card_without_adjacent_cards(tmp_path):
    sheet = Image.new('RGB',(300,450),'black')
    sheet.paste((240,20,20),(70,130,180,290))
    sheet.save(tmp_path/'sheet.png')
    manifest = tmp_path/'layout.json'
    manifest.write_text(json.dumps({'columns':3,'rows':3,
        'sheets':{'sheet.png':{'xCuts':[0,70,180,300],'yCuts':[0,130,290,450]}},
        'cards':{'FR01':{'sheet':'sheet.png','column':1,'row':1}}}))
    art = CardArt(tmp_path,manifest)
    data,etag = art.thumbnail('FR01')
    with Image.open(io.BytesIO(data)) as thumbnail:
        assert thumbnail.size == (110,160)
        for point in [(0,0),(109,0),(0,159),(109,159),(55,80)]:
            r,g,b = thumbnail.getpixel(point)
            assert r>220 and g<40 and b<40
    assert etag.startswith('"')
    with pytest.raises(KeyError):art.thumbnail('FR99')
