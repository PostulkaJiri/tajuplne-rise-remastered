# OCR report — 27. 10. 2026 (historické měření)

Aktuální opravu HTTP 500, konfiguraci a regresi nad rozšířenou sadou 37 snímků
popisuje [OCR_CAPTURE_REPORT.md](OCR_CAPTURE_REPORT.md), měření z 29. 10. 2026.
Níže zůstává původní měření a jeho tehdejší konfigurace.

**Finální HTTP regrese: 124/124 správných detekcí, 0 false positives,
0 false negatives.** Všech deset fotografií má 7/7; šest předloh má 9/9.
Ground truth byl vytvořen přímým ručním přečtením dodaných snímků.

## Server a deployment

| Položka | Hodnota |
| --- | --- |
| CPU | Intel Core Ultra 7 265, 20 CPU, AVX/AVX2 |
| RAM | 30.79 GiB, přibližně 23–24 GiB available při testech |
| Architecture | Linux x86_64 / amd64, kernel 6.8.0-147-generic |
| Docker | Engine 29.3.0, Compose v5.1.0 |
| Python | 3.11 v image |
| PaddleOCR / PaddlePaddle | 3.6.0 / CPU 3.2.0 |
| PaddleX | připnutý 3.6.1 |
| OpenCV / NumPy | 4.10.0 / 1.26.4 |
| Kontejner | tajuplne-rise-remastered-ocr |
| Host binding | 192.168.0.249:18080 → 8000/tcp |
| Limity | 2 CPU, 4 GiB, 128 PIDs, dva inference thready |

Běží jediná Compose service `tajuplne-rise` a jeden hlavní Uvicorn worker.
FastAPI servíruje PWA i API. Aplikace a health vracejí přes LAN HTTP 200,
`/api/v1/cards` obsahuje přesně 54 karet FR01–FR54. Kontejner je `healthy`,
bez OOM a bez automatických restartů. Během testů se používalo přibližně
650 MiB pro samotnou zahřátou aplikaci; dočasné sekvenční experimenty zůstaly
uvnitř stejného 4GiB/2CPU limitu. Žádné hostitelské balíčky nebyly instalovány.

## Nezávislý referenční seznam

Zdrojem je uživatelský adresář `testovaci-data/`. Každý snímek byl přečten
vizuálně a názvy titulkových pásů zapsány do
[ground_truth.json](tests/fixtures/ground_truth.json). Referenční seznam nevznikl
převzetím detekcí OCR ani přiřazením ke starým IMG_5707–IMG_5716.

- `foto/`: deset snímků 1152×1536, celkem 70 čitelných titulů.
- `originaly/`: šest předloh 1055×1491, devět karet na předlohu, všech FR01–FR54.
- Fotografie z 19:21:40 obsahuje také téměř úplně zakrytou další kartu bez
  čitelného názvu. Její identita se nehádá a není očekávanou detekcí.
- Každý záznam obsahuje SHA-256 konkrétního souboru. Evaluator při jiné fotografii
  odmítne použít původní seznam očekávaných karet.

Snímky zůstávají soukromé v původním adresáři a v ignorovaných kopiích
`backend/tests/fixtures/scans/`. Soubory se nepřejmenovávaly ani neupravovaly.

## Finální OCR konfigurace

```text
PADDLE_OCR_LANG=cs
PADDLE_OCR_VERSION=PP-OCRv5
PADDLE_DETECTION_MODEL=PP-OCRv5_mobile_det
PADDLE_RECOGNITION_MODEL=latin_PP-OCRv5_mobile_rec
PADDLE_DETECTION_MAX_SIDE=960 (limit_type=max)
PADDLE_DETECTION_BOX_THRESHOLD=0.50
PADDLE_CPU_THREADS=2
SCAN_ROTATIONS=0,-15
TITLE_PREFILTER=true
MATCH_ACCEPT_SCORE=78
MATCH_HIGH_SCORE=92
MATCH_MIN_MARGIN=7 (platí i pro vysoké skóre)
MIN_OCR_SCORE=0.32
MIN_TITLE_STYLE=0.30
candidate minimum fuzzy score=58
frontend longest side=1280 px
frontend JPEG quality=0.90
DEBUG_SAVE_FAILED_SCANS=false
```

