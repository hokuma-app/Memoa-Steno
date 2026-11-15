# Wat is overgenomen uit TextFold

Bron: https://github.com/chenxiachan/textfold, commit 5062eacc0b1e2a2528e0906414f5073033051a30 (Apache-2.0). Alles is gemaakt door `tools/make_reader.py` en `tools/make_css.py` uit die clone: de gekopieerde regelbereiken staan hieronder, niets is met de hand herschreven behalve de genoemde aanpassingen.

## reader.js (textfold/web/reader.js)

| Regels upstream | Inhoud | Aanpassing |
| --- | --- | --- |
| 117-126 | `view()` | vertalingen weg |
| 127-352 | `pieces()`, `fill()`, `renderUnit()`, `drawUnit()`, `textHtml()` | markeringen, zoeken en Thai-regels weg of uitgeschakeld; CJK-takken ongewijzigd en inactief |
| 427-428, 443-457, 459-472 | `h`, `esc`, `tokEl`, `toksHtml`, `unitNode` | geen |
| 677-764 | `renderAll`, stale-wachtrij, `bandAround`, `hydrate` | geen |
| 765-1073 | FLIP: `snapshot`, `buildMotion` (ghosts, fadeIn, fadeOut), `morph`, continue zoom (`prepare`, `scrub`, `finish`, `revert`, `apply`, `tick`, `release`, `rest`, `zoomBy`, `setLevel`) | selectiebalk en notitiepop-up weg |
| 1074-1133 | de stage in een gesloten shadow-tree, `shadowSheet` | selectors van `html` naar `.tf-root` |
| 1134-1678 | keyframes (`collect`, `keep`, `buildPair`, `sandbox`, `captureAt`, `warm`, `stageBegin`, `enterPair`, `stageFrame`, `stageCommit`), scroll- en pointerluisteraars | sandbox-breedte uit de kolom in plaats van de body; `clipStage` begrenst de stage tot de kolom; scroller in plaats van het venster |
| 1691-1704 | `toggleUnit`, `defaultAnchor` | geen |
| 4065-4137 | de balk als segmented control met verschuivende duim (`measureBar`, `placeThumb`, `posAt`, slepen) | labels uit de host, `onLevel` |
| 4482-4500 | wiel en pinch (`wheel`, `gesturestart/change/end`) | luisteraars via `listen` |

Zelf geschreven (kort): de mount-functie, `build()` (TextFold's `build` voor kop en eenheid), `renderStake`/`renderHeads`, toetsen 1 tot 5 (met de beschermde invoervelden van de host), klik op een eenheid, de start, `setData` en `destroy` (`tools/tail.js.txt`). Niet overgenomen: vertalingen, notities en markeringen, Zotero, PDF naast tekst, vragen aan AI, links en kanttekeningen, tutorial, zoeken, opslaan, het Aa-menu, het focus-venster, de Topic-mindmap (de kaarten wel).

## reader.css (textfold/web/reader.css)

Regels 130-162 (balk), 193-336 (stage, kolom, eenheden, Topic-kaarten, lijsten) en 437-440, alle selectors onder `.tf-root`, eigenschappen met voorvoegsel `--tf-`. Weggelaten: palet, afdrukken, breedte- en lettertype-keuzes, CJK, figuren, formules, links, notities, chat.

## Python (textfold/tokens.py en textfold/ladder.py)

`src/textfold_tokens.py` is `tokens.py` met Nederlandse afkortingen en kleine initialen in het zinssplitsen. `src/textfold_ladder.py` neemt `clean`, `written`, `locate`, `is_word`, `head_words`, `assemble`, `align`, `topic_tokens` en `local` over (zonder CJK, apparatuur en de modelaanroep) en voegt `parse_units` en `plain_inline` toe voor de Markdown-samenvatting.

## Aanpassingen van Veneta MemoAi na de port

- `unitNode`: de lijstmarkering wordt met `esc()` geschreven (voorheen rechtstreeks als HTML). `paperData.ts` laat daarnaast alleen markeringen van de vorm `-`, `*`, `+`, `1.` of `12)` door.
- `src/textfold_ladder.py` (`written`): `$...$` en `⟦a1⟧` in modeltekst worden alleen een atoom als de eenheid dat atoom heeft; anders blijft het gewone tekst. Zo maken een paar dollartekens geen formuletoken dat het hele AI-document laat afkeuren.
