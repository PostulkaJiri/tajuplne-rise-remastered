# Tajuplné říše – Remastered

Webová/PWA aplikace pro automatické počítání skóre základní sady 54 karet (FR01–FR54).

Aktuální architektura používá **vlastní serverový OCR backend**. Browser už neprovádí
Tesseract OCR. Telefon pouze pořizuje komprimované snímky z kamery a posílá je na
stejný HTTPS origin do `/api/v1/scan`.

## Architektura

```text
iPhone / Android / desktop browser
        |
        | getUserMedia + JPEG frame
        v
Nginx / PWA frontend
        |
        | POST /api/v1/scan
        v
FastAPI
        |
        +-- PaddleOCR (Czech)
        +-- title-band style filter
        +-- RapidFuzz against FR01-FR54
        |
        v
card IDs + confidence + normalized boxes
        |
        v
browser temporal tracking
        |
        v
existing deck.js / hand.js scoring engine
```

Identita karty se určuje pouze z OCR textu odpovídajícího názvu na tmavém horním
titulkovém pásu. Text BONUS/POSTIH, síla karty a ilustrace nejsou zdrojem identity.

## Důležitá herní vlastnost: ruka není natvrdo omezena na 7

Běžná ruka má 7 karet, ale herní engine může limit změnit (např. Nekromant dovoluje
osmou kartu). Frontend proto nemá konstantu `MAX_HAND_SIZE = 7`. Přidání karty
vždy prochází původním `hand.addCard()` / `hand.limit()` enginem.

## Rychlé spuštění přes Docker

Požadavky:

- x86_64 Linux server,
- Docker + Docker Compose,
- dostatek RAM pro PaddleOCR,
- internet při prvním startu kvůli stažení OCR modelů.

```bash
cp .env.example .env
docker compose up -d --build
```

Výchozí frontend bude dostupný na:

```text
http://SERVER:8080
```

Stav OCR:

```text
GET http://SERVER:8080/api/v1/health
```

První start scanner-api může být delší, protože PaddleOCR stáhne modely. Model cache
je uložená v Docker volume `paddle-cache`.

## DNS + HTTPS

Pro kameru na iPhone je produkčně nutné HTTPS. Doporučené nasazení:

```text
https://rise.example.cz
          |
          v
existing reverse proxy / TLS
          |
          v
localhost:8080 (frontend container)
          |
          +-- static PWA
          +-- /api/* -> scanner-api:8000
```

Aplikace neobsahuje natvrdo žádnou doménu. `js/config.js` má prázdný
`scannerApiBase`, tedy používá stejný origin. To je doporučené.

Pokud je backend na jiném originu, nastav `scannerApiBase` a zároveň
`CORS_ORIGINS` pro backend.

## OCR endpoint

```http
POST /api/v1/scan
Content-Type: image/jpeg
```

Příklad odpovědi:

```json
{
  "processingMs": 410,
  "cards": [
    {
      "id": "FR32",
      "name": "Královna",
      "ocrText": "Královna",
      "ocrConfidence": 0.96,
      "matchConfidence": 1.0,
      "titleConfidence": 0.81,
      "combinedConfidence": 0.95,
      "box": {"x0": 0.12, "y0": 0.20, "x1": 0.39, "y1": 0.27},
      "accepted": true
    }
  ],
  "candidates": []
}
```

`?debug=true` navíc vrací raw OCR texty, jejich boxy, rotaci a title-style confidence.

## Proč title-style filter

Na kartách se názvy jiných karet objevují i v pravidlech. Například Jednorožec může
v textu bonusu obsahovat „Královnu“. Pouhý fuzzy match by proto mohl přidat
neexistující kartu do ruky.

Backend přijme kartu automaticky jen tehdy, když:

1. OCR text odpovídá jednomu z 54 českých titulů,
2. nejlepší fuzzy shoda splní threshold a má dostatečný náskok před druhou,
3. OCR confidence splní threshold,
4. OCR box vypadá jako světlý text na tmavém titulkovém pásu.

Thresholdy jsou konfigurovatelné v `.env`.

## Live scanning

Frontend neposílá video stream. Zpracování je serializované:

```text
capture JPEG
-> wait for OCR response
-> update overlay + temporal tracking
-> short delay
-> capture next JPEG
```

Nevzniká tedy fronta starých snímků. Velmi jistá detekce se může potvrdit hned,
jinak se karta potvrdí po opakovaném zachycení. Potvrzená karta se automaticky
přidá do ruky a skóre se přepočítá.

Pokud uživatel kartu ručně odebere, frontend ji několik sekund nepřidá zpět.

## Regresní fotografie

Ground truth pro deset reálných fotografií je uložen v:

```text
backend/tests/fixtures/ground_truth.json
```

Fotografie samotné nejsou součástí veřejného repozitáře. Nakopíruj je do:

```text
backend/tests/fixtures/scans/
```

a spusť:

```bash
python -m pip install -r backend/requirements-dev.txt
python backend/scripts/evaluate_fixtures.py --api https://rise.example.cz/api/v1/scan
```

Výstup obsahuje detected / missed / false positive pro každý snímek a souhrnný
recall a precision.

Cílové minimum pro reprezentativní sedmikaretní ruku:

- alespoň 6/7 správně rozpoznaných,
- 0 automaticky přijatých false positives.

## Unit test matcheru

```bash
python -m pip install -r backend/requirements-dev.txt
PYTHONPATH=backend pytest backend/tests/test_matcher.py
```

## Konfigurace

Viz `.env.example`.

Nejdůležitější parametry:

- `SCAN_ROTATIONS=0,-22,22`
- `MATCH_ACCEPT_SCORE=78`
- `MATCH_HIGH_SCORE=92`
- `MATCH_MIN_MARGIN=7`
- `MIN_OCR_SCORE=0.32`
- `MIN_TITLE_STYLE=0.30`

Rotace zvyšují recall natočených karet, ale násobí OCR čas. Pro slabší CPU začni
s `SCAN_ROTATIONS=0` a teprve podle regression reportu přidávej další úhly.

## Soukromí

Ve výchozím stavu se snímky po OCR neukládají.

Pro ladění lze zapnout:

```text
DEBUG_SAVE_FAILED_SCANS=true
```

Pak se pouze neúspěšné framy ukládají do Docker volume `scan-debug`.

## Reference / inspirace

- https://github.com/benjamin-klamerek/fantasy-realm-scoring
  - Fantasy Realms scanner, ML Kit, title-only matching, on-the-fly analysis.
- https://github.com/JeremyMCastillo/pk-scan
  - oddělení OCR/matchingu a title-band OCR pipeline.
- https://github.com/fantasy-realms/fantasy-realms.github.io
  - původní scoring engine použitý v této aplikaci.

Scoring soubory `js/deck.js`, `js/hand.js` a `js/discard.js` pocházejí z
původního MIT projektu. Viz `THIRD_PARTY_NOTICES.md`.
