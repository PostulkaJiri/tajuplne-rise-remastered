# Mobile scanner UX — 27. 10. 2026

Hlavní rozhraní je jedna obrazovka bez scrollování: horní banner obsahuje
počet karet a skóre, střed se postupně plní snapy karet a spodní kamerová část
má 31 % dynamické výšky viewportu, maximálně 270 px. Na nízkých obrazovkách
používá 30 %. Pod bannerem jsou nyní tlačítka Přidat kartu ručně a Odebrat všechny.
Ruční vyhledávání má vlastní dialog a nemění rozložení hlavní obrazovky.
Tlačítka start/stop a panel s OCR implementací zůstávají odstraněné.

Karty nyní používají malé náhledy celých originálních karet ze šesti dodaných
předloh, včetně titulku, ilustrace a pravidel. Obrázky mají `object-fit: contain`,
aby se žádná část karty neořízla. Zdrojové PNG jsou jen v soukromém workspace
`data/card-originals/` a do kontejneru jsou připojeny read-only; generují se z nich
pouze malé WebP obrázky. Nejsou součástí Gitu ani Docker image.

Scoring engine a herní limit zůstávají původní. Ruční přidání používá
`hand.addCard()`. Odebrání všech vyčistí počet i skóre a potlačí staré viditelné
karty, dokud nezmizí z obrazu. Po resetu se ignorují dříve zahájené požadavky;
nově pořízená fotografie může začít další ruku. Uložené fotografie se nemažou.

## Fotoaparát

