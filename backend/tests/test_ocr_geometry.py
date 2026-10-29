from pathlib import Path

import cv2
import numpy as np

from app.matcher import CardMatcher
from app.ocr_service import _join_title_fragments, _map_polygon, _normalized_box, _rotate_bound, _title_style_score

CARDS = Path(__file__).resolve().parents[1] / 'app' / 'cards.json'


def fragments():
    return [
        ('Kniha', 0.9989, np.array([[40,30],[130,50],[124,80],[34,60]], dtype=np.float32)),
        ('a proměn', 0.9781, np.array([[115,47],[248,75],[242,105],[109,77]], dtype=np.float32)),
    ]


def joined(records):
    matcher = CardMatcher(CARDS, 78, 92, 7, 58)
    image = np.full((300, 600, 3), 40, dtype=np.uint8)
    return _join_title_fragments(image, records, matcher, 0.32, 0.30)


def test_adjacent_split_book_title_is_joined_before_matching():
    records = joined(fragments())
    assert len(records) == 1
    text, confidence, poly = records[0]
    matcher = CardMatcher(CARDS, 78, 92, 7, 58)
    assert matcher.match(text).card.id == 'FR49'
    assert matcher.match(text).accepted
    assert confidence == 0.9781
    assert poly.shape == (4,2)


def test_fragments_on_different_rows_are_not_joined():
    records = fragments()
    records[1][2][:,1] += 100
    assert joined(records) == []


def test_distant_fragments_are_not_joined():
    records = fragments()
    records[1][2][:,0] += 250
    assert joined(records) == []


def test_complete_titles_are_not_joined_to_other_cards():
    records = fragments()
    records[0] = ('Král', 0.99, records[0][2])
    records[1] = ('Královna', 0.99, records[1][2])
    assert joined(records) == []


def test_rotation_inverse_preserves_normalized_overlay_coordinates():
    image = np.zeros((480,640,3), dtype=np.uint8)
    polygon = np.array([[50,70],[220,70],[220,100],[50,100]], dtype=np.float32)
    for angle in (0,-15,22,90):
        _,inverse = _rotate_bound(image, angle)
        # Invert the returned inverse to obtain the forward transform.
        forward = cv2.invertAffineTransform(inverse)
        rotated = _map_polygon(polygon, forward)
        mapped = _map_polygon(rotated, inverse)
        np.testing.assert_allclose(mapped,polygon,atol=0.001)
        box = _normalized_box(mapped,640,480)
        np.testing.assert_allclose([box['x0'],box['y0'],box['x1'],box['y1']], [50/640,70/480,220/640,100/480],atol=0.00001)


def test_prefilter_preserves_crop_order_and_keeps_candidate_title_regions():
    from app.ocr_service import _TitleCropFilter
    image = np.full((100,300,3),240,dtype=np.uint8)
    image[:45] = 40
    polygons = [
        np.array([[20,15],[130,15],[130,30],[20,30]],dtype=np.float32),
        np.array([[20,65],[130,65],[130,80],[20,80]],dtype=np.float32),
    ]
    crops = [np.ones((15,110,3),dtype=np.uint8),np.ones((15,110,3),dtype=np.uint8)]
    cropper = _TitleCropFilter(lambda image,polys: iter(crops),0.15)
    filtered = list(cropper(image,polygons))
    assert len(filtered)==2
    assert filtered[0] is crops[0]
    assert filtered[1].size==0


def test_title_filter_is_invariant_to_quarter_turns_and_rejects_cream_rules():
    image = np.full((360,480,3),45,dtype=np.uint8)
    image[160:240,80:400] = 235
    title = np.array([[100,80],[360,80],[360,100],[100,100]],dtype=np.float32)
    rules = np.array([[100,185],[360,185],[360,205],[100,205]],dtype=np.float32)
    for angle in (0,90,180,270):
        rotated,inverse = _rotate_bound(image,angle)
        forward = cv2.invertAffineTransform(inverse)
        assert _title_style_score(rotated,_map_polygon(title,forward)) > .8
        assert _title_style_score(rotated,_map_polygon(rules,forward)) < .1
