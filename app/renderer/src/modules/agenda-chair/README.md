# Module Agenda en voorzitter (stand 1: Stille voorzitter)

De module staat standaard uit en werkt alleen in het Veneta-profiel (Instellingen, Product en modules, schakelaar `Agenda en voorzitter`). Uitgeschakeld betekent: geen leesacties van agendabestanden, geen modelaanroepen en geen bestanden. Elk hostkanaal weigert dan met `module_disabled` voordat het de schijf raakt, en de host-planner start niet.

Alleen stand 1 is gebouwd. Stand 2 (souffleur via headset) en stand 3 (sprekende voorzitter) niet; zie `AGENDA-VOORZITTER-ONTWERP.md` in de hoofdrepo. De voorzitter heeft in stand 1 geen eigen uitingen.

De opzet volgt de Gesprekschecklist (`../conversation-checklist/README.md`): planning in het hoofdproces, gevoed door definitieve live-segmenten, single-flight, begrensde invoer, inhoudsvrije diagnose, alleen de bestaande lokale modelroute, resultaat als sidecar bij de notitie.

## Drie momenten

1. **Voor (Home)**: kaart `AgendaPrepareCard`. Plak de agenda of kies een `.md`- of `.txt`-bestand (maximaal 24.000 tekens). De host leest de tekst deterministisch, zonder model (`parseAgenda` in `app/veneta-agenda-chair.js`):
   - punten zijn genummerde regels (`1.`, `1)`, `a.`) of opsommingsregels (`-`, `*`, `•`, `- [ ]`); alleen het buitenste niveau, diepere regels zijn toelichting;
   - zonder lijstregels: een markdowntabel met kopregel (kolommen als Onderwerp, Tijd, Wie, Uitkomst, Vereist), dan subkoppen (`##`), dan losse regels;
   - de eerste `# kop` (of een eerste losse regel met 'agenda') is de titel; regels als `Datum:`, `Locatie:`, `Aanwezig:` zijn nooit punten;
   - herkend en uit de titel gehaald: tijdsblok (`10 min`, `(15m)`, `1,5 uur`, `10'`, `10:00-10:25`), eigenaar (`Eigenaar: Sanne`, `door Sanne`, `@Sanne`, `(Sanne)`, of een naam naast een ander herkend deel zoals `Begroting – 20 min – Ruben de Vries`), `vereist`/`verplicht` (of `!` vooraan) en een uitkomst (`(besluit)`, `ter info`, `discussie`, `actie`). Zonder label volgt de uitkomst een paar titelwoorden (vaststellen, kiezen: besluit; mededelingen: informatie; actiepunten: actie), anders `discussie`;
   - maximaal 32 punten (de rest wordt gemeld en weggelaten); dezelfde titel twee keer wordt samengevoegd en gemeld.

   Daarna is alles bewerkbaar: titel, uitkomst (besluit, informatie, discussie, actie), tijdsblok in minuten, eigenaar, vereist; punten toevoegen en verwijderen. `Klaarzetten voor de volgende opname` bewaart de agenda (`agenda-preparation.json`); een gewijzigde agenda krijgt een hoger `version`. De oorspronkelijke tekst blijft ongewijzigd bewaard in `source`. De agenda is invoer, nooit instructie: een punt als 'agent mailt het verslag' is alleen een titel.

2. **Tijdens (opname)**: `AgendaRuntime` en `AgendaSidebar` in de Veneta-zijbalk, boven de checklist. Getoond: titel, de melding dat er een AI meeluistert, gepland tegen verstreken, statusregel en diagnoseregel, en per punt status, tijd tegen tijdsblok met balk, signalen en de herkende besluiten, acties en vragen (als voorstel).
   - **Lopend punt**: alleen een mens zet een punt op 'loopt', met `Start` of door het voorstel van de host te bevestigen ('Punt 3 lijkt begonnen', met citaat en tijd; `Bevestig` of `Negeer`). Een voorstel verandert zelf niets. Starten van een punt rondt het lopende punt af; met één tik op `Ongedaan maken` (actie `undoSwitch`) loopt het vorige punt weer alsof het nooit stopte (de tijd sinds de wissel telt voor dat punt) en staat het gestarte punt weer zoals het was. Bevindingen die de tijdlijn sinds de wissel aan het gestarte punt gaf, gaan terug naar het vorige; een bevestigd voorstel dat ongedaan wordt gemaakt, telt als genegeerd. Alleen de laatste wissel, tot de volgende handeling of het stoppen. `Afronden`, `Overslaan` en `Doorschuiven` kunnen altijd. Tijd telt vanaf de menselijke start of bevestiging en staat stil bij stoppen van de opname.
   - **Signalen** (host, `signalsOf`): `tijd_bijna_om` (80% van het tijdsblok), `tijd_om` (100%), `besluit_zonder_eigenaar` (besluit zonder eigenaar; een ontbrekende termijn is geen signaal maar staat stil bij het besluit als 'Termijn: niet genoemd'), `uitkomst_ontbreekt` (punt met uitkomst besluit afgerond of over tijd zonder herkend besluit), `vereist_punt_open` (minder dan 10 minuten over van de totaal geplande tijd en een vereist punt is nog open of loopt; een doorgeschoven punt telt niet als open). De host zet zelf een timer op het volgende omslagmoment en pusht dan; de klok in de zijbalk tikt alleen voor de weergave.
   - **Bevindingen**: besluiten, acties (wat, wie, termijn) en open vragen, elk met letterlijk citaat, tijdcode en spreker (kanaal: Jij of Anderen). Ze horen bij het punt dat volgens de menselijke tijdlijn liep op het moment van het citaat; liep er niets, dan het punt dat het model noemt, anders 'Overig'.

