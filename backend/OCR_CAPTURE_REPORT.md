# OCR oprava a zachycené fotografie — 29. 10. 2026

**HTTP 500 opraveno. Finální HTTP regrese: 37/37 požadavků úspěšných, 274/275 správných karet, 1 vynechaná karta, 0 falešných potvrzení.**

Nových 21 fotografií z archivu: zlepšení ze 134/151 správných a 2 false positives na 150/151 a 0 false positives. Původních 16 snímků zůstává na 124/124. Strojově čitelné výsledky, očekávané i detekované názvy a plné názvy souborů jsou v [OCR_CAPTURE_RESULTS.json](OCR_CAPTURE_RESULTS.json).

## Příčina HTTP 500

V původních provozních logách jsou dva neúspěšné skeny s `RuntimeError: std::exception` uvnitř `Paddle predictor.run()`. Model se vytvářel v hlavním vlákně a inference běžela v obecném AnyIO poolu. Pool po 10 sekundách nečinnosti smí měnit pracovní vlákna; jediný asyncio zámek bránil souběhu, ale nezajišťoval stejné vlákno. Health přitom vracel 200, protože sám inferenci neprovádí.

Při samostatné reprodukci ve stávajícím kontejneru se stejným modelem a fotografií první dvě nová pracovní vlákna uspěla, třetí vyvolalo tutéž výjimku. Podobný problém je popsaný také v [upstream hlášení PaddleOCR #16238](https://github.com/PaddlePaddle/PaddleOCR/issues/16238). Nejde o závěr odvozený pouze z tohoto hlášení; chyba byla reprodukována lokálně.

Inicializace, všechny inference a uvolnění prediktoru nyní patří jednomu stálému `ThreadPoolExecutor(max_workers=1)`. Event loop zůstává volný pro health a statické soubory. Souběžné skeny dál vracejí 429. Zrušený request drží zámek až do skončení skutečné inference, aby nevznikala fronta nativních úloh.

## Referenční data

- Deset původních fotografií: 70 čitelných titulů.
- Šest původních předloh: 54 titulů.
- Dvacet jedna nových zachycených JPEGů: 151 čitelných titulů, včetně snímků otočených o 90° a 180° a obou původně chybových fotografií.

Každá nová fotografie byla vizuálně přečtena přímo; očekávané názvy nejsou převzaté z OCR JSON. Nečitelné zakryté nebo na okraji uříznuté titulky se nehádají. Přesná odvozená kopie známé první testovací fotografie není v nových 21 snímcích. Některé fotografie zachycují stejnou sestavu opakovaně, proto nejde o 21 nezávislých scén. Data byla použita pro výběr konfigurace, nejde o nezávislý holdout.

Originály a OCR JPEGy zůstávají v soukromém `data/captures/`; do Gitu ani image nepřibyly žádné fotografie. Ruční popisky obsahují SHA-256 a vazbu na originál. `import_captured_fixtures.py` ověří hash a zkopíruje pouze ručně označené snímky do ignorovaného `backend/tests/fixtures/scans/captures/`.

## Změny rozpoznávání

Průchody 0° a −90° nahrazují 0° a −15°. Boční text tak dostane i vodorovný průchod; původní sada zachovává všechny správné detekce. Filtr titulku přizpůsobuje padding směru textu. Předchozí padding okolo svislého textu zasahoval do vzdálené ilustrace a mohl nesprávně přijmout světlý panel pravidel.

Fuzzy matching vyžaduje alespoň 80 % délky názvu; u názvů do čtyř písmen nesmí být přečtený text kratší než předloha. Tím zůstávají „Rytir“ z uříznutého okraje a halucinované „ral“ kandidáty namísto potvrzených Rytířek a Krále. Identita nadále vzniká výhradně z přečteného názvu, bez použití ilustrace, síly nebo barvy.

| Sekvenční experiment | Správně / 275 | FN | FP | Průměr ms |
| --- | ---: | ---: | ---: | ---: |
| Původní matching/padding, 0/−15°, HTTP po opravě vlákna | 258 | 17 | 2 | 805.0 |
| Přísnější matching a směrový padding, 0/−15° | 258 | 17 | 0 | 804.4 |
| Přísnější matching a směrový padding, 0/−90° | 274 | 1 | 0 | 737.1 |
| Stejné filtry, 0/−15/−90° | 274 | 1 | 0 | 1196.3 |
| Stejné filtry, 0/−90/−105° | 274 | 1 | 1 | 1274.2 |

První řádek je skutečný HTTP baseline. Další řádky sčítají časy jednotlivých průchodů téhož lokálního sekvenčního experimentu; konečné HTTP časy jsou níže. Další rotace nezlepšily recall a zvýšily náklady či FP. Snížení box threshold z 0.50 na 0.40 a 0.30 na problematické fotografii nepomohlo, proto se práh neměnil.

## Aktivní konfigurace

```text
PaddleOCR 3.6.0 / PaddlePaddle CPU 3.2.0 / PaddleX 3.6.1
PP-OCRv5_mobile_det / latin_PP-OCRv5_mobile_rec
detector max side=960, limit_type=max, box threshold=0.50
SCAN_ROTATIONS=0,-90
matching=78, high=92, margin=7, title coverage>=80%
MIN_OCR_SCORE=0.32, MIN_TITLE_STYLE=0.30, TITLE_PREFILTER=true
frontend longest side=1280, JPEG quality=0.90
container limits=2 CPU, 4 GiB, 128 PIDs, CPU threads=2
```

## Finální HTTP výsledky

| Sada | Snímky | Očekáváno | Správně | FN | FP | Průměr ms | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Původní fotografie | 10 | 70 | 70 | 0 | 0 | 761.3 | 1193 |
| Předlohy | 6 | 54 | 54 | 0 | 0 | 1078.8 | 1303 |
| Nové fotografie | 21 | 151 | 150 | 1 | 0 | 613.0 | 1107 |
| **Celkem** | **37** | **275** | **274** | **1** | **0** | **728.6** | **1213** |

Precision 100 %, recall 99.64 %. Nové fotografie mají recall 99.34 %. Všechny sedmikaretní ruce splňují alespoň 6/7; čtyři nové snímky obsahují osm čitelných karet a nejsou ořezané pevným limitem sedmi.

| Obrázek | Expected | Correct | Missed | FP | Processing ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| `foto/ChatGPT Image Oct 27, 2026, 07_21_40 PM.jpg` | 7 | 7 | 0 | 0 | 772 |
| `foto/ChatGPT Image Oct 27, 2026, 07_21_48 PM.jpg` | 7 | 7 | 0 | 0 | 848 |
| `foto/ChatGPT Image Oct 27, 2026, 07_21_55 PM.jpg` | 7 | 7 | 0 | 0 | 786 |
| `foto/ChatGPT Image Oct 27, 2026, 07_22_03 PM.jpg` | 7 | 7 | 0 | 0 | 1008 |
| `foto/ChatGPT Image Oct 27, 2026, 07_22_10 PM.jpg` | 7 | 7 | 0 | 0 | 1193 |
| `foto/ChatGPT Image Oct 27, 2026, 07_22_19 PM.jpg` | 7 | 7 | 0 | 0 | 817 |
| `foto/ChatGPT Image Oct 27, 2026, 07_22_27 PM.jpg` | 7 | 7 | 0 | 0 | 498 |
| `foto/ChatGPT Image Oct 27, 2026, 07_22_35 PM.jpg` | 7 | 7 | 0 | 0 | 517 |
| `foto/ChatGPT Image Oct 27, 2026, 07_22_42 PM.jpg` | 7 | 7 | 0 | 0 | 553 |
| `foto/ChatGPT Image Oct 27, 2026, 07_22_49 PM.jpg` | 7 | 7 | 0 | 0 | 621 |
| `originaly/ChatGPT Image Oct 26, 2026, 07_56_37 PM-1.png` | 9 | 9 | 0 | 0 | 990 |
| `originaly/ChatGPT Image Oct 26, 2026, 07_56_38 PM-2.png` | 9 | 9 | 0 | 0 | 854 |
| `originaly/ChatGPT Image Oct 26, 2026, 07_56_39 PM-3.png` | 9 | 9 | 0 | 0 | 1012 |
| `originaly/ChatGPT Image Oct 26, 2026, 07_56_40 PM-4.png` | 9 | 9 | 0 | 0 | 1101 |
| `originaly/ChatGPT Image Oct 26, 2026, 07_56_40 PM-5.png` | 9 | 9 | 0 | 0 | 1213 |
| `originaly/ChatGPT Image Oct 26, 2026, 07_56_41 PM-6.png` | 9 | 9 | 0 | 0 | 1303 |
| `captures/3d1681d5fad2…jpg` | 8 | 8 | 0 | 0 | 1107 |
| `captures/80e70d664473…jpg` | 7 | 7 | 0 | 0 | 566 |
| `captures/2d241e7e4c85…jpg` | 7 | 7 | 0 | 0 | 562 |
| `captures/4c9accf10c08…jpg` | 7 | 7 | 0 | 0 | 937 |
| `captures/455ae0ec836f…jpg` | 7 | 7 | 0 | 0 | 984 |
| `captures/167cb5741807…jpg` | 7 | 7 | 0 | 0 | 439 |
| `captures/2f7ba8038840…jpg` | 7 | 7 | 0 | 0 | 559 |
| `captures/690bd7bb5c32…jpg` | 7 | 7 | 0 | 0 | 417 |
| `captures/f8bfad129cf4…jpg` | 7 | 7 | 0 | 0 | 686 |
| `captures/7ec548aabf15…jpg` | 7 | 6 | 1 | 0 | 525 |
| `captures/dae9f1cd274a…jpg` | 7 | 7 | 0 | 0 | 441 |
| `captures/dc6047becbbb…jpg` | 8 | 8 | 0 | 0 | 1116 |
| `captures/3d81537f0aad…jpg` | 8 | 8 | 0 | 0 | 559 |
| `captures/02e62b10f9bf…jpg` | 7 | 7 | 0 | 0 | 503 |
| `captures/93f9e1153d77…jpg` | 7 | 7 | 0 | 0 | 448 |
| `captures/214aa1259fb1…jpg` | 7 | 7 | 0 | 0 | 412 |
| `captures/77fe8b5d904b…jpg` | 7 | 7 | 0 | 0 | 509 |
| `captures/46062506684d…jpg` | 7 | 7 | 0 | 0 | 605 |
| `captures/d1eff92e0fbc…jpg` | 8 | 8 | 0 | 0 | 476 |
| `captures/67811bfd14a6…jpg` | 7 | 7 | 0 | 0 | 535 |
| `captures/e1f5b52cc229…jpg` | 7 | 7 | 0 | 0 | 487 |

## Známý zbývající problém

`captures/7ec548aabf15…jpg`: Les není rozpoznán (6/7), zbývající tituly jsou správné. Při zkoušených rotacích a nižším box threshold se nevytvořil dostatečně spolehlivý OCR název. Karta se nedoplňuje odhadem; lze ji přidat existujícím ručním vyhledáváním. Stejnou sestavu z jiného záběru skener čte 7/7.

## Ověření a izolace

- 44 Python unit/API testů prošlo v Docker build stage, včetně původu a následného použití modelu ve stejném vlákně, souběžných requestů, health během inference a zrušení requestu.
- Skutečná sekvenční HTTP regrese všech 37 obrázků: 0 chybových requestů, žádné chybějící soubory.
- Automatické ukládání zůstává aktivní; oba původně chybové snímky nyní vracejí HTTP 200, 7/7 a potvrzené uložení.
- Oba chybové snímky znovu prošly po 13 sekundách nečinnosti a mezilehlých statických requestech (545/499 ms, vždy 7/7), tedy za hranicí původního desetisekundového střídání AnyIO workerů.
- Po restartu vlastního kontejneru prošly znovu oba snímky (737/551 ms, vždy 7/7). Všech 59 archivovaných obrázků přežilo restart se shodným SHA-256; modely se načetly z původní cache bez stahování.
- Jediný runtime kontejner/service, binding pouze `192.168.0.249:18080 → 8000/tcp`. Před každou výměnou ověřeny Docker publikace, identita vlastního kontejneru a `ss`.
- Zásahy pouze do vlastního workspace a kontejneru. Žádné instalace balíčků na hostu, žádné změny jiných aplikací, jejich sítí/volume, Caddy, DNS, HTTPS nebo firewallu.
- Výsledky měří OCR nad fotografiemi; nejde o fyzický test živé kamery telefonu.