Detekce textu se zmenší nejvýše na 960 px; recognition nadále čte výřezy z
plného vstupního rozlišení. Před recognition se pomocí stejného style skóre
vyřadí jen oblasti pod 0.15, které by následný filtr odmítl i jako kandidáty.
PaddleX nadále provádí vlastní crop, orientaci a recognition. Malý adaptér jeho
crop fáze používá připnutou verzi 3.6.1; pořadí boxů ověřuje unit test.

Sousední části titulu se spojují jen pokud jsou blízko, souhlasí orientace a
velikost písma, jednotlivě nejsou accepted, míří ke stejnému názvu a spojený text
splní plný matcher včetně marginu. Tím se opravuje `Kniha` + `a proměn` bez
snížení matching thresholdů nebo obecného přijímání neúplných názvů.
Identita stále vzniká pouze z textu názvu; síla, suit, ilustrace ani pravidla
se k identifikaci nepoužívají. Algoritmus neobsahuje názvy testovacích souborů,
očekávané sestavy ani limit sedmi detekcí.

## Výsledky pro každou fotografii

Všechny názvy níže jsou v `scans/foto/`. Časy měřila skutečná API implementace
po nasazení, požadavky probíhaly sekvenčně přes LAN adresu.

| image | expected | correct | missed | false positive | processing ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| ChatGPT Image Oct 27, 2026, 07_21_40 PM.jpg | 7 | 7 | 0 | 0 | 750 |
| ChatGPT Image Oct 27, 2026, 07_21_48 PM.jpg | 7 | 7 | 0 | 0 | 874 |
| ChatGPT Image Oct 27, 2026, 07_21_55 PM.jpg | 7 | 7 | 0 | 0 | 894 |
| ChatGPT Image Oct 27, 2026, 07_22_03 PM.jpg | 7 | 7 | 0 | 0 | 970 |
| ChatGPT Image Oct 27, 2026, 07_22_10 PM.jpg | 7 | 7 | 0 | 0 | 1120 |
| ChatGPT Image Oct 27, 2026, 07_22_19 PM.jpg | 7 | 7 | 0 | 0 | 623 |
| ChatGPT Image Oct 27, 2026, 07_22_27 PM.jpg | 7 | 7 | 0 | 0 | 508 |
| ChatGPT Image Oct 27, 2026, 07_22_35 PM.jpg | 7 | 7 | 0 | 0 | 609 |
| ChatGPT Image Oct 27, 2026, 07_22_42 PM.jpg | 7 | 7 | 0 | 0 | 514 |
| ChatGPT Image Oct 27, 2026, 07_22_49 PM.jpg | 7 | 7 | 0 | 0 | 893 |

## Výsledky pro každou předlohu

Názvy jsou v `scans/originaly/`. Devět přijatých karet na obrázek zároveň
potvrzuje, že backend po sedmé kartě nepřestává detekovat.

| image | expected | correct | missed | false positive | processing ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| ChatGPT Image Oct 26, 2026, 07_56_37 PM-1.png | 9 | 9 | 0 | 0 | 1097 |
| ChatGPT Image Oct 26, 2026, 07_56_38 PM-2.png | 9 | 9 | 0 | 0 | 1006 |
| ChatGPT Image Oct 26, 2026, 07_56_39 PM-3.png | 9 | 9 | 0 | 0 | 1299 |
| ChatGPT Image Oct 26, 2026, 07_56_40 PM-4.png | 9 | 9 | 0 | 0 | 1254 |
| ChatGPT Image Oct 26, 2026, 07_56_40 PM-5.png | 9 | 9 | 0 | 0 | 1159 |
| ChatGPT Image Oct 26, 2026, 07_56_41 PM-6.png | 9 | 9 | 0 | 0 | 1306 |

## Souhrn

| Metrika | Fotografie | Předlohy | Celkem |
| --- | ---: | ---: | ---: |
| images tested | 10 | 6 | 16 |
| expected cards | 70 | 54 | 124 |
| correct | 70 | 54 | 124 |
| false negatives | 0 | 0 | 0 |
| false positives | 0 | 0 | 0 |
| recall | 100 % | 100 % | 100 % |
| precision | 100 % | 100 % | 100 % |
| avg processing ms | 775.5 | 1186.8 | 929.8 |
| p95 processing ms | 1120 | 1306 | 1306 |

