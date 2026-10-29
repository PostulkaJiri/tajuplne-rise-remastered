FROM node:22-alpine AS javascript-checks
WORKDIR /src
COPY js /src/js
COPY service-worker.js /src/service-worker.js
RUN node --check js/scanner.js \
    && node --check js/app.js \
    && node --check js/config.js \
    && node --check service-worker.js \
    && touch /javascript-validated

FROM node:22-alpine AS ui-tests
WORKDIR /ui
RUN apk add --no-cache chromium font-noto \
    && npm install --no-save playwright-core@1.56.1
COPY index.html manifest.webmanifest service-worker.js /ui/
COPY js /ui/js
COPY css /ui/css
COPY icons /ui/icons
COPY frontend/tests /ui/frontend/tests
RUN mkdir /ui-artifacts && node frontend/tests/mobile.test.cjs

FROM scratch AS ui-artifacts
COPY --from=ui-tests /ui-artifacts /

FROM python:3.11-slim AS runtime-base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
    OPENCV_IO_MAX_IMAGE_PIXELS=12000000 \
    OMP_NUM_THREADS=2 \
    OPENBLAS_NUM_THREADS=2 \
    MKL_NUM_THREADS=2
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt /app/requirements.txt
RUN python -m pip install --no-cache-dir paddlepaddle==3.2.0 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/ \
    && python -m pip install --no-cache-dir -r /app/requirements.txt \
    && python -m pip check
COPY backend/app /app/app

FROM runtime-base AS tests
COPY backend/requirements-dev.txt /app/requirements-dev.txt
RUN python -m pip install --no-cache-dir -r /app/requirements-dev.txt
COPY backend/tests /app/tests
COPY backend/scripts /app/scripts
RUN PYTHONPATH=/app pytest -q /app/tests

FROM runtime-base AS runtime
COPY --from=javascript-checks /javascript-validated /app/.javascript-validated
COPY index.html manifest.webmanifest service-worker.js /app/static/
COPY js /app/static/js
COPY css /app/static/css
COPY icons /app/static/icons
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--limit-concurrency", "16", "--timeout-keep-alive", "5"]
