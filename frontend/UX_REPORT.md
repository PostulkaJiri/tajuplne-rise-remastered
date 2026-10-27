# Mobile scanner UX — 27. 10. 2026

Hlavní rozhraní je jedna obrazovka bez scrollování: horní banner obsahuje
počet karet a skóre, střed se postupně plní snapy karet a spodní kamerová část
má 31 % dynamické výšky viewportu, maximálně 270 px. Na nízkých obrazovkách
používá 30 %. Tlačítka start/stop, ruční vyhledávání, upload panel a informace
o OCR implementaci byly z hlavního rozhraní odstraněny.

Snap je skutečný výřez snímku, ze kterého byla karta rozpoznána. Snímky se
dochovávají pouze v paměti stránky. Identita stále pochází výhradně z OCR
názvu. Scoring engine, herní limit ruky a backend OCR nebyly přepsány.
Klepnutí na snap otevře detail karty pro odebrání a speciální efekt.

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
výřezu. Při změně poměru stran se staré boxy vyčistí. Snap se pořizuje ze
stejného uloženého framu, ne z pozdějšího videa po doběhnutí HTTP požadavku.
Zastaralý track se nepoužije jako podklad pro nově přidávaný snap.

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

Nové HTML/JS/CSS a service-worker v7 ověřeny přes LAN HTTP 200. Po aktualizaci
vlastního kontejneru je health `healthy`; skutečná první fotografie z regresní
sady znovu vrátila správných 7/7 za 745 ms. Binding zůstává pouze
`192.168.0.249:18080 -> 8000/tcp`. Ostatní služby a síťová infrastruktura se
neměnily.
