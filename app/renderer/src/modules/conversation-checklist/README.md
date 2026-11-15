# Module Gesprekschecklist

De module staat standaard uit en werkt alleen in het Veneta-profiel. Uitgeschakeld betekent: geen leesacties, geen modelaanroepen en geen bestanden.

## Drie momenten (0.9.3)

1. **Voor (Home)**: één kaart, `ChecklistChoiceCard`, met een keuzelijst: de vaste Veneta-standaard `Adviseur Gesprek` (slotje), eigen checklists en `Geen checklist`. De keuze wordt klaargezet (`checklist-preparation.json`) en blijft bewaard tot je haar wijzigt. Eigen checklists maken, bewerken en verwijderen mag; een eigen checklist mag niet de naam van de standaard (of van een andere eigen checklist) krijgen. Recente notities tonen `Checklist 7/8` (`ChecklistScoreBadge`, besproken/totaal) als de notitie een resultaat heeft.
2. **Tijdens (opname)**: de host plant en voert de controle uit (zie Host-planner hieronder); `ChecklistRuntime` toont alleen de toestand die de host meldt, in `ChecklistSidebar` naast de notities: naam, teller `x / N`, voortgangsbalk, statusregel, een kleine inhoudsvrije diagnoseregel en de punten (open cirkel, half, vinkje) met citaat, tijd en spreker. Een klik op een punt scrolt naar het citaat in het transcript als dat open staat. De AI-controle staat **automatisch aan** zodra er een checklist klaarstaat: geen opt-in per gesprek, geen handmatig afvinken en geen bewerkbare criteria in de zijbalk. Het vorige resultaat blijft zichtbaar tot het volgende er is.
3. **Na (notitie)**: de tab `<naam checklist> <score>` in `MeetingDetail` (`ChecklistNoteTab`), alleen als de notitie een resultaat heeft: samenvattingspills, per punt niveau (niet gehoord, genoemd, uitgelegd, uitgelegd + klant bevestigd), citaten en knop `Kopieer`. De enige menselijke acties: `Onterecht? Afwijzen` op een AI-vinkje (punt terug naar niet gehoord, gemarkeerd als afgewezen door mens, met reden en herleidbaar naar het AI-bewijs) en `Niet van toepassing` met reden.

## Vaste standaard zonder verzonnen inhoud

`app/veneta-standard-checklists/*.json` zijn alleen-lezen definitiebestanden in de app-bundel (`id`, `name`, `version`, `locked: true`, `criteria`). `app/veneta-standard-checklists.js` valideert ze strikt (zelfde grenzen als criteria: maximaal 32 punten, 24000 tekens; ongeldige of dubbele bestanden worden genegeerd). Zolang `criteria` leeg is toont de keuzelijst `Adviseur Gesprek` als niet kiesbaar met `Inhoud volgt van Veneta`; een update met alleen dat JSON-bestand volstaat. De standaard kan niet worden overschreven, hernoemd, bewerkt of verwijderd, ook niet via IPC. Een klaargezette standaard volgt de meegeleverde definitie; wordt die leeg, dan staat er niets meer klaar.

## Verkoperskanaal

Microfoon (`You`) is de verkoper en systeemgeluid (`Others`) de klant, als vaste standaard. In Instellingen, Product en modules, staat `Mijn microfoon is de verkoper` (standaard aan, `checklist-settings.json`). Uit betekent: onbekende sprekers, de AI kan een punt alleen als genoemd markeren en de zijbalk zegt dat.

## Resultaat bij de notitie

De host kent bij het stoppen van een opname het notitiebestand (de voortgezette notitie of het deterministische samenvattingsbestand van deze opname) en koppelt dan het klaargezette gesprek eraan (`bindSessionToNote` in `app/veneta-product-ipc.js`, aangeroepen in `stop-recording-ui`). De koppeling is een sidecar `veneta-modules/note-results/<sleutel>.json`, gesleuteld op de notitie-identiteit (map via realpath plus bestandsnaam). Er wordt niet gegokt: een andere opname, geen checklist, een uitgeschakelde module of een niet-absoluut pad geven geen koppeling. De canonieke notitie, het transcript en de samenvatting worden nooit gewijzigd. Resultaten uit 0.9.2 (`drafts/`, `overviews/`, `checklists/`) blijven staan; handmatige statussen uit 0.9.2 worden getoond als genegeerd en tellen niet mee.

Host-kanalen (`app/veneta-product-ipc.js`, preload `checklists.*`): `listTemplates`, `saveNamedTemplate`, `deleteNamedTemplate`, `prepare`, `clearPreparation`, `attachPrepared`, `evaluate`, `getSettings`, `setSettings`, `noteResult`, `noteScores`, `correctNote`. De oudere kanalen (`getDraft`, `saveDraft`, `overview`, `exportOverview`, `listOverviews`) blijven bestaan; `saveDraft` weigert handmatige statussen.

## Onderbouwing en grenzen

`groundEvaluation` controleert revisies, identiteiten, tijdstippen en letterlijke citaten. Een citaat is minimaal een heel woord en minimaal drie tekens (woordgrens), in de renderer, de host en de Python-backend. Een positief AI-oordeel vereist het verkoperskanaal en controleerbare verkoperscitaten. Dit bewijst herkomst, niet de juistheid van de betekenis; een echt citaat kan inhoudelijk irrelevant zijn. De invoer van een controle is begrensd op 32 punten, 256 definitieve segmenten en samen 24.000 teksttekens. Een te lang gesprek wordt nooit uit het midden ingekort: de host leest de nieuwste aaneengesloten staart die binnen het budget past (zie Host-planner); past zelfs de nieuwste regel niet, dan blijft de bestaande status 'te veel tekst' staan.

