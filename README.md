# Tajuplné říše – Remastered

Mobilní fan-made scorer pro základní sadu 54 karet (FR01–FR54).

## MVP

- přímý přístup k zadní kameře mobilu přes HTTPS / GitHub Pages,
- OCR českých názvů pomocí Tesseract.js,
- fuzzy matching pouze proti uzavřenému registru 54 názvů,
- ruční fallback při chybném rozpoznání,
- scoring přes původní open-source engine,
- konfigurace speciálních karet Ostrov, Kniha proměn, Měňavec, Přelud a Dvojník,
- dynamický limit ruky včetně pravidla Nekromanta,
- PWA/service worker pro vlastní statické soubory.

## Lokální spuštění

Aplikace je čistě statická. Kvůli kameře ji nespouštěj přes `file://`.

```bash
python -m http.server 8080
```

Pak otevři `http://localhost:8080`.

## GitHub Pages

Po mergi do výchozí větve nastav v repozitáři:

`Settings → Pages → Deploy from a branch → master / (root)`

Výsledná adresa bude typicky:

`https://postulkajiri.github.io/tajuplne-rise-remastered/`

## OCR

První OCR načte Tesseract.js a český jazykový model z internetu. V další iteraci lze worker i jazyková data uložit přímo do repozitáře pro plně offline režim.

## Licence

Scoring engine v `js/deck.js`, `js/hand.js` a `js/discard.js` pochází z projektu `fantasy-realms/fantasy-realms.github.io` a zůstává pod jeho MIT licencí. Viz `THIRD_PARTY_NOTICES.md`.
