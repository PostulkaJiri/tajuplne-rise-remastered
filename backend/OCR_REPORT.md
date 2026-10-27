# OCR deployment report — 27. 10. 2026

Nasazení na dedikovaném LAN portu funguje. Přesnost na reálných fotografiích
zatím **nelze vyhodnotit**: chybí všech deset soukromých testovacích snímků.
Požadované minimum 6/7 a precision automatických potvrzení proto nejsou ověřené.
Syntetický smoke test níže toto acceptance kritérium nenahrazuje.

## Server

| Položka | Zjištěná hodnota |
| --- | --- |
| CPU | Intel Core Ultra 7 265, 20 CPU, AVX/AVX2 |
| RAM | 30.79 GiB, přibližně 24 GiB available při kontrolách |
| Architecture | Linux x86_64 / amd64 |
| Kernel | 6.8.0-147-generic |
| Docker | Engine 29.3.0, Compose v5.1.0 |
| Python | 3.11 v Docker image |
| PaddleOCR | 3.6.0 |
| PaddlePaddle | CPU 3.2.0 |
| PaddleX | 3.6.1 |
| OpenCV / NumPy | 4.10.0 / 1.26.4 |
| Runtime limits | 2 CPU, 4 GiB RAM, 128 PIDs, dva inference thready |

Žádné ML/runtime balíčky nebyly instalovány na hostitelský OS. Systémové
knihovny i Python/Node nástroje se instalovaly pouze při Docker buildu.

## Deployment

- Jediná Compose service: `tajuplne-rise`.
- Kontejner: `tajuplne-rise-remastered-ocr`.
- Jediný hlavní proces: Uvicorn, jeden worker, interně `0.0.0.0:8000`.
- Host binding: **`192.168.0.249:18080 -> 8000/tcp`**.
- Před prvním startem byla read-only potvrzena LAN adresa na `enp129s0`,
  nepřítomnost kolize v `docker ps` i prázdný výsledek `ss` pro TCP 18080.
  Unikátní názvy kontejneru, network a volume tehdy neexistovaly.
- Start provedl `scripts/start-lan.sh`; při konfliktu odmítne pokračovat.
- Po aktualizaci a řízeném restartu zůstal kontejner `healthy`, bez OOM,
  bez automatických restartů. Aktualizován/restartován byl pouze kontejner
  prokazatelně vytvořený během této práce.

| Kontrola přes `http://192.168.0.249:18080` | Výsledek |
| --- | --- |
| `/`, `/index.html` | HTTP 200, frontend |
| `/js/config.js`, `/js/scanner.js` | HTTP 200 |
| `/css/app.css`, `/icons/icon.svg` | HTTP 200 |
| `/manifest.webmanifest`, `/service-worker.js` | HTTP 200 |
| `/api/v1/health` | HTTP 200, skutečný inicializovaný PaddleOCR |
| `/api/v1/cards` | HTTP 200, přesně FR01–FR54, 54 karet |
| `/api/v1/scan?debug=true` | HTTP 200, skutečná inference na syntetickém vstupu |

HTTP kontroly byly provedeny ze serveru přes jeho LAN adresu; přístup z jiného
fyzického LAN zařízení zatím nebyl otestován. Firewall se neměnil.

## Finální OCR konfigurace

```text
language: cs (Czech / Latin recognition model)
OCR generation: PP-OCRv5
detection model: PP-OCRv5_mobile_det
recognition model: latin_PP-OCRv5_mobile_rec
textline orientation: enabled
CPU threads: 2
frontend image resolution: maximum 1600 px longest side
frontend JPEG quality: 0.78
rotations: 0
MATCH_ACCEPT_SCORE: 78
MATCH_HIGH_SCORE: 92
MATCH_MIN_MARGIN: 7 (required even for high scores)
MIN_OCR_SCORE: 0.32
MIN_TITLE_STYLE: 0.30
candidate minimum fuzzy score: 58
DEBUG_SAVE_FAILED_SCANS: false
```

Identitu určuje úplný OCR název porovnaný pomocí RapidFuzz se slovníkem 54
názvů. Síla, suit, ilustrace a pravidla nejsou zdrojem identity. Title-style
filtr zůstává založený na tmavosti okolí OCR boxu; jeho threshold nebyl laděn
bez fotografií. Nejde o záruku správné filtrace pravidel za všech podmínek.

