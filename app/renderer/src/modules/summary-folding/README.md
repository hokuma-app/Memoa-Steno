# Samenvatting vouwen (TextFold)

De lezer van [TextFold](https://github.com/chenxiachan/textfold) (Apache-2.0, commit `5062eacc0b1e2a2528e0906414f5073033051a30`, auteur Xia Chen), overgenomen voor de samenvatting: elk woord dat blijft schuift naar zijn nieuwe plek en de rest vervaagt eromheen, zoomen onder de vingers (scroll en pinch op de balk, schuifbalk met verschuivende duim, toetsen 1 tot 5, halverwege stoppen en terugdraaien) en de Onderwerpen als kaarten per onderdeel.

**Licentie en herkomst.** `textfold/LICENSE` en `textfold/NOTICE` zijn ongewijzigde kopieen. Elk overgenomen bestand (`textfold/reader.js`, `textfold/reader.css`, `src/textfold_tokens.py`, `src/textfold_ladder.py`) begint met de bron-URL, de commit en 'Modified by Veneta MemoAi'. Welke regels letterlijk zijn overgenomen en wat is aangepast staat in `textfold/PORTING.md`; de afleiding is herhaalbaar met `textfold/tools/` (`TEXTFOLD_SRC=<clone> python3 textfold/tools/make_reader.py textfold/reader.js textfold/tools/tail.js.txt`).

## Niveaus

Volledig, Beknopt, Kern, Kernzin, Onderwerpen zijn TextFold's Full, Brief, Key, Takeaway, Topic:

1. **Volledig**: de canonieke notitie (samenvatting, bespreekpunten en kernpunten, of het gekozen rapport), niet het transcript.
2. **Beknopt**: de bewijszinnen (`ev`), letterlijk uit die samenvatting. Het zijn citaten uit de samenvatting, geen bewezen gesproken woorden.
3. **Kern**: de geschreven regel (`brief`): kernzin plus een zin reden. Elk woord dat ook in een bewijszin staat draagt `m`, het token waaruit het schuift.
4. **Kernzin**: de eerste `tn` tokens van `brief`.
5. **Onderwerpen**: het onderwerp (`topic`, woorden dragen `k`) per eenheid, als chips op een kaart per onderdeel; een onderdeel met meerdere eenheden heeft een eigen regel (`lad.take`).

## Gegevens (schemaVersion 2)

Elke sectie bestaat uit eenheden (`units`): een alinea, een lijstitem of een kop, zoals in TextFold. Een eenheid heeft `toks` (woorden en leestekens; `s` = er volgde een spatie), `sents` (tokenbereiken), en `lad` met `ev`, `brief`, `tn`, `topic`, `role`, `model`. `src/textfold_tokens.py` en `src/textfold_ladder.py` leggen de modelregels deterministisch op de tokens van de bron; het model levert alleen takeaway, key (takeaway plus reden), topic en bewijsindices. De host (`app/summary-folding-ipc.js`, `validateDocument`) controleert strikt: de bronregels samen zijn exact de sectietekst, de woorden van een eenheid zijn de woorden van haar bronregel (alleen Markdown-tekens mogen weg), de zinsbereiken sluiten aan, `ev`, `m` en `k` liggen binnen bereik en `m` wijst alleen naar bewijszinnen.

## Voorlopig en AI

De niveaus zijn er altijd direct: zonder AI maakt `summary-fold --local` (TextFold's local-modus: de eerste zin van de auteur, ingekort; `provenance: "local"`) alle vijf niveaus, zonder model en zonder download. Op de achtergrond (een run tegelijk, annuleerbaar, voortgang in de pil) maakt de ingestelde aanbieder de AI-niveaus; die verschijnen als morph over de lokale niveaus en worden opgeslagen, gebonden aan de bronhash en de vingerafdruk van de notitie. Mislukt dat, dan blijven de lokale niveaus staan en toont de pil een inhoudsvrije reden.

## Onderdelen

- `textfold/reader.js`: `mountTextFold(root, data, opts)`, TextFold's FLIP, ghosts, stage-keyframes, continue zoom en balk. `opts.scroller` is het element dat scrolt (TextFold: het venster).
- `textfold/reader.css`, `textfold/theme.css`: TextFold's stijlen onder `.tf-root`, met de thema-variabelen van de app (licht en donker). `prefers-reduced-motion`: de lezer schakelt de animatie uit en wisselt direct.
- `paperData.ts`: het vouwdocument in TextFold's eigen paper-data (chunks, units, blocks).
- `TextFoldReader.tsx`: React-mount; een document met dezelfde bron en andere niveaus gaat via `setData` naar de lopende lezer, die er naartoe morpht.
- `components/SummaryFoldingPanel.tsx`: laden, lokale niveaus, achtergrondrun, voortgang, annuleren; de pil staat vast onderin (`.summary-fold-dock`, z-45, boven de dock-fade z-40).

## Kopiëren en sprekernamen (0.10.2)

- **Kopieer notitie** kopieert wat zichtbaar is: het gekozen niveau van de gekozen versie (de notitie of het open rapport) als Markdown, uit het document dat de lezer toont (`foldCopy.ts`), nooit uit de DOM, dus zonder verborgen tekst of morph-tussenframes. Bij Volledig, of zolang de lezer geen niveaus heeft, is het de hele notitie. **Kopieer volledige notitie** (Meer opties) kopieert altijd de hele notitie. Onder de gevouwen tekst staan actiepunten en deelnemers; die gaan mee in de kopie van een lager niveau.
- **Sprekerlabels worden namen** bij weergave en kopie (`lib/speakerNames.ts`): 'Speaker 2', 'Spreker 2', 'SPEAKER_02' worden de gekoppelde naam, 'Speaker 20' blijft ongemoeid. De host (`app/speaker-label-names.js`) leidt de koppeling af uit het sprekerbestand en het transcript; opgeslagen samenvattingen en vouwniveaus worden niet herschreven. In de lezer krijgt het eerste token van het label de naam en de rest van het label lege tekst, zodat het aantal tokens (en dus `m`, `k` en de zinsbereiken) gelijk blijft. Een andere koppeling is een andere weergave: de lezer wordt opnieuw opgebouwd op het gekozen niveau.

## Verificatie (vanuit `app/`)

```sh
./node_modules/.bin/vitest run renderer/src/modules/summary-folding renderer/src/components/SummaryFoldingPanel.test.tsx
SUMMARY_FOLD_BROWSER_CHANNEL=chrome ./node_modules/.bin/playwright test --config renderer/src/modules/summary-folding/browser/playwright.config.ts
```

`browser/oracle.spec.ts` zet dezelfde synthetische samenvatting (673 woorden, `browser/oracle-doc-*.json`) in TextFold's eigen reader (lokale clone, `TEXTFOLD_SRC`) en in deze module en vergelijkt per niveau de stukken (`data-id`), per overgang hoeveel blijven, vervagen en verschijnen, dat de stage voor elke overgang klaarstaat, en de einduitkomst van scroll, pinch en toetsen. Frames op 0, 25, 50, 75 en 100 procent komen in `$TMPDIR/fold092/oracle`. De Electron-proef staat in `e2e/specs/summary-folding.t1.spec.ts`. Alleen synthetische data; geen modellen.