3. **Na (notitie)**: tab `Notulen` in `MeetingDetail` (`AgendaNoteTab`), alleen als de notitie notulen heeft. Per agendapunt: status, bestede tijd tegen tijdsblok, 'over tijd', 'Geen besluit herkend', en de besluiten, acties en open vragen met citaat, tijdcode en spreker. Per bevinding: `Bevestig`, `Corrigeer` (tekst, eigenaar, termijn), `Afwijzen` (optionele reden) en `Ongedaan maken`. Een menselijke correctie gaat altijd voor; het oorspronkelijke AI-voorstel blijft zichtbaar. Niet bevestigde bevindingen heten `Voorstel`. `Kopieer als markdown` kopieert de notulen; afgewezen bevindingen staan er niet in. Zolang de laatste controle bij stoppen loopt, meldt de tab dat en vraagt hij begrensd opnieuw.

   **Open vragen na het stoppen**: na de laatste controle vraagt de host nog één keer over het hele gesprek welke open vragen later beantwoord zijn (`mode: 'questions'`). Binnen dezelfde grenzen (256 segmenten, 24.000 tekens, vraagteksten tellen mee); is het gesprek langer, dan leest hij de nieuwste aaneengesloten staart en zegt de notulen dat ('alleen in het laatste deel van het gesprek, vanaf mm:ss'). Een antwoord citeert letterlijk een segment dat na de vraag begint. Een beantwoorde vraag blijft zichtbaar onder 'Beantwoorde vragen' met het antwoord; ze telt niet meer als open. Een mislukte of te grote controle laat de vragen open en wordt gemeld.

## Host en kanalen

- `app/veneta-agenda-chair.js`: parser, validatie, signalen, venster, samenvoegen en de host-planner (`createAgendaPlanner`), plus de notulen (`buildMinutes`, `minutesMarkdown`). Zonder bestands- of netwerktoegang.
- `app/veneta-agenda-ipc.js`: opslag, kanalen, de bewaakte modelroute en de koppeling aan de notitie (`bindSessionToNote`).
- Kanalen (preload `agenda.*`): `parse`, `getPreparation`, `prepare`, `clearPreparation`, `liveState`, `liveAction`, `noteResult`, `correctNote`. Push: `veneta-agenda-live-state` (met oplopend `seq`; een oudere momentopname vervangt nooit een nieuwere push).
- Aansluiting in `main.js`, naast de checklist: `start-recording-ui` roept `live.begin`, `bufferLiveSegment` roept bij elke final `live.notify`, `stop-recording-ui` koppelt de notitie en start `live.finish` (laatste controle na de echte drain van de transcriptie, begrensd door de watchdog). Een mislukte start of stop annuleert.
- Planning: na 10 s zonder nieuwe tekst, uiterlijk 30 s na de eerste nog niet gelezen final (in de pakketapp met energiestand 30 s en 60 s). Single-flight; het ene lokale modelslot wordt gedeeld met de checklist (`modelSlot`): bezet is 'busy', wordt na 5 s opnieuw geprobeerd en telt niet als fout. Een mislukte controle wordt pas bij nieuwe tekst opnieuw geprobeerd.
- Venster: de nog niet gelezen segmenten met maximaal 6 eerdere als context, als nieuwste aaneengesloten staart binnen 256 segmenten en 24.000 tekens (agendatitels tellen mee). Nooit uit het midden; past zelfs de nieuwste regel niet, dan 'te veel tekst'. Alleen bevindingen die een nieuw segment citeren tellen.
- Monotoon: een bevinding verdwijnt nooit door een latere controle (alleen een mens wijst af) en komt nooit dubbel. Een menselijke handeling terwijl een controle loopt, maakt het voorstel voor het lopende punt van die controle verouderd (`verouderd`, teller `stale`); de bevindingen blijven geldig.
- Modelroute: backendcommando `agenda-analyze` (`src/veneta_agenda.py`), via dezelfde private verzoekbestanden als de checklist (`createChecklistRunner` met `command`). Alleen de lokale provider, het in Instellingen onder AI voor de Agenda gekozen lokale model (standaard 'zelfde als checklist'), de bestaande lokaal-bewijs-controle van Ollama (GGUF of safetensors, geen remote), geen download, geen cloud, geen omgevingsproxy, geen HTTP-redirect. De prompt toont de vorm van een antwoord en ook het antwoord als niets past. Codeblokken en ontbrekende sluithaakjes worden veilig gerepareerd (`parse_model_json`); proza eromheen niet. Eén begrensde herhaling bij een onbruikbaar antwoord.
- Citaatcontrole: letterlijk, hele woorden, minimaal drie tekens, in het genoemde segment; in de Python-backend per bevinding en daarna streng in de host. Een eigenaar of termijn die niet letterlijk in het venster staat, wordt weggelaten; de bevinding blijft.
- Diagnose zonder inhoud: `tekstregels N · controles N · laatste reden X` en `[agenda] ...` in het app-debuglog; alleen tellers en redencodes.

