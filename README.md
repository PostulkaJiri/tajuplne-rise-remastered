# Tajuplné říše – Remastered

Webová/PWA aplikace pro počítání skóre základní sady 54 karet FR01–FR54.
OCR běží lokálně na serveru. Jediný kontejner obsahuje FastAPI, PaddleOCR,
OpenCV, RapidFuzz a statický frontend; hlavní proces je jeden Uvicorn worker.

```text
browser → JPEG → FastAPI :8000 → PaddleOCR → title filter → RapidFuzz
        ← card IDs + normalized boxes ←
        → temporal tracking → hand.addCard() → scoring
```

Identita karty vzniká pouze z názvu. Titulkový filtr odlišuje světlý text na
tmavém pásu od názvů jiných karet v pravidlech. Scanner nemá pevný limit sedmi
karet: přidávání i limit nadále řídí `hand.addCard()` a `hand.limit()`.
Speciální efekty se nastavují ručně. Odebrané karty mají osm sekund cooldown.

## První nasazení na tomto serveru

Pracovní větev: `feature/self-hosted-ocr`. Požadavky: Docker + Compose,
x86_64 CPU s AVX, internet pro build a první stažení modelů. Nic se neinstaluje
na hostitelský OS.

```bash
cp .env.example .env
./scripts/start-lan.sh
```

Skript sestaví image a těsně před vytvořením kontejneru read-only ověří LAN
adresu, unikátní názvy kontejneru/network/cache volume, `docker ps` i `ss -ltnp`.
Při konfliktu skončí: nic nezastavuje a nevybírá jiný port. Slouží pro první
nasazení; při existujícím kontejneru úmyslně odmítne pokračovat.

Compose publikuje přesně `192.168.0.249:18080:8000`, pouze na potvrzené LAN
adrese. Nepoužívá hostitelský port 8080, porty 80/443 ani cizí Docker network.

- Aplikace: <http://192.168.0.249:18080/>
- Health: <http://192.168.0.249:18080/api/v1/health>
- Slovník 54 karet: <http://192.168.0.249:18080/api/v1/cards>

```bash
docker compose ps
docker compose logs --tail=100 tajuplne-rise
docker exec tajuplne-rise-remastered-ocr python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health').read().decode())"
```

První start stahuje modely do nového projektového volume
`tajuplne-rise-remastered-paddle-cache` (`/root/.paddlex`). Tento volume zachovává
cache přes restart. Vlastní network je `tajuplne-rise-remastered-internal`.
Kontejner má limit 2 CPU, 4 GiB RAM, 128 procesů a dva inference thready.
Staré Dockerfile v `backend/` a `frontend/` nejsou součástí tohoto deploymentu;
Compose používá výhradně kořenový `Dockerfile`.

## Kamera a pozdější HTTPS

HTTP adresa v LAN slouží pro kontrolu aplikace, API a nahrávání fotografií.
Živá kamera na telefonu vyžaduje zabezpečený HTTPS origin. Tato fáze nemění
Caddy, DNS, TLS, firewall ani existující Docker networks.

Později lze po samostatném schválení nastavit existující reverse proxy na
`192.168.0.249:18080`, nebo naplánovat její přístup k jedinému upstreamu
`tajuplne-rise-remastered-ocr:8000`. HTTPS origin má servírovat frontend i
`/api/*`. `js/config.js` používá stejný origin (`scannerApiBase: ""`).
Na proxy pak nastav limit těla 8 MB, konečný timeout a jednoduchý rate limit
pro `POST /api/v1/scan`; zde se žádná proxy nekonfiguruje.

## OCR endpoint a konfigurace

```http
POST /api/v1/scan?debug=true
Content-Type: image/jpeg
```

Tělo obsahuje přímo JPEG, PNG nebo WebP, nikoli cestu k souboru.
Odpověď obsahuje `processingMs`, `cards`, `candidates`; každá karta má FR ID,
název, `ocrText`, `ocrConfidence`, `matchConfidence`, `secondMatchConfidence`,
`matchMargin`, `titleConfidence`, `combinedConfidence`, `accepted` a box
`{x0,y0,x1,y1}` normalizovaný do rozsahu 0–1. Debug přidává rozpoznané texty a rotace. S prefilterem se světlé oblasti pravidel vůbec nerozpoznávají; pro diagnostiku celého textu lze dočasně vypnout `TITLE_PREFILTER`.

Úplný titul se porovnává se všemi 54 názvy. I velmi vysoké skóre musí splnit
minimální náskok před druhou shodou; samotný fragment jako „Elementál“ nestačí.
Automatické přijetí dále vyžaduje OCR confidence a title-style threshold.