De backend gebruikt alleen de lokaal toegestane provider, zonder modeldownload, cloudfallback, externe acties, omgevingsproxy of HTTP-redirect. Staat Ollama niet aan, dan start de checklist de al geïnstalleerde dienst (`serve`, nooit een pull). Bij het stoppen start de host een laatste controle over de nog niet beoordeelde tekst (zie Host-planner).

## Host-planner (0.9.4)

Waarom: in 0.9.3 zat de planning (stabiele tekst, maximale wachttijd, een poging per momentopname) in React-componenten (refs en timers in `ChecklistSidebar`). Zodra zo'n component opnieuw werd opgebouwd, of zijn timers werden gesmoord, begon alles opnieuw en werd er bij echt gebruik nooit een punt beoordeeld. De planning staat nu in `app/veneta-live-checklist.js`, in het hoofdproces, per actieve opname, onafhankelijk van de levensduur van componenten.

- **Start**: `start-recording-ui` roept `venetaProduct.live.begin` aan. Alleen bij ingeschakelde module en een klaargezette checklist wordt de checklist aan de opname gekoppeld (zelfde idempotente koppeling als voorheen, nu door de host; de sessiesleutel is `recording:<starttijd>` of, bij doorgaan in een notitie, `note:<hash van het realpath>`). Module uit betekent: geen koppeling, geen leesactie van checklistbestanden, geen modelaanroep, geen planner.
- **Planning**: elke nieuwe final in de live-buffer (`bufferLiveSegment` in `main.js`) roept `live.notify` aan. Na 10 s zonder nieuwe tekst, uiterlijk 30 s na de eerste nog niet beoordeelde final, loopt een controle. Single-flight, ook gedeeld met de handmatige evaluatieroute (een bezette plek wordt na 5 s opnieuw geprobeerd en telt niet als fout). Een mislukte controle wordt pas opnieuw geprobeerd bij nieuwe tekst.
- **Bron en grenzen**: de host leest zijn eigen buffer (vorige opname in dezelfde notitie plus definitieve segmenten), met dezelfde segment-id's als voorheen, de instelling `micIsSeller` per controle en alleen de bestaande lokale route (`veneta-checklist-evaluate` intern: moduleschakelaar, validatie, alleen lokaal Ollama, geen download, geen cloud). Past de tekst niet in 256 segmenten en 24.000 tekens, dan leest een controle de nieuwste aaneengesloten staart die past. Een punt dat een eerdere controle al als genoemd of uitgelegd vond, behoudt die bevinding met zijn eigen citaatsegmenten tenzij het nieuwe venster iets sterkers zegt of hetzelfde citaat opnieuw beoordeelt (een punt kan dus bijkomen, niet stilzwijgend verdwijnen door een schuivend venster). Bij een gewijzigde luidsprekerkoppeling wordt niets overgenomen. Dubbele punten (hoofdletters en spaties genegeerd) tellen als een punt.
- **Toestand**: per sessie in het geheugen van de host (fase: geen tekst, wacht, bezig, laatst hh:mm, fout met redencode, te veel tekst, laatste controle bezig, afgerond; tellers; laatste reden; resultaat). Bij elke wijziging pusht de host het event `veneta-checklist-live-state` (met oplopend `seq`); dezelfde toestand is opvraagbaar bij mount (`checklists.liveState`, kanaal `veneta-checklist-live-state`). Een remount of routewissel verliest dus niets; een oudere momentopname vervangt nooit een nieuwere push.
- **Laatste controle bij stoppen**: `stop-recording-ui` koppelt de notitie en start `live.finish`: na een korte gunstperiode (3 s, voor de laatste uiting die de sidecar nog uitschrijft) controleert de host de nog niet beoordeelde tekst en schrijft het resultaat in hetzelfde sessiebestand. `noteResult` meldt `finalRunning` zolang dat loopt; de notitietab toont dan 'De laatste controle van dit gesprek loopt nog' en ververst zichzelf elke 2,5 s. Is alles al beoordeeld, dan zegt stoppen niets. Een uiting die pas na die gunstperiode binnenkomt, valt buiten de laatste controle.
- **Diagnose zonder inhoud**: onder de status staat `tekstregels N · controles N · laatste reden X`, en dezelfde gebeurtenissen gaan als `[checklist] ...` naar het bestaande app-debuglog (`sendDebugLog`). Alleen tellers en redencodes (`stil`, `maxwacht`, `stop`, `busy`, `te_veel_tekst` of een foutreden zoals `model_missing`); nooit transcripttekst, criteria of citaten.
- **Dubbele criteria**: de editor voegt dubbele punten samen en meldt dat ('2 dubbele punten worden samengevoegd'); de host weigert het bewaren van een lijst met dubbele punten (`duplicate_criteria`), toont oude lijsten zonder dubbelen en zet elk punt maar een keer klaar; de zijbalk toont nooit twee keer hetzelfde punt.

## Teksten en controles

De Nederlandse modulecatalogi zijn `checklistText` (foutadvies), `runtimeText` en `productText`; `overviewText` combineert de eerste twee. De bestaande inventaris- en lintregels zijn niet verruimd.

```sh
npm --prefix app run test:unit:renderer -- renderer/src/modules/conversation-checklist
```

Modelvrije tests bewijzen contracten, opslag, broncontrole, gebruikershandelingen en verouderde antwoorden. Electron T1 (`e2e/specs/veneta-product-modules.t1.spec.ts`) gebruikt echte lokale profiel-/checklistopslag met een uitdrukkelijk gemarkeerde modelgrens en een synthetische standaarddefinitie (`STENOAI_E2E_STANDARD_CHECKLISTS_DIR`, alleen onder e2e met mock-IPC). Dit zijn geen metingen van de kwaliteit van een daadwerkelijk verkoopmodel of menselijke gesprekken.