Původní stránka spouštěla kameru až tlačítkem. Na dodané adrese
`http://192.168.0.249:18080` navíc browser `getUserMedia` nepovolí a nemůže ani
zobrazit žádost o kameru. HTTPS origin je podmínkou pro živou kameru na
telefonu: [MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

Nová stránka na zabezpečeném originu požádá o kameru automaticky při otevření.
Video je `autoplay`, `muted`, `playsinline`; audio se nevyžaduje. Neúspěšné
spuštění videa uvolní stream. Skrytí stránky a pagehide zastaví kameru i
požadavky. Po návratu se dostupná živá kamera obnoví.

Na HTTP a po zamítnutí oprávnění je aktivní celá spodní plocha: klepnutím se
otevře systémové focení/výběr souboru. Soubor se v prohlížeči převede na JPEG 0.90, nejvýše 1280 px, a analyzuje místním backendem
a výsledek přidá snapy i skóre. Pro tento postup není potřeba měnit Caddy ani
HTTPS. Chování systémového výběru/focení závisí na telefonu a browseru:
[HTML capture](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture).

HTTPS / Caddy / DNS / firewall nebyly upraveny. Automatický živý náhled na
současné HTTP adrese tak zůstává blokovaný pravidlem prohlížeče; není vydáván
za otestovaný nebo vyřešený pomocí změny JavaScriptu.

## Viditelná oblast a tracking

Živý JPEG se nyní pořizuje z přesného středového výřezu, který uživatel vidí
v dolním kamerovém panelu s `object-fit: cover`. OCR boxy se mapují do stejného
výřezu. Při změně poměru stran se staré boxy vyčistí. Obrázek karty se vybírá podle potvrzeného FR ID z originálních předloh.
Zastaralý track se nepoužije pro nové automatické přidání.

Požadavky jsou sériové; při nedostupném health endpointu se spojení opakuje.
Zachován je původní temporal tracking a osmivteřinový cooldown ručně odebrané
karty. Přidávání vždy používá `hand.addCard()`, bez pevného limitu sedmi.

## Browser ověření

Testy používají Chromium v oddělené Docker build stage, Node 22 a připnutý
Playwright Core 1.56.1. Nevzniká další runtime service ani publikovaný host port.
Obraz je vygenerovaný testovací canvas, OCR odpovědi jsou simulované.

Ověřeno:

- žádost o kameru při otevření stránky bez kliknutí, s `audio: false`;
- živý video stream a zachycení pouze viditelného výřezu;
- osm snapů, správný počet a skóre původního enginu, osmá karta s Nekromantem;
- nastavení Knihy proměn a odebrání karty bez okamžitého vrácení;
- nejvýše jeden souběžný scan request, obnovení po HTTP 503 a zastavení streamu při skrytí stránky;
- HTTP origin bez žádosti o nepovolenou živou kameru a funkční file/capture OCR;
- převod velké nativní fotografie na naměřený JPEG 1280/0.90;
- bezpečný přechod na focení po `NotAllowedError`;
- viewporty 390×844, 375×667, 320×568, 844×390 a 360×640, bez přetékání stránky;
- všechny snapy uvnitř horní oblasti, kamera pod třetinou výšky;
- žádné JavaScript page errors.

Test není fyzické ověření iOS oprávnění, hardwarové kamery nebo Safari.
Backendové výsledky 124/124 ze skutečných fotografií nadále popisuje
[OCR_REPORT.md](../backend/OCR_REPORT.md); zde se testuje frontendová integrace.

## Nasazení

Nové HTML/JS/CSS a service-worker v8 ověřeny přes LAN HTTP 200. Po aktualizaci
vlastního kontejneru je health `healthy`; skutečná první fotografie z regresní
sady po převodu na JPEG 1280/0.90 vrátila správných 7/7 za 713 ms. Binding zůstává pouze
`192.168.0.249:18080 -> 8000/tcp`. Ostatní služby a síťová infrastruktura se
neměnily.

## Ukládání fotografií

Na výslovný požadavek uživatele je zapnuté `SAVE_CAPTURED_IMAGES=true`.
Původní fotka se uloží před OCR, následně také skutečný zmenšený JPEG vstup.
Živé framy se ukládají při `/api/v1/scan`, včetně snímků bez přijatých karet
nebo s chybou OCR. JSON obsahuje čas, zdroj, predikce a vazbu na originál.
Data jsou v projektovém `data/captures/`, mimo Git, image a HTTP statické cesty.
SHA-256 odstraňuje přesné duplicity. Archiv přežije výměnu kontejneru.

Kapacita je 5 GB s 2GB rezervou volného disku; žádné automatické mazání starších
snímků. Při nemožnosti zápisu UI oznámí problém a OCR pokračuje. JSON predikce
jsou označené jako predikce a nesmějí se vydávat za ručně ověřený ground truth.

Doplněné testy ověřují celé náhledy a všechny FR01–FR54 v manifestu, přesné
uchování původních bytů, deduplikaci, navázání OCR na originál, přežití otevření
archivu po restartu, kapacitu bez mazání, HTTP limity a ukládání chybových
snímků. Browser testy navíc ověřují ruční hledání bez diakritiky, obě tlačítka,
reset během rozpracované fotografie a ochranu proti vrácení staré ruky.

Finální Docker test stage: 39 Python testů prošlo. Browser testy prošly na
všech pěti velikostech. Přes skutečné LAN API bylo ověřeno všech 54 WebP
náhledů a podmíněné načtení přes ETag; vizuální kontrola odhalila nestejné
rozměry karet na předlohách. Manifest proto používá jednotlivě naměřené
hranice v mezerách místo rovnoměrného dělení na třetiny.

Skutečná fotografie byla uložena jako původní soubor (994 176 bytů) a OCR JPEG
(571 704 bytů); oba soubory odpovídají odeslaným bytům. JSON obsahuje správnou
vazbu originál–OCR vstup a sedm predikcí. Opakovaný originál zachoval stejný
soubor bez přepisu. Po plné výměně kontejneru zůstaly oba obrázky i metadata
nezměněné. Původní listy a archivní HTTP cesty vracejí 404. Archiv zatím
obsahuje tento známý testovací vzorek; nejde o novou nezávislou validační sadu.
