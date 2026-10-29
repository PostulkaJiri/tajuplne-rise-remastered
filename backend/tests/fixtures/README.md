# Private OCR regression fixtures

`ground_truth.json` contains independent manual visual transcriptions of title
banners in 16 supplied images: ten photographs (70 readable titles) and six
original sheets (54 titles, all FR01–FR54). Labels were read from the photographs,
not inferred from OCR results or old IMG filenames. Each label includes the
source image SHA-256 to detect accidental substitutions.

On 2026-10-29, 21 captured photographs with another 151 readable titles were
manually transcribed into group `capture`. The exact derivative of the original
known test photo was excluded. Some captures repeat the same arrangement under
different framing/lighting; they are not independent scenes. Four captures are
sideways, one upside down, and two originally caused HTTP 500. Partial titles
cut off by the image edge and fully occluded titles are not inferred.

Private image bytes are absent from Git and Docker build context. Put them in:

```text
scans/foto/ChatGPT Image Oct 27, 2026, <time> PM.jpg
scans/originaly/ChatGPT Image Oct 26, 2026, <time> PM-<number>.png
scans/captures/<sha256>.jpg
```

On this server the supplied files also remain in `testovaci-data/`; that entire
folder is ignored by Git and Docker. The source files are copied, never renamed
or modified. The photograph at 19:21:40 has an additional almost fully occluded
card with no readable title; that hidden card is excluded from expected results.

Run sequential evaluation against the local server:

```bash
python3 backend/scripts/evaluate_fixtures.py --group photo --output backend/fixture-results.json
python3 backend/scripts/evaluate_fixtures.py --group original
python3 backend/scripts/import_captured_fixtures.py
python3 backend/scripts/evaluate_fixtures.py --group capture
```

Never commit photographs, include them in images, or send them to external OCR
services. Use only the self-hosted API and the fixture directory for regression.
