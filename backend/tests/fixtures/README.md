# OCR regression fixtures

Copy the ten real test photos into this directory using these exact names:

- IMG_5707.jpeg
- IMG_5708.jpeg
- IMG_5709.jpeg
- IMG_5710.jpeg
- IMG_5711.jpeg
- IMG_5712.jpeg
- IMG_5713.jpeg
- IMG_5714.jpeg
- IMG_5715.jpeg
- IMG_5716.jpeg

Ground truth is stored in ../ground_truth.json.

Images are intentionally not committed by default so the repository does not
silently publish personal camera photos. Run:

    python backend/scripts/evaluate_fixtures.py --api https://YOUR_HOST/api/v1/scan

Acceptance target for normal seven-card hands:
- recall >= 6/7 per representative image,
- zero automatically accepted false positives.