P95 je nearest-rank percentil. U deseti fotografií je tedy p95 maximum.
CSV/JSON ekvivalent s expected/detected/missed pro každý obrázek je v
[OCR_RESULTS.json](OCR_RESULTS.json). Evaluator skončil exit code 0, bez
chybějících souborů a bez HTTP chyb.

Jde o backend `accepted` výsledky nad statickými obrázky. Fyzický kamerový
workflow ani frontend temporal confirmation tímto testem nejsou měřeny.

## Porovnání variant a nalezené chyby

Výchozí nasazená verze před tímto laděním měla na stejných ručně přečtených
fotografiích 67/70, recall 95.7 %, precision 100 %, průměr 673.2 ms.
Předlohy měla 54/54. Chyběly Kniha proměn (detektor rozdělil název),
Elementál ohně (natočený titulek) a Sběratel (téměř svislá karta).

| Varianta, deset fotografií | Correct | False + | Avg ms |
| --- | ---: | ---: | ---: |
| původní jeden průchod | 67/70 | 0 | 673.2 |
| spojení fragmentů, jeden průchod | 68/70 | 0 | 717.4 |
| spojení fragmentů, 0/−15°, původní detektor resolution | 70/70 | 0 | 1572.0 |
| totéž + vyřazení cropů před recognition | 70/70 | 0 | 1450.9 |
| detector max 960, původní box threshold 0.60 | 69/70 | 0 | 653.7 |
| finální detector max 960, box threshold 0.50, HTTP API | 70/70 | 0 | 775.5 |

Na třech problematických snímcích byly samostatně vyzkoušeny i úhly ±15,
±22, ±30 a 90 stupňů. Kombinace 0/−22/+22 by pokryla všechny tři, ale měla
přibližně 3 s na snímek. Spojení fragmentů a 0/−15° pokrývá celý dataset ve
dvou průchodech; další rotace proto nebyly přidány. Všechny experimenty běžely
sekvenčně, bez stress testu a bez navyšování CPU threadů.

### Rozlišení a JPEG

Následující simulace používá OpenCV resize/JPEG a finální OCR. U `max1600`
má zdroj stále 1536 px; větší se nedopočítává. Limit 1920 by na těchto stejných
zdrojích vytvořil totožný snímek jako 1600, proto se neuvádí jako další nezávislé
měření. Skutečný nativní kamerový vstup 1920 px zde není k dispozici.

| Max side / JPEG | Correct | False + | Avg ms | p95 ms | Mean payload KiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| max1280-jpeg70 | 69/70 | 0 | 740.9 | 1065 | 264.5 |
| max1280-jpeg78 | 69/70 | 0 | 764.2 | 1044 | 311.3 |
| max1280-jpeg80 | 68/70 | 0 | 764.9 | 1078 | 325.1 |
| max1280-jpeg90 | 70/70 | 0 | 755.2 | 1072 | 460.6 |
| max1600-jpeg70 | 68/70 | 0 | 762.2 | 1100 | 407.7 |
| max1600-jpeg78 | 69/70 | 0 | 776.1 | 1108 | 481.7 |
| max1600-jpeg80 | 67/70 | 0 | 766.1 | 1064 | 502.3 |
| max1600-jpeg90 | 69/70 | 0 | 798.8 | 1097 | 723.6 |

Frontend byl změněn na 1280/0.90: jediná z porovnaných komprimovaných variant
zachovala na všech fotografiích 7/7 a měla přibližně 472 KiB místo přibližně
940 KiB původních JPG. Tato simulace neověřuje přesný enkodér iOS canvasu;
živá kamera zůstává následným fyzickým testem.

## Testy, restart a kontrola frontendu

- Docker test stage: **29 passed**; matcher, API, metriky, ověření hashů,
  spojování fragmentů, odmítnutí vzdálených/nesouvisejících titulů, crop pořadí
  a souřadnice po rotaci.