PaddleOCR 3.6.0 odmítá původně nastavené `PP-OCRv6`; jeho podporované generace
jsou v3/v4/v5. Čeština patří do Latin modelu v5. Ověřeno v
[oficiálním zdrojovém kódu verze 3.6.0](https://github.com/PaddlePaddle/PaddleOCR/blob/v3.6.0/paddleocr/_pipelines/ocr.py).
Mobilní detektor je součástí
[oficiálních PP-OCRv5 modelů](https://paddlepaddle.github.io/PaddleOCR/main/en/version3.x/module_usage/text_detection.html).

## Výsledky pro každý obrázek

**test fixtures missing**

Prohledán byl výhradně `backend/tests/fixtures/scans/`; obsahuje pouze
`.gitkeep`. Následující počet expected vychází z dodaného ground truth,
nikoli z provedených OCR měření.

| image | expected | correct | missed | false positive | processing ms |
| --- | ---: | --- | --- | --- | --- |
| IMG_5707.jpeg | 7 | N/A | N/A | N/A | N/A |
| IMG_5708.jpeg | 7 | N/A | N/A | N/A | N/A |
| IMG_5709.jpeg | 7 | N/A | N/A | N/A | N/A |
| IMG_5710.jpeg | 7 | N/A | N/A | N/A | N/A |
| IMG_5711.jpeg | 7 | N/A | N/A | N/A | N/A |
| IMG_5712.jpeg | 7 | N/A | N/A | N/A | N/A |
| IMG_5713.jpeg | 7 | N/A | N/A | N/A | N/A |
| IMG_5714.jpeg | 7 | N/A | N/A | N/A | N/A |
| IMG_5715.jpeg | 7 | N/A | N/A | N/A | N/A |
| IMG_5716.jpeg | 7 | N/A | N/A | N/A | N/A |

## Souhrn reálného datasetu

```text
images listed in ground truth: 10
cards listed in ground truth: 70
images tested: 0
expected cards in tested images: 0
correct: N/A (not measured)
false negatives: N/A (not measured)
false positives: N/A (not measured)
recall: N/A
precision: N/A
avg processing time: N/A
p95 processing time: N/A
```

`evaluate_fixtures.py --output backend/fixture-results.json` správně skončil
s exit code 2, vypsal všech deset chybějících souborů a `null` pro procenta
a časy. Nula dostupných snímků se nevydává za úspěšný regresní test.

## Syntetický smoke test a výkon

Snímek 1280×720, JPEG 80 %, vznikl pouze v paměti: bílý text `Kralovna` na
tmavém pásu a černý text `Drak` na světlé ploše pravidel. Všechny průchody
přijaly pouze FR32, i když raw OCR přečetlo také `Drak`. Finální skóre titulku
bylo 0.8200 proti 0.0318 pro text pravidel. OCR confidence obou textů bylo
přibližně 0.9998–0.9999. Matcher Královny vracel úplnou shodu a bezpečný náskok.

| Konfigurace | První průchod | Další průchody | Průměr | p95 (nearest rank) |
| --- | ---: | --- | ---: | ---: |
| server detector, rotace 0/−22/+22 | 9349 ms | 9149, 9046 ms | 9181.3 ms | 9349 ms |
| mobile detector, rotace 0 | 273 ms | 164, 153 ms | 196.7 ms | 273 ms |
| mobile detector po restartu | 258 ms | 164, 153 ms | 191.7 ms | 258 ms |

Změnil se detektor i počet průchodů, proto nelze z tohoto měření odděleně
vyčíslit přínos každé změny. Finální konfigurace byla zvolena jako konzervativní
CPU baseline se změřenou syntetickou latencí. **Vliv na recall a natočené
reálné karty není změřen.** Tyto časy také neudávají latenci reálné sedmikaretní
ruky ani browser/network latenci. Runtime po syntetické inference spotřebovával
řádově stovky MiB; limit je 4 GiB. Serveru zůstávalo přibližně 24 GiB available.

Reprodukovatelný vstup vytváří [scripts/smoke_ocr.py](scripts/smoke_ocr.py).
Naměřené texty, boxy a časy bez obrazových dat obsahuje
[smoke-results.json](smoke-results.json).

## Restart a model cache

Řízený restart vlastní service prošel. Log po restartu u všech tří aktivních
modelů uvádí `Using cached files`; žádné modely se znovu nestahovaly.
Metadata cache před a po restartu jsou totožná: 84 souborů, 108 381 083 bytů,
SHA-256 serializovaných cest/velikostí/mtime
`6dddb8c0362b170ffdca77935725ac5c05eda19f0effcde146b4e1f3b16bc208`.
Cache obsahuje i serverový detektor z prvního porovnání, který se již nepoužívá.
Žádný volume ani model nebyl kvůli úklidu mazán. Následná skutečná inference
po restartu také prošla.

## Testy a kontrola frontendu

- Finální Docker test stage: **21 passed**, bez warningů.
- Testy pokrývají všechny úplné názvy FR01–FR54, blízké názvy, odmítnutí
  společných fragmentů a povinný margin i při vysokém skóre.
- API testy ověřují 54 karet, PWA entrypoints, cache hlavičky, neplatné vstupy,
  limit známého i streamovaného uploadu a 429 místo čekajícího OCR požadavku.
- Metriky mají testy na false positives, false negatives, kandidáty,
  prázdný dataset a chybu HTTP požadavku.
- Node 22 build stage: `node --check` pro scanner, app, config i service worker.
- `docker compose config`, přesně jedna service, `bash -n scripts/start-lan.sh`
  a `git diff --check` prošly.
- Statická kontrola: frontend odesílá snímky sekvenčně. Overlay používá
  `max(displayWidth/videoWidth, displayHeight/videoHeight)` a středový posun,
  což odpovídá `object-fit: cover` pro portrait i landscape poměry.
- Přidávání prochází `hand.addCard()`; scanner se po sedmé kartě nezastavuje.
  Existující engine nadále povoluje osmou kartu podle Nekromanta.
- Existující temporal tracking potvrzuje velmi vysokou confidence jedním
  framem, střední dvěma; cooldown odstranění je osm sekund. Jeho thresholdy
  se bez reálných fotografií neměnily. Efekty speciálních karet nastavuje hráč.
- Skutečný browser/kamera workflow a přesnost boxů na fyzickém iPhonu
  nebyly otestovány. HTTP LAN adresa nepovolí `getUserMedia` jako HTTPS origin;
  upload fotografií a API lze testovat nyní.

## Co bylo změněno

1. Dvě runtime services nahrazeny jedinou FastAPI/PWA aplikací, kořenovým
   Dockerfile a pevně omezeným LAN mappingem 18080→8000.
2. Nová projektová network/cache, konzervativní resource limity a read-only
   preflight skript, který při konfliktu nic nezastavuje.
3. Kompatibilní PP-OCRv5 a menší CPU detektor s jedním změřeným průchodem.
4. Opraven matcher: úplné názvy místo substring skóre a povinný match margin.
5. Limit uploadu se kontroluje už během čtení; doba uploadu je omezená na 15 s,
   Compose nastavuje limit dekódování 25 milionů pixelů. Souběžný OCR požadavek
   se odmítá 429; API se neukládá do cache.
6. HTML načítá `js/config.js`; nepoužívaný externí Tesseract.js byl odebrán.
7. Rozšířené metriky/regresní nástroj bez hostitelských závislostí, unit/API
   testy, syntetický smoke test a dokumentace. CI workflow zůstává původní.

## Isolation verification

Aktuální přímý pokyn uživatele výslovně povolil hostitelský port 18080 a tím
nahradil starší zákaz všech host bindings v přiložených omezeních. Proto se
Published host ports pravdivě uvádí jako autorizovaný LAN binding, nikoli NONE.
Položky Existing containers níže označují aplikace existující před touto prací.

```text
Workspace used: /home/postulka/deploy/tajuplne-rise
Container created: tajuplne-rise-remastered-ocr
Docker network created: tajuplne-rise-remastered-internal
Docker volume created: tajuplne-rise-remastered-paddle-cache
Published host ports: 192.168.0.249:18080/tcp -> container 8000/tcp (explicitly authorized)
Existing containers restarted: NONE
Existing containers stopped: NONE
Existing containers modified: NONE
Host packages installed: NONE
System configuration modified: NONE
Files modified outside project workspace: NONE
Reverse proxy / Caddy modified: NONE
DNS / HTTPS / firewall modified: NONE
Foreign networks / volumes used: NONE
Private photographs committed, uploaded externally or included in image: NONE
```

Vlastní Docker network obsahuje jen náš kontejner; nejsou připojeny žádné
cizí volumes, host bind mounts ani Docker socket. Docker build context vylučuje
**celý** soukromý adresář scans bez ohledu na příponu. Debug ukládání zůstává false.

## Známé problémy a doporučené další kroky

1. Doplnit pouze do `backend/tests/fixtures/scans/` soubory IMG_5707–IMG_5716.
   Spustit sekvenční evaluator proti LAN URL a doplnit reálné výsledky do reportu.
   Bez toho nelze rozhodnout o splnění 6/7, false positives ani live výkonu.
2. Nad těmito snímky porovnat mobile/server detector, rotace a vstupní rozlišení.
   Zejména natočení, odlesk, zakrytí a malé titulky mohou změnit recall.
   Přínos manuálních rotací vůči text-line orientation zatím není ověřený.
3. Teprve podle reálných false positives/negatives ladit title filtering,
   matcher, JPEG kvalitu a temporal thresholds. Nedělat závěr z jednoho
   jednoduchého syntetického titulku.
4. Po samostatném schválení HTTPS integrace fyzicky otestovat kameru, boxy,
   přidávání osmé karty a ruční odstranění na iPhonu. Reverse proxy může
   směřovat na LAN port 18080; v této práci nebyla nakonfigurována.

Práce probíhá pouze na `feature/self-hosted-ocr`; master ani PR #4 se nemerguje.