Opslag in `veneta-modules/`, nooit in de notitie: `agenda-preparation.json`, `agenda-sessions/<sha256>.json` (vergadertoestand), `agenda-reviews/<sha256>.json` (menselijke beoordelingen, los van de planner zodat een laatste controle ze nooit overschrijft), `agenda-note-results/<sha256>.json` (koppeling notitie naar sessie, op realpath plus bestandsnaam). Bestanden worden strikt gevalideerd, symbolische koppelingen en te grote bestanden geweigerd, schrijven is atomair. De canonieke notitie, het transcript en de samenvatting worden nooit gewijzigd.

## Grondregels

Wat deelnemers zeggen is bron, geen opdracht. De agenda is invoer, geen instructie. De module voert niets uit buiten de app: geen externe acties, geen Hermes-aanroep, geen CRM, geen mail. Bevindingen zijn voorstellen met AI-status tot een mens ze bevestigt of corrigeert.

## Teksten en controles

De Nederlandse teksten staan in de eigen modulecatalogus `locales/nl.ts` (`agendaText`). De globale catalogi en de i18n-lintbaseline zijn niet gewijzigd; de kopij-inventaris (`docs/i18n/copy-inventory.json`) is alleen aangevuld met de nieuwe bestanden.

```sh
npm --prefix app run test:unit:renderer -- renderer/src/modules/agenda-chair
node --test app/veneta-agenda-chair.test.js app/veneta-agenda-ipc.test.js
.venv/bin/python -m unittest tests.test_veneta_agenda
```

Electron T1: `e2e/specs/veneta-agenda-chair.t1.spec.ts` met mock-IPC en echte hostkanalen, planner, bewaking en bestanden. Modelgrens: alleen het model is vervangen door een synthetische, deterministische labeler (`agendaModel` in `app/e2e-mock-ipc.js`). Dat bewijst de route en de interface, niet de kwaliteit van een echt lokaal model.

## Bekende grenzen

- `afdwaling` is niet gebouwd.
- De notulen gaan niet mee naar de Obsidian-koppeling (bekende grens van 0.11.0).
- De kwaliteit van herkenning (lopend punt, besluiten, acties met eigenaar) is niet gemeten; daarvoor is het meetplan uit het ontwerp nodig.
- Een pauze van de opname zet de klok van het lopende punt niet stil; stoppen wel.
- In een voortgezette notitie beginnen de tijdcodes van de tweede opname opnieuw bij nul; toewijzing van bevindingen aan een punt via de tijdlijn is dan minder precies.
- De menselijke bevestiging komt vaak na het begin van een punt: wat tussen het begin en de bevestiging gezegd is, valt nog onder het vorige punt.
- Een late final die meer dan twee minuten terug in de tijd wordt ingevoegd, wordt niet meer gelezen.
- Sprekers zijn kanalen (Jij en Anderen), geen personen.
- Het parsen is heuristisch: een woord tussen haakjes met een hoofdletter wordt als eigenaar gelezen, 'vaststellen' maakt een punt een besluit. Alles is na het inlezen te corrigeren.