- Node 22 build stage: syntax scanner.js, app.js, config.js a service-worker.js.
- `docker compose config`, `bash -n scripts/start-lan.sh`, `git diff --check`.
- PWA soubory včetně nových hodnot 1280/0.90 se skutečně servírují. Service
  worker cache byla zvýšena na v6. API se do ní neukládá.
- Restartován byl pouze vlastní kontejner. Všechny tři modely použily cached
  files bez stahování; metadata cache před/po jsou totožná: 84 souborů,
  108 381 083 bytů, SHA-256 cest/velikostí/mtime
  `6dddb8c0362b170ffdca77935725ac5c05eda19f0effcde146b4e1f3b16bc208`.
- Po restartu znovu prošel health i skutečná první fotografie se 7/7 (729 ms).
- Scoring engine zůstává původní. Přidávání používá `hand.addCard()` a
  `hand.limit()`; efekty speciálních karet nastavuje hráč. Scanner posílá
  framy sériově. Historické temporal thresholds a osmivteřinový cooldown se
  neměnily; nad skutečným videem zatím nebyly kalibrovány.
- Mapování overlay pro `object-fit: cover` zůstává zachováno. Unit test nyní
  ověřuje zpětnou transformaci normalizovaných boxů pro 0, −15, 22 a 90°.

## Co bylo změněno

1. Nový ground truth přímo z přečtených 16 obrázků; oddělené photo/original
   metriky a kontrola shody konkrétních souborů pomocí SHA-256.
2. Geometrické spojení rozděleného titulku bez oslabení matcheru.
3. Naměřené dva OCR průchody, detector max 960 / box threshold 0.50 a
   vyřazování nevhodných cropů před recognition; připnutý PaddleX 3.6.1.
4. Frontend 1280 px / JPEG 0.90 a cache v6 podle kompresního porovnání.
5. Ochrana celého `testovaci-data/`, fixtures a lokálních debug měření před
   Gitem a Docker build contextem; aktualizovaný report a dokumentace.

## Isolation verification

Hostitelský port 18080 byl výslovně povolen aktuálním zadáním. Před každou
aktualizací/restartem byly ověřeny přesné ID našeho kontejneru, Compose workspace,
Docker binding a `ss`. Žádný cizí proces na portu se nezastavoval. Položky
Existing containers níže označují ostatní aplikace serveru.

```text
Workspace used: /home/postulka/deploy/tajuplne-rise
Container created/updated: tajuplne-rise-remastered-ocr
Docker network used: tajuplne-rise-remastered-internal (own project only)
Docker volume used: tajuplne-rise-remastered-paddle-cache (own project only)
Published host ports: 192.168.0.249:18080/tcp -> container 8000/tcp (authorized)
Existing containers restarted: NONE
Existing containers stopped: NONE
Existing containers modified: NONE
Host packages installed: NONE
System configuration modified: NONE
Files modified outside project workspace: NONE
Caddy / DNS / HTTPS / firewall modified: NONE
Foreign networks / volumes used: NONE
Private photographs committed or included in image: NONE
External OCR API used: NONE
```

## Známé problémy a další kroky

- Na tomto datasetu nezůstala chybná ani chybějící detekce. Stejný dataset byl
  použit pro ladění; pro ověření zobecnitelnosti je potřeba další nezávislá sada
  odlesků, rozmazání, jiných úhlů a osvětlení. Nelze zaručit 100 % na všech scénách.
- Průměr fotografií je pod 1 s, ale 500ms cíl není obecně dosažen. Nejpomalejší
  fotografie má 1120 ms a devítikaretní předlohy přibližně 1.0–1.3 s.
- Změřit skutečné video, iOS JPEG enkodér, temporal tracking a boxy na telefonu.
  Kamera vyžaduje HTTPS; tato fáze nadále poskytuje pouze LAN HTTP pro testy
  uploadu a API. Caddy, DNS ani TLS se nekonfigurovaly.
- Budoucí změna PaddleX musí ověřit adapter crop fáze i kompletní regresi.
  Pro diagnostiku celých pravidel lze dočasně vypnout TITLE_PREFILTER;
  DEBUG_SAVE_FAILED_SCANS zůstává false.

Pracovní větev je pouze `feature/self-hosted-ocr`. Master ani PR #4 se nemerguje.