Viz `.env.example`: čeština `cs`, `PP-OCRv5`, CPU, dva thready,
`SCAN_ROTATIONS=0,-15`, matching 78 / high 92 / margin 7,
`MIN_OCR_SCORE=0.32`, `MIN_TITLE_STYLE=0.30`. PaddleOCR 3.6.0 nepodporuje
`PP-OCRv6`; používáme jeho podporovanou latin PP-OCRv5 konfiguraci.
Explicitní modely jsou `PP-OCRv5_mobile_det` a `latin_PP-OCRv5_mobile_rec`.
Detektor má limit 960 px (typ `max`) a práh boxu 0.50. Recognition čte
výřezy v plném rozlišení; zjevné netitulkové oblasti se pomocí
`TITLE_PREFILTER=true` vyřadí před rozpoznáváním. Integrace používá připnutý
PaddleX 3.6.1. Sousední části stejného rozděleného titulku se spojují jen při
shodné orientaci, blízké poloze a jednoznačné shodě celého spojeného názvu.

Dva průchody 0/−15° byly zvoleny podle skutečných snímků: opravují natočený
Elementál ohně a téměř svislý Sběratel. Frontend po měření používá nejvýše
1280 px a JPEG kvalitu 0.90. Testované menší JPEG kvality ztrácely některé
čitelné titulky. Výsledky všech porovnání jsou v OCR reportu.

API omezuje upload na 8 000 000 bytů i při streamování, dobu uploadu na 15 s
a dekódování v tomto deploymentu na 25 milionů pixelů. OCR zpracovává jeden požadavek; další
souběžné framy vracejí 429 místo vytváření fronty. Frontend také posílá snímky
sekvenčně. API odpovědi se neukládají do PWA cache.

## Soukromí a testování

`DEBUG_SAVE_FAILED_SCANS=false`: snímky se standardně neukládají. Pokud se
ladění explicitně zapne, neúspěšné snímky skončí pouze v zapisovatelné vrstvě
vlastního kontejneru v `/tmp/tajuplne-rise-scans`, bez sdíleného volume.

Nový ground truth byl ručně přečten přímo z 16 dodaných snímků: deset
fotografií se 70 čitelnými názvy a šest předloh se všemi 54 kartami.
Obsahuje SHA-256 každého souboru; staré IMG názvy se nepoužívají.

Soukromé fotografie patří výhradně do `backend/tests/fixtures/scans/`.
Tento adresář i uživatelský zdroj `testovaci-data/` jsou vyloučeny z Gitu
i Docker build kontextu. Na tomto serveru jsou kopie v podadresářích `foto/`
a `originaly/`. Pro opakované nasazení lze snímky lokálně importovat příkazem:

```bash
cp -a testovaci-data/foto testovaci-data/originaly backend/tests/fixtures/scans/
```

Snímky se nesmí
commitovat, zahrnovat do image ani posílat na externí OCR služby.

Regresní nástroj používá pouze standardní knihovnu Pythonu, nic neinstaluje:

```bash
python3 backend/scripts/evaluate_fixtures.py \
  --api http://192.168.0.249:18080/api/v1/scan \
  --output backend/fixture-results.json
# Volitelně pouze fotografie nebo předlohy:
python3 backend/scripts/evaluate_fixtures.py --group photo
python3 backend/scripts/evaluate_fixtures.py --group original
```

Postupuje sekvenčně. Vypíše expected/detected/correct, false negatives,
false positives, serverový i celkový čas pro každý dostupný obrázek, oddělené
metriky fotografií/předloh a souhrnný
recall, precision, průměr a p95. Chybějící obrázky vypíše; při nulovém počtu
měření vrací metriky `null` a exit code 2. Částečný dataset nebo nesplněné
minimum 6/7 s nulou false positives vrací 1. Úspěšný kompletní dataset vrací 0.

Python unit/API testy běží v build stage; nepřidávají runtime kontejner:

```bash
docker build --target tests --tag tajuplne-rise-remastered-tests .
docker compose config --quiet
```

Kořenový Dockerfile při běžném buildu také kontroluje syntaxi
`js/scanner.js`, `js/app.js`, `js/config.js` a `service-worker.js` pomocí
Node 22 v build stage. Na hostu není Node ani pytest potřeba.
Syntetický smoke test skutečného OCR lze zopakovat uvnitř běžícího kontejneru:

```bash
docker exec -i tajuplne-rise-remastered-ocr python - < backend/scripts/smoke_ocr.py
```

Syntetický obrázek vzniká pouze v paměti; tento test nenahrazuje fotografie.
Výsledky a omezení skutečného nasazení jsou v [backend/OCR_REPORT.md](backend/OCR_REPORT.md).

Scoring soubory `js/deck.js`, `js/hand.js` a `js/discard.js` pocházejí z MIT
projektu [fantasy-realms](https://github.com/fantasy-realms/fantasy-realms.github.io).
Viz [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
