# Changelog Veneta MemoAi

Dit bestand beschrijft de eigen Veneta-releases, niet de releases van StenoAI upstream. Gepland werk staat apart van opgeleverde functionaliteit. Een versienummer in de bron is nog geen gebouwde of vrijgegeven release.

## 0.11.0, testkandidaat, 2026-11-16

Minor: Nederlandse interface en samenvattingstaal, en de nieuwe module Agenda en voorzitter (stand 1). Branch `feat/veneta-0.11.0`: merge van `feat/veneta-nl-interface` en `feat/agenda-voorzitter` op de 0.10.7-bron `b81471b`, plus de besluiten van Martin van 15-11.

### Nederlandse interface en samenvattingstaal

- De Veneta-build toont de interface volledig in het Nederlands: navigatie, instellingen, knoppen, dialogen, meldingen en foutteksten. Alle renderer-teksten lopen via `t()`; de Engelse catalogus groeide van 268 naar 1.310 sleutels en de Nederlandse van 92 naar 1.310. De lint-baseline van hardgecodeerde teksten ging van 711 naar 0. De Default-build blijft Engels met dezelfde tekst, aangetoond met de kopij-inventaris.
- Ook het hoofdproces is in de Veneta-build Nederlands: menubalkmenu en tooltip, appmenu, bestandsfilters, systeemmeldingen, updaterteksten en de foutteksten die de app toont. Bundle-ID, interne naam, gegevensmap, logregels en foutcodes zijn ongewijzigd.
- Wachtredenen van de Obsidian-sync worden in de app vertaald; de backend schrijft ze ongewijzigd.
- Nieuwe instelling Samenvattingstaal, los van interfacetaal en transcriptietaal. In de Veneta-build is Nederlands de standaard voor nieuwe samenvattingen, titels en rapporten zolang je zelf niets kiest. Een eigen keuze, ook 'Zelfde taal als het gesprek', blijft staan. Bestaande samenvattingen worden niet opnieuw gemaakt.
- Testomgeving: de T1-specs lezen hun interfaceteksten uit de catalogus in de taal van de gebouwde renderer (`e2e/fixtures/ui-copy.ts`), zodat dezelfde specs in de Default- en de Veneta-build slagen. De meter-test-id van de opnamecontrole hangt niet meer af van het vertaalde label. De taaltip in de transcriptinfo noemt het menu-item zoals het heet: 'Opname opnieuw transcriberen'.
- Testomgeving: headless e2e-runs blijven op macOS een accessory-app (geen dockicoon, geen activering), het meldingsvenster komt niet op het scherm en native dialogen worden als geannuleerd beantwoord, zodat een testrun geen venster meer over andere apps legt. Productie is ongewijzigd.

### Agenda en voorzitter, stand 1

Nieuwe module `Agenda en voorzitter`, stand 1 (Stille voorzitter), naast de Gesprekschecklist en met dezelfde grenzen: standaard uit, alleen in het Veneta-profiel, uit betekent geen leesacties, geen modelaanroepen en geen bestanden. Beschrijving: `app/renderer/src/modules/agenda-chair/README.md`.

- Voor: agenda plakken of een .md/.txt-bestand kiezen; de host leest het zonder model in agendapunten (genummerd of opsomming, tijdsblok, eigenaar, uitkomst, vereist), maximaal 32 punten en 24.000 tekens; daarna bewerkbaar en klaar te zetten voor de volgende opname.
- Tijdens: zijbalk met lopend punt, tijd per punt tegen tijdsblok en de signalen tijd bijna om (80%), tijd om (100%), besluit zonder eigenaar of termijn, uitkomst ontbreekt en vereist punt open (minder dan 10 minuten over). De host stelt via het lokale model een wissel voor ('Punt 2 lijkt begonnen') die een mens met een tik bevestigt; starten, afronden, overslaan en doorschuiven kan altijd. Besluiten, acties en open vragen komen als voorstel met letterlijk citaat, tijdcode en spreker.
- Na: tab `Notulen` in de notitie per agendapunt, met bevestigen, corrigeren, afwijzen en ongedaan maken per bevinding, en `Kopieer als markdown`. Laatste controle bij stoppen.
- Techniek: host-planner in het hoofdproces gevoed door definitieve live-segmenten, single-flight met het modelslot van de checklist gedeeld, begrensd venster (nieuwste aaneengesloten staart), inhoudsvrije diagnose, backendcommando `agenda-analyze` met de bestaande lokale route en lokaal-bewijs-controle, sidecars in `veneta-modules/agenda-*`. De productinstellingen accepteren een tweede, optionele modulesleutel; bestaande instellingenbestanden blijven geldig.

Bekende grenzen: afdwaling niet gebouwd; herkenningskwaliteit niet gemeten; een pauze zet de klok van het lopende punt niet stil; tijdcodes in een voortgezette notitie beginnen opnieuw; sprekers zijn kanalen.

### Besluiten van 15-11

- De MemoAi-melding verschijnt op normaal vensterniveau: niet meer altijd bovenop, niet op alle bureaubladen en niet over schermvullende apps. Ze pakt nog steeds geen focus, de knoppen werken met één klik en ze sluit na 15 seconden (`app/notification-window.js`, met tests).
- Agenda: `besluit zonder eigenaar` meldt alleen bij een ontbrekende eigenaar; een ontbrekende termijn staat stil bij het besluit ('Termijn: niet genoemd').
- Agenda: eigen modelkeuze in Instellingen > AI, standaard 'zelfde als checklist'; alleen lokaal, met dezelfde lokaal-bewijs-controle.
- Agenda: een nieuw punt starten rondt het vorige af, met 'Ongedaan maken'; het vorige punt loopt dan door met de tijd sinds de wissel erbij.
- Agenda: een doorgeschoven vereist punt telt niet als open; na het stoppen worden open vragen nog één keer over het hele gesprek nagegaan, binnen dezelfde invoergrenzen (bij een te lang gesprek de nieuwste staart, en de notulen zeggen dat).
- Samenvattingstaal staat ook in de Default-build, standaard 'automatisch'; het Default-gedrag verandert pas als de gebruiker een taal kiest.
- Stemprofiel- en kluismaptekst noemen Veneta MemoAi in de Veneta-build; de echte map `StenoAI`, de telemetrie (Steno Labs) en de open-sourceverwijzing blijven. De zijbalk van de opname heet neutraal 'Gespreksmodules'.
- Tests: de wankele summary-folding-test wacht op een vast signaal in plaats van op timing; de updatefouttekst in de testomgeving komt uit dezelfde catalogus als de app.

Bekende grenzen: geen meting van de herkenningskwaliteit van de agenda met een echt model; geen koppeling van de notulen met de Obsidian-export; afdwaling niet gebouwd; een pauze zet de klok van het lopende punt niet stil; tijdcodes in een voortgezette notitie beginnen opnieuw; sprekers zijn kanalen, geen personen; de melding kan nu achter het actieve venster van een andere app vallen; samenvattingskoppen blijven in opgeslagen notities Engels (de app toont ze Nederlands).

Opgelost vóór oplevering: de eerste 0.11.0-build was gebouwd in een werkboom waar `app/node_modules` een symbolische koppeling was. electron-builder liet daardoor ongeveer 220 afhankelijkheden van het hoofdproces weg (onder meer van axios en electron-updater; `app.asar` 49,5 in plaats van 75,6 MB). Die build is niet opgeleverd; de kandidaat hieronder is opnieuw gebouwd met een volledige kopie van dezelfde afhankelijkheden (247 pakketten in `app.asar`, gelijk aan 0.10.7).

Bewijs: Python 1.958 uitgevoerd, OK (2 overgeslagen); Node 922: 916 geslaagd, 5 mislukt, 1 overgeslagen (de 5 `meeting-transfer-audio`-tests missen de niet-gebouwde `bin/steno-audio-encode`, net als op de 0.10.7-bron); renderer 596/596; typecontrole, `lint:main`, `lint:i18n` (0 bekende teksten), kopij-inventaris en `lint:renderer` (0 fouten, 44 bestaande waarschuwingen) geslaagd. Ontwikkel-T1: Default 217 geslaagd en 1 overgeslagen, Veneta 218/218. Volledige pakket-T1 tegen het uitgepakte, ondertekende pakket (Veneta-build): 218/218, zonder skips of herhalingen, headless. Verpakte backend-CLI start met `--help`. Lokale ondertekening (Memoa Test Local Signing) diep en strikt geldig vóór en na uitpakken; niet genotariseerd, niet geïnstalleerd. Geen echte opname of modelaanroep in deze kandidaat.

Pakket: `.local/veneta-0.11.0/Veneta-MemoAi-0.11.0-arm64.zip`, 305.311.333 bytes, SHA-256 `df3998870bac5fd18b8462f152e566ad3b1b95c6bceda65540e434cce3ca27c0`. Bron: commit `b00008e`, schone werkboom; bronmanifest `.local/veneta-0.11.0/source-manifest.json` met 1.108 bestanden, na het opnieuw bouwen bytegelijk nagerekend. Interne naam `Memoa Test`, bundle-ID `local.memoa.test`, gegevensroot en encryptie-identiteit ongewijzigd.

## Versiebeleid

- Iedere nieuwe opgeleverde release krijgt een eigen versienummer.
- Nieuwe functionaliteit: volgend minor-nummer, bijvoorbeeld 0.9.0 naar 0.10.0.
- Alleen reparaties binnen dezelfde functieomvang: volgend patchnummer, bijvoorbeeld 0.9.0 naar 0.9.1.
- Een kandidaat vóór vrijgave krijgt een herkenbaar achtervoegsel, bijvoorbeeld 0.9.0-rc.1. Een gewijzigde kandidaat krijgt een nieuw kandidaatnummer.
- Per oplevering worden datum, wijzigingen, opgeloste fouten, bekende grenzen, testbewijs, bronmanifest en SHA-256 van het pakket vastgelegd. De bestandsnaam bevat het versienummer.
- Opgeleverde pakketten krijgen niet achteraf een ander nummer of andere inhoud. Een wijziging levert een nieuwe kandidaat of release op.
- Versienummers wijzigen niet de interne appnaam, bundle-ID, gegevensmap, modelcache of aanmeldingen. Publiceren, installeren, committen en pushen blijven afzonderlijke acties.

## 0.10.7, testkandidaat, 2026-11-06

Opgelost: het privacyvenster en de algemene instellingen noemen in de Veneta-build bij automatisch starten, microfoon en menubalk weer Veneta MemoAi; de generieke build blijft Steno tonen. Bij automatische taalkeuze kiest de notitie voor een kort, eenduidig Nederlands transcript nu `language: nl` in plaats van de Engelse terugval. `detected_language: null` blijft correct: Parakeet meldt geen onafhankelijk gedetecteerde audiotaal. Voor ambigue tekst blijft de veilige terugval gelden. Bestaande notities en gebruikersprofielen zijn niet gemigreerd.

Bewijs: Python 1.931 uitgevoerd (1.927 geslaagd, 4 overgeslagen); renderer 563 geslaagd; Node 858 geslaagd, 1 overgeslagen; volledige pakket-T1 215/215 en geselecteerde pakket-T2 7/7 zonder skips of flakes. Typecontrole, i18n-gate en kopij-inventaris geslaagd. De verpakte backend transcribeerde dezelfde zes seconden verzonnen Nederlandse spraak correct; de opgeslagen notitie vermeldt `language: nl` en bewaart het audiobestand. De notitie en privacydialoog zijn in de verpakte app met afzonderlijke proefprofielen geopend en op schermafbeeldingen gecontroleerd. Pakket-CLI start, lokale ondertekening blijft geldig na de proeven en na uitpakken. In een apart proefprofiel maakte het verpakte programma met het aanwezige lokale `gemma4:e2b-nvfp4`-model op een eigen loopbackpoort een Nederlandse samenvatting van dezelfde synthetische spraak; de samenvatting is opgeslagen en in de app zichtbaar. De proefserver is daarna gestopt. `detected_language` blijft in de interface 'Not reported', omdat de ASR-engine die meting niet levert; de werkelijke uitvoertaal staat afzonderlijk in de notitie. Een eerste microfoonpoging stopte vóór opnemen: de omgevingscontrole mat RMS 0,0406 boven de vooraf vastgelegde grens 0,035. Een volgende poging met afgespeelde, verzonnen spraak nam wel op, maar kon de transcriptie niet afronden omdat het geïsoleerde proefprofiel geen lokale Parakeet-modelcache had; de bewaarde opname kon na het kopiëren van de cache wel worden getranscribeerd. Een schone derde poging met de ingebouwde MacBook-microfoon en die cache rondde de volledige opname- en transcriptieketen in de verpakte app af: 10 seconden, 172.603 bytes bewaarde WebM, status `complete`, `language: nl`; het transcript komt na normalisatie exact overeen met de bekende Nederlandse proefzin en is zichtbaar in de app. Vervolgens maakte dezelfde verpakte app via de knop ‘Opnieuw samenvatten’ met het lokale model een inhoudelijke Nederlandse samenvatting van precies deze microfoonnotitie; opgeslagen en zichtbaar in het scherm. De eerste samenvatting was handmatig opgeroepen, niet automatisch bij het stoppen van de opname (`auto_summarize_enabled: false` in het testprofiel). Dit bewijst een korte echte microfoonopname en deze proefzin, niet de kwaliteit bij lange vergaderingen of batterijwinst. Niet genotariseerd, geïnstalleerd of gepubliceerd.

Aanvullende batterijproef met de verpakte 0.10.3 en 0.10.7, achtereenvolgens en daarna in omgekeerde volgorde: per versie twee zichtbare opnamen van 120 seconden met dezelfde afgespeelde verzonnen spraak via de ingebouwde microfoon. De profielen hadden dezelfde relevante instellingen (Parakeet, Nederlands, geen systeemgeluid of automatische AI-samenvatting); alle vier opnamen leverden een bewaard audiobestand en een voltooide notitie met herkenbare proeftekst op. CPU-tijd van de volledige app-procesboom tijdens de opname: 0.10.3 71,10 en 71,70 seconden, 0.10.7 51,17 en 53,94 seconden (gemiddeld 26,4% minder); alleen de transcriptie-backend 24,09 en 22,57 tegenover 3,02 en 2,92 seconden. Dit is een CPU-vergelijking op batterij, geen bewezen batterijbesparing. De batterijcapaciteitsensor gaf in de vier opeenvolgende korte vensters sterk uiteenlopende dalingen (0.10.3: 122 en 66 mAh; 0.10.7: 5 en 101 mAh), inclusief een vlakke periode rond 100%; achtergrondbelasting en sensoractualisering zijn niet geïsoleerd. Er is geen vergelijkbare Energie-impactmeting van de app in Activiteitenweergave. Bronmetingen staan in het afzonderlijke scratchproefrapport; geen pakketinhoud gewijzigd.

Pakket: `.local/veneta-0.10.7/Veneta-MemoAi-0.10.7-arm64.zip`, 305.731.331 bytes, SHA-256 `3ec11bcd28bfa1e611a4d523d9c662688f8975a646a64a2f25fddb9d55d647ba`. Bronbasis `4652cf1` met niet-gecommitte wijzigingen; bronmanifest `.local/veneta-0.10.7/source-manifest.json` met 1.070 bestanden. Na de pakketproeven is alleen dit niet-meegeleverde changelog aangevuld; de overige 1.069 bronbestanden bleven gelijk aan het bouwmanifest. Het 0.10.6-pakket bleef ongemoeid.

## 0.10.6, testkandidaat, 2026-11-06

Opgelost: bij eerste start toont de welkomstkop nu ‘Welcome to Veneta MemoAi’ in plaats van ‘Welcome to Steno’. Ook de vraag naar de samenvattingsmethode, de toelichting bij starten na aanmelden en de lege debugkop volgen de productnaam van de gekozen build. De generieke variant blijft ‘Steno’ tonen. ‘Steno Labs’ bij optionele telemetrie en de bestaande upstream-issuekoppeling zijn niet hernoemd: die duiden nog de werkelijke bestemming aan. De bundle-ID en gegevensroot zijn ongewijzigd.

Bewijs: de nieuwe regressietest faalde op het verpakte 0.10.5-scherm en slaagt op de 0.10.6-build én in de generieke ontwikkelvariant. Het eerste-startscherm is zelf met de echte, verpakte host en een nieuw geïsoleerd proefprofiel geopend; de zichtbare titel en drie merkteksten zijn gecontroleerd zonder modeldownload of microfoonverzoek. Volledige pakket-T1: 215/215 geslaagd, zonder skips of flakes (andere tests gebruiken grotendeels mock-IPC). Renderer: 561/561 unit-tests; Node: 858 geslaagd, 1 overgeslagen, 0 mislukt. Typecontrole, i18n-gate en kopij-inventaris geslaagd. Backend-CLI (`--help`) start; lokale ondertekening geldig voor en na uitpakken en na de pakketproeven. Echte opname en modelkwaliteit blijven ongetest; de build is niet genotariseerd, geïnstalleerd of gepubliceerd.

Pakket: `.local/veneta-0.10.6/Veneta-MemoAi-0.10.6-arm64.zip`, 305.392.902 bytes, SHA-256 `a57447f1df8be36e435a7c88d471f1f2d6cb9887b552e70410e23face5cf5755`. Bronbasis `4652cf1` met niet-gecommitte wijzigingen. Bronmanifest: `.local/veneta-0.10.6/source-manifest.json`, 1067 bestanden. Het 0.10.5-pakket is niet gewijzigd.

## 0.10.5, testkandidaat, 2026-11-05

Opgelost: het venster ‘Wat is nieuw’ opent na een upgrade pas wanneer het native appvenster zichtbaar is. Een verborgen Electron-venster kan zijn webpagina ten onrechte als gefocust melden; de host levert daarom een zichtbaarheidssnapshot en show/hide-gebeurtenissen aan de renderer. Handmatig openen vanuit Over blijft werken. De bestaande bundelidentiteit `local.memoa.test` en gegevensroot zijn niet gewijzigd. Bij de pakketproef is ook de testmock voor detailniveaus gerepareerd: een verouderde notitie behoudt zijn eigen tekst in plaats van de algemene voorbeeldtekst te krijgen.

Bewijs: regressietest eerst rood, daarna groen; 12 gerichte ontwikkel-T1-proeven geslaagd; 214/214 volledige pakket-T1-proeven geslaagd, zonder skips of flakes. De verpakte backend-CLI start met `--help`, bron- en pakketkopieën van `main.js`, `preload.js` en `e2e-mock-ipc.js` komen byte-identiek overeen; lokale ondertekening geldig voor en na uitpakken. De tests vervangen opname en modelaanroepen door mocks: echte opnamekwaliteit, AI-modelkwaliteit en een batterijmeting zijn niet aangetoond. Niet genotariseerd, niet geïnstalleerd, niet gepubliceerd of vrijgegeven.

Pakket: `.local/veneta-0.10.5/Veneta-MemoAi-0.10.5-arm64.zip`, 305.391.745 bytes, SHA-256 `6654408babdc1158510d0f76b35a2df43608ff26bcf4fde3035e074e8d4af26a`. Bronbasis `4652cf1` met niet-gecommitte wijzigingen; `.local/veneta-0.10.5/source-manifest.json` legt hashes van 707 bronbestanden vast. De eerste, nog niet opgeleverde 0.10.5-kandidaat is in dezelfde lokale buildmap overschreven vóór deze definitieve pakketproef; daarvan bestaat geen afzonderlijke rollback.

## 0.10.4, testkandidaat, 2026-11-04

Energiestand voor de Veneta-pakketapp: tijdens een opname decodeert Parakeet geen voorlopige tekst meer. Definitieve segmenten, transcriptbewaring en de live gesprekschecklist blijven werken. Het optionele transcript begint ingeklapt en kan handmatig open. De checklist wacht 30 seconden na de laatste tekst of maximaal 60 seconden bij doorlopende spraak; bij stoppen volgt nog een eindcontrole. Alleen de pakketapp schakelt deze stand standaard in; `STENOAI_VENETA_ENERGY_SAVER=0` schakelt haar voor een proef uit. De gewone ontwikkelvariant houdt de oude cadans.

Proef met dezelfde 51,54 seconden synthetische Nederlandse spraak op beide verpakte backends, offline en met dezelfde modelcache: 0.10.3 gaf 119 voorlopige en 2 definitieve segmenten, 0.10.4 gaf 0 voorlopige en dezelfde 2 definitieve teksten. Backend-CPU-tijd: 8,07 tegenover 1,25 seconden (84,5% minder in deze versnelde doorvoerproef, inclusief modelladen). Dit is geen meting van het stroomverbruik van de gehele app of van een realtime vergadering. De Mac hing aan de lader, dus batterijwinst is niet gemeten.

Bewijs: 10 gerichte Python-tests, Node- en renderertests, lint, typecontrole, 9 gerichte pakket-T1-routes (waaronder 90 seconden doorlopende checklist, stoppen en monotoon afvinken), pakket-CLI en geldige lokale ondertekening vóór en na uitpakken. De brede pakket-T1 eindigde niet groen: 200 geslaagd, 5 mislukt, 9 door de foutlimiet niet uitgevoerd. Fouten in My notes, regeneratie, PDF-export, modeldownloadstatus en releasevenster; of die aan deze energiewijziging gerelateerd zijn, is niet aangetoond. Een losse herhaling van regeneratie slaagde alsnog in 0.10.4; My notes, PDF-export en modeldownloadstatus faalden ook in de ontwikkelvariant, en het releasevenster faalde opnieuw bij een andere focusassertie. De volledige 369-test E2E-suite (inclusief andere projecten), een realtime opnamevergelijking en een A/B-batterijproef zijn niet afgerond. Het pakket is niet genotariseerd, niet geïnstalleerd en niet vrijgegeven.

Build: `.local/veneta-0.10.4/Veneta-MemoAi-0.10.4-arm64.zip`, 305.392.503 bytes, SHA-256 `e7e305cc20329674d8a9195cde8991d810b44004d82c23c191252d590e8f4c97`. Bronbasis `4652cf1` met niet-gecommitte wijzigingen. De eerdere 0.10.3-build bleef ongemoeid.

## 0.10.2, testkandidaat, 2026-10-30

Patch: actiepunten, kopiëren en sprekernamen.

- Actiepunten: een taak op een vervolgregel of als subpunt hoort nu bij het actiepunt (eerder bleef alleen "Speaker 2 (due ...)" over). Python- en app-parser gelijk.
- Deadlines: het model schrijft de deadline zoals uitgesproken ("vrijdag", "volgende week dinsdag", "15 november", "eind van de maand"); de app rekent die zelf om naar een datum ten opzichte van de gespreksdatum. "Eind van de week" is de vrijdag. Vage termijnen blijven als tekst; een door het model verzonnen datum (zoals de gespreksdatum) wordt verwijderd. Een eigenaar die niet in het gesprek voorkomt, wordt weggelaten (de taak blijft). Gemeten op gemma4:e2b-nvfp4 met een verzonnen gesprek, 8 runs: taak 8/8, juiste datum voor "vrijdag" 8/8 (was 0), geen foute of verzonnen datums, geen verzonnen eigenaar.
- Kopiëren: "Copy notes" kopieert het zichtbare detailniveau van de gekozen versie; nieuw is "Kopieer volledige notitie".
- Sprekernamen: koppel je later een naam aan "Speaker 2", dan toont de notitie die naam overal (samenvatting, onderwerpen, kernpunten, actiepunten, detailniveaus, kopie, PDF). Alleen genummerde labels; "You"/"Others" en tekst in code of links blijven ongemoeid; markdown in een naam wordt onschadelijk gemaakt. Het opgeslagen bestand blijft ongewijzigd.

Bekende grenzen: een taak die niemand op zich nam, zet dit kleine model in de kernpunten in plaats van de actiepunten; bestaande notities houden hun eerder verzonnen deadline (de weergave kent het transcript niet); sprekers die vóór deze versie zijn bevestigd zonder opgeslagen origineel label worden niet omgezet; de kopie van een detailniveau bevat namen onge-escaped.

Opgelost na review: de eerste build 0.10.2 is vervangen door 0.10.2-r2 (sprekernamen bij leestekens in de detailniveaus en zichtbare backslashes).

Build: `.local/veneta-0.10.2-r2/Veneta-MemoAi-0.10.2-arm64.zip`, 305.060.186 bytes, SHA-256 `75d8336b86f10688fe4ace7aabe0437147926f4c6374fc921ace9aa86527b78b`. Tests: 520 Python, 857 Node, 553 renderer, 81 pakket-E2E, ondertekening geldig. Review: geslaagd.

## 0.10.1, testkandidaat, 2026-10-30

Patch: checklistpunten vielen terug en de samenvattingspil kon ontbreken.

- Checklist: niveaus per punt zijn monotoon binnen een gesprek (nog niet gehoord, genoemd, uitgelegd, klant bevestigd). Een latere controle, ook de laatste bij stoppen, kan een punt alleen verhogen, zolang het geciteerde segment ongewijzigd in het transcript staat. Een herschreven of verdwenen citaat wordt opnieuw beoordeeld. Afwijzen met reden en n.v.t. winnen altijd. Tegengehouden verlagingen tellen inhoudsvrij mee in de diagnose.
- Samenvattingspil: een notitie die openstond terwijl de samenvatting binnenkwam, bleef op de ruwe tekst hangen zonder pil als het model de titel wijzigde. Nu wordt de opgeslagen notitie herladen en verschijnt de pil.

Bekende grenzen: monotoon betekent dat een onterecht vinkje blijft staan tot het in de notitietab wordt afgewezen; bij een voortgezette notitie begint de checklist van de tweede opname opnieuw; de 400 ms-timer na de samenvatting wordt bij snel wisselen niet opgeruimd (laag risico); niet bewezen dat de ontbrekende pil bij Martin precies deze oorzaak had.

Build: `.local/veneta-0.10.1/Veneta-MemoAi-0.10.1-arm64.zip`, 305.017.628 bytes, SHA-256 `c9314372ec97d930233b22475f39bdae126fe9b89f2059fbc10d9f2482faabf0`. Tests: 443 Python, 833 Node, 502 renderer, 37 pakket-E2E, ondertekening geldig. Review: geslaagd.

## 0.10.0, testkandidaat, 2026-10-30

Minor: modelkeuze per functie en een dynamische modellenlijst. Plus reparatie van de checklist en detailniveaus op het Apple-model.

- Model per functie: Samenvatting, Detailniveaus en Checklist hebben elk een eigen keuze in Instellingen > AI (standaard "zelfde als samenvatting"; bestaande instellingen ongewijzigd). Checklist en automatische detailniveaus blijven alleen lokaal.
- Dynamische lijst: "Op deze Mac" komt live uit Ollama; "Aanbevolen" komt uit een databestand (`src/data/model_catalog.json`) met labels "Klein, ook voor iPad later" en "Kandidaat, nog niet getest" (o.a. Nemotron 3 Nano 4B, Nemotron 3.5 Bolt E4B, Nemotron 3.5 Lightning).
- Model toevoegen met een Ollama-naam of `hf.co/...`: grootte vooraf, download pas na een klik, met voortgang en annuleren; cloudmodellen geweigerd. Verwijderen met bevestiging; een model dat in gebruik is, wordt niet verwijderd.
- Proefknop per functie met een verzonnen gesprek: geldig ja/nee, tijd en reden.
- Reparatie (oorzaak gemeten op het echte model): Ollama dwingt bij het Apple-model (MLX) de antwoordvorm niet af. Het model dacht eerst hardop, koos een eigen vorm of liet een sluithaakje weg. Nu: denken uit, een voorbeeld van de vorm in de vraag, en een veilige reparatie die alleen ontbrekende sluithaakjes aanvult. Gemeten op gemma4:e2b-nvfp4 met verzonnen gesprekken: checklist 20 van 20 bruikbaar (was 0), detailniveaus 10 van 10 geldig.
- Het voorbeeld toont ook een niet-genoemd punt: met alleen een afgevinkt voorbeeld vinkte het model een niet-genoemd punt af. Na de aanpassing geen onterecht afgevinkte punten in de meting (60 van 70 oordelen juist; de rest bleef veilig op twijfel).
- Fijnere foutredenen: leeg antwoord, geen JSON, verkeerde vorm, afgekapt.
- Checklist: een twijfelend oordeel met een citaat toont "Genoemd" in plaats van "Nog niet gehoord"; bij een uitgelegd punt toont de zijbalk ook "Klant bevestigd" met het citaat van de klant.
- De nieuwe modelkeuze en de oude modellijst op hetzelfde scherm verversen elkaar.

Bekende grenzen: de oude modellijst staat nog naast de nieuwe sectie; de Nemotron-modellen zijn niet gemeten; detailniveaus melden nog geen fijnere foutreden.

Opgelost na review: de eerste build 0.10.0 faalde in 8 pakkettests door een pad in de E2E-mock (niet in de app zelf) en is vervangen door 0.10.0-r2.

Build: `.local/veneta-0.10.0-r2/Veneta-MemoAi-0.10.0-arm64.zip`, 305.012.955 bytes, SHA-256 `9afb56c1a517ee51b327866b00628756a68542e4bb08a29c1fdd04770d7269bc`. Tests: 443 Python, 824 Node, 502 renderer, 32 pakket-E2E, ondertekening geldig.

## 0.9.5, testkandidaat, 2026-10-30

Patch: de checklist weigerde het standaardmodel op Apple Silicon met "Het gekozen model is niet aantoonbaar lokaal".

- Oorzaak: de lokaalcontrole accepteerde alleen modellen in GGUF-formaat. Op Apple Silicon gebruikt de app de nvfp4 MLX-variant (`gemma4:e2b-nvfp4`), die Ollama als `safetensors` meldt. Nu worden GGUF en safetensors beide geaccepteerd; cloud- en remote-modellen en onbekende formaten blijven geweigerd.

Build: `.local/veneta-0.9.5/Veneta-MemoAi-0.9.5-arm64.zip`, 304.937.675 bytes, SHA-256 `fe5287bb0728b69caf97c8d546e05a4b580bd15545b452781e5d266d5bced85c`. Tests: 334 Python, 815 Node, 485 renderer, 23 pakket-E2E, ondertekening geldig.

## 0.9.4, testkandidaat, 2026-10-30

Patch: reparatie van de live checklistcontrole, die bij echt gebruik bleef hangen op "wacht op stabiele tekst".

- De planning van de AI-controle zit nu in de host (achtergrondproces), niet meer in het scherm. Opnieuw tekenen, transcript in- of uitklappen, een venster op de achtergrond of een wisselende opnamesleutel kan de controle niet meer stilzetten. Controle na 10 s stilte, uiterlijk 30 s na nieuwe tekst.
- Laatste controle bij stoppen: wacht op de laatste uiting van de transcriptie; de notitietab meldt zolang die loopt. Draait de samenvatting tegelijk op het lokale model, dan wacht de laatste controle (maximaal circa 2 minuten).
- Diagnoseregel onder de status: tekstregels, controles en laatste reden, zonder gesprekstekst; dezelfde tellers in het app-logboek.
- Dubbele punten in een eigen checklist worden samengevoegd met een melding; overzicht en score tellen ze niet dubbel.
- Lange gesprekken (meer dan 256 transcriptregels): een eerder gevonden punt behoudt zijn citaat. Stabiele regelnummers, ook als een late regel eerder wordt ingevoegd.

Bekende grenzen: de oorzaak van de mislukte proef is niet exact aangetoond (vermoedelijk gesmoorde timers in een venster op de achtergrond of een wisselende sessiesleutel); de echte drain van de transcriptie bij stoppen is alleen met stubs getest.

Opgelost na review: 0.9.4 (eerste build) is vervangen door 0.9.4-r2.

Build: `.local/veneta-0.9.4-r2/Veneta-MemoAi-0.9.4-arm64.zip`, 304.936.550 bytes, SHA-256 `5098d16ad26b73bb2ad8a555d719f40eea1677e587e56f8777a3ad13a1d9598b`. Tests: 332 Python, 815 Node, 485 renderer, 23 pakket-E2E, ondertekening geldig.

## 0.9.3, testkandidaat, 2026-10-29

Status: gebouwd, lokaal ondertekend en getest; niet Apple-genotariseerd, niet geïnstalleerd. Onafhankelijke review: één functionele fout gevonden en hersteld (zie Opgelost na review), verder akkoord.

Pakket: `.local/veneta-0.9.3-r2/Veneta-MemoAi-0.9.3-arm64.zip`, 305.068.738 bytes, SHA-256 `401885509f3a84f96258af2d7a06b01aceaf21d5d5ef143c9f3f6b9d7235185c`. De eerdere build in `.local/veneta-0.9.3` is vervangen en niet opgeleverd.

### Opgelost na review

- De automatische AI-controle wachtte op 10 seconden stilte en startte daardoor nooit bij doorlopend praten. Nu controleert hij uiterlijk 30 seconden na nieuwe tekst.

### Checklist volgens het nieuwe ontwerp

- Vóór: één keuzelijst op Home met ‘Adviseur Gesprek’ (vaste Veneta-standaard, vergrendeld), eigen checklists en ‘Geen checklist’. Eigen checklists maken, bewerken en verwijderen kan; de standaard niet. De keuze blijft bewaard. Recente notities tonen de score.
- Tijdens: de AI-controle staat automatisch aan zodra een checklist klaarstaat (alleen lokaal model). Geen handmatig afvinken en geen bewerken tijdens het gesprek. Teller, voortgangsbalk, status en per punt citaat, tijd en spreker. In Instellingen: ‘Mijn microfoon is de verkoper’ (standaard aan).
- Na: het resultaat staat als tab in de notitie zelf, met besproken/deels/gemist, per punt genoemd, uitgelegd of door de klant bevestigd, citaten en Kopieer. Alleen een AI-vinkje afwijzen of ‘Niet van toepassing’ kiezen, beide met reden. De losse lijsten op Home zijn weg.

### Opgelost uit 0.9.2

- Dollartekens in een AI-niveau laten de AI-versie niet meer weigeren.
- Het checklistoverzicht filtert regeleinden uit modeltekst.
- AI-niveaus van de samenvatting worden alleen automatisch gemaakt bij een lokale aanbieder; bij een cloudaanbieder via de knop ‘AI-niveaus maken’.
- Een citaat moet minstens een heel woord van drie tekens zijn. Kleinere robuustheidsreparaties (escapen, herhaalpoging bij bezet, symlinkcontrole).

### Bewijs

- 332 Python-, 772 Node- en 479 renderertests, typecontrole, lint en vertaalgate geslaagd.
- 22 Electron-proeven tegen het gebouwde pakket geslaagd; ondertekening geldig, ook na uitpakken.

### Bekende grenzen

- ‘Adviseur Gesprek’ heeft nog geen punten en is daarom nog niet kiesbaar (‘Inhoud volgt van Veneta’).
- Na het stoppen volgt geen laatste AI-controle; de laatste seconden van het gesprek tellen mogelijk niet mee.
- Niet getest met het echte lokale model.

## 0.9.2, testkandidaat, 2026-10-29

Status: gebouwd, lokaal ondertekend en getest; niet Apple-genotariseerd, niet geïnstalleerd. Onafhankelijke review akkoord, zonder blokkerende bevindingen. De verdachte beelden (lidwoorden als onderwerp, overlappende woorden halverwege) bleken een testfixture en een normaal tussenframe van de TextFold-overgang.

Pakket: `.local/veneta-0.9.2/Veneta-MemoAi-0.9.2-arm64.zip`, 305.049.871 bytes, SHA-256 `2af7857bad20108d54558e37a85255d1184e148cf6b70ff92ad7bcb7ca975e3e`.

### Samenvatting: TextFold-lezer overgenomen

- De lezer van TextFold (Apache-2.0, commit 5062eac) is overgenomen in plaats van nagebouwd: woorden die blijven schuiven naar hun nieuwe plek, de rest vervaagt; vloeiend zoomen met scrollen, pinch of de toetsen 1 tot 5, halverwege stoppen kan; de balk als schuifregelaar; Onderwerpen als kaarten. Licentie en bronvermelding zitten in de app.
- Elk kort niveau is woord voor woord gekoppeld aan de volledige tekst (koppeling uit TextFold overgenomen). Eerder voorbereide niveaus worden één keer opnieuw gemaakt.
- Geen wachten meer: alle vijf niveaus werken direct in de voorlopige modus van TextFold (zonder AI), en de AI-niveaus worden automatisch op de achtergrond gemaakt zodra je een notitie opent. Daarna schuift de tekst naar de AI-versie. Mislukt dat, dan blijven de voorlopige niveaus staan met een reden.
- Vergeleken met TextFold zelf op dezelfde samenvatting: per overgang dezelfde aantallen schuivende, vervagende en verschijnende woorden.

### Checklist

- De live AI-controle deed zichtbaar niets. Oorzaak: het lokale model zet zijn antwoord vaak in een codeblok en dat werd geweigerd; de lokale AI-dienst werd niet gestart; fouten waren onzichtbaar. Nu hersteld (zonder downloads), met een vaste statusregel bovenin en een knop ‘Nu controleren’.
- Nieuw: ‘Niet van toepassing’ als eigen keuze met reden; per punt genoemd, uitgelegd of door de klant bevestigd; overzicht na afloop met fragment, tijdstip en spreker, te kopiëren en te bewaren.

### Bewijs

- 326 Python-, 754 Node- en 455 renderertests, typecontrole, lint en vertaalgate geslaagd.
- 18 Electron-proeven tegen het gebouwde pakket geslaagd; de ingebouwde verwerker maakt de voorlopige niveaus zonder model; ondertekening geldig, ook na uitpakken.

### Bekende grenzen

- De AI-niveaus worden gemaakt bij het openen van een notitie, nog niet direct als stap na het samenvatten.
- Niet getest met het echte lokale model (bewust, om downloads te voorkomen); één proef na installatie nodig voor vouwen en checklist.
- Het checklistoverzicht staat onder Home, nog niet bij de notitie zelf.
- Niet overgenomen uit TextFold: vertalen, markeringen, zoeken, de Onderwerpen-mindmap.
- Voorlopige onderwerpen zijn de eerste drie woorden van een zin, zoals in TextFold; in het Nederlands beginnen die vaak met een lidwoord.
- Bevat een AI-niveau een dollarteken-paar (zoals ‘$5 en $10’), dan wordt de AI-versie geweigerd en blijven de voorlopige niveaus staan.
- Het openen van een notitie start de AI-niveaus met de ingestelde aanbieder, ook als dat een cloudaanbieder is (dezelfde tekst als de samenvatting zelf).
- Het bewaarde checklistoverzicht (.md) neemt regeleinden uit modeltekst ongefilterd over.

## 0.9.1, testkandidaat, 2026-10-29

Status: gebouwd, lokaal ondertekend en getest; niet Apple-genotariseerd, niet geïnstalleerd. Onafhankelijke review akkoord, zonder blokkerende bevindingen.

Pakket: `.local/veneta-0.9.1/Veneta-MemoAi-0.9.1-arm64.zip`, 304.914.808 bytes, SHA-256 `701e57b7298646ad09713fc4aefe700fb184900e428867ac573e07aa484d32a1`.

### Opgelost

- ‘Bereid detailniveaus voor’ faalde met het lokale standaardmodel. Oorzaak: het model verpakte de JSON in een codeblok, gaf te veel bronzinnen, sloeg secties over of splitste ze op subkoppen; de strikte controle wees dat allemaal af met één algemene melding. Nu worden codeblokken verwijderd, bewijs begrensd, ontbrekende secties tot drie keer opnieuw gevraagd en dubbele secties samengevoegd. De JSON-controle zelf blijft strikt.
- Een fout toont nu een concrete reden met advies: geen geldige structuur, time-out, samenvatting te lang, aanbieder niet bereikbaar of al bezig.
- Detailniveaus voorbereiden start nooit meer een modeldownload.
- De checklistsleutel wisselt niet meer kort bij het voortzetten van een notitie.

### Gewijzigd

- De detailbalk is een vaste pil onderin het midden van het venster, zoals in TextFold, met Volledig, Beknopt, Kern, Kernzin en Onderwerpen. Niet meer in de tekst boven de kernpunten.
- Altijd zichtbaar bij een samenvatting. Volledig werkt zonder AI; de eerste keer een korter niveau kiezen bereidt de niveaus voor, met voortgang.
- Zoomen met de toetsen 1 tot 5 of door te scrollen op de pil. Kernpunten vouwen mee. Onderwerpen toont de secties als kaarten.

### Bewijs

- 292 Python-, 741 Node- en 418 renderertests, typecontrole, lint en vertaalgate geslaagd.
- 16 Electron-proeven tegen het gebouwde pakket geslaagd; ondertekening geldig, ook na uitpakken.
- Met een synthetische Nederlandse samenvatting van 3839 woorden faalde de oude code 4 van 4 keer tegen het lokale standaardmodel; de nieuwe code slaagde 3 van 3 keer (6 tot 22 seconden). Geen uitspraak over inhoudelijke kwaliteit.

### Bekende grenzen

- Eerder voorbereide detailniveaus gelden niet meer, omdat de kernpunten nu meetellen.
- Een gewone samenvatting kan bij een ontbrekend model nog steeds automatisch downloaden (bestaand gedrag).
- De wachttijd zonder voortgang (4 minuten) telt per groep secties, niet per modelaanroep. Een traag, koud gestart model met herhaalde fouten kan daardoor op time-out stoppen terwijl het nog bezig is. Er wordt dan niets opgeslagen of verzonnen.
- Ontbreekt het ingestelde model, dan gebruikt het voorbereiden een ander al geïnstalleerd lokaal model in plaats van te melden dat het model ontbreekt.
- Bereid je in twee notities tegelijk voor, dan kan de tweede kort de voortgangstellers van de eerste tonen (geen inhoud).

## 0.9.0, testkandidaat, 2026-10-29

Status: gebouwd, lokaal ondertekend en getest; niet Apple-genotariseerd, niet geïnstalleerd. Alle onafhankelijke beoordelingen akkoord, inclusief de controle van de twee checklistreparaties.

Pakket: `.local/veneta-0.9.0-r2/Veneta-MemoAi-0.9.0-arm64.zip`, 304.895.131 bytes, SHA-256 `4d8109c73a7d1ec59ea4c7063bc79fbf5efdbfdd3cd9a7a9169fd62a730ff9cf`. Een eerdere 0.9.0-build in `.local/veneta-0.9.0` is vervangen en niet opgeleverd.

### Nieuw

- Knop ‘Samenvatting opnieuw maken’ bij een bestaand gesprek met transcript, zonder opnieuw te transcriberen.
- Lengte en samenvattingstemplate per keer kiezen, zonder de algemene voorkeur te wijzigen.
- Vorige samenvattingen blijven als versie terug te lezen; transcript en eigen notities blijven intact, ook bij een fout.
- De vijf leesniveaus sluiten aan op de gekozen, gegenereerde versie, ook bij eigen rapporten.
- Meerdere benoemde checklistsjablonen maken, bewerken, kiezen en vóór de opname klaarzetten.
- Iedere opname krijgt een eigen checklistkopie; voortgang wijzigt het sjabloon niet.
- De checklist staat tijdens het gesprek altijd rechts naast de notities, niet meer als tab in het transcript. Het transcript is apart in en uit te klappen.
- Handmatig afvinken zonder AI; AI-controle en automatisch controleren blijven aparte opt-ins.

### Opgelost na review

- Checklistvoortgang werd per weergavenaam bewaard. Twee opnamen met dezelfde naam (standaard ‘Note’) deelden daardoor punten en voortgang. Nu per opname, of per notitie bij doorgaan.
- Een checklistpunt bewerken wiste de handmatige voortgang van alle andere punten. Nu blijft voortgang van ongewijzigde punten behouden.

### Bewijs

- 280 Python-, 736 Node- en 411 renderertests, typecontrole, lint en vertaalgate geslaagd.
- 14 Electron-proeven tegen het gebouwde pakket geslaagd, plus een synthetische pakketproef met eigen lokale testserver.
- Ondertekening strikt geldig, ook na uitpakken; versie 0.9.0, interne identiteit `local.memoa.test` ongewijzigd.

### Bekende grenzen

- Inhoud van ‘Adviseur Sales Checklist’ nog niet aangeleverd; er zijn geen criteria verzonnen.
- Een nieuwe opname die later in dezelfde notitie wordt voortgezet, start bij het voortzetten met een verse kopie van het klaargezette sjabloon.
- Geen bewijs van inhoudelijke AI-kwaliteit; kernschermen nog niet volledig Nederlands.

### Niet in deze release

- Checklistcontrole achteraf over een volledig gesprek (voorgesteld, niet goedgekeurd).
- Nieuwe cloudprovider, Entra-koppeling, modeldownload of gegevensmigratie.

## Historische testbuilds met bronversie 0.8.0

De eerdere builds gebruikten nog het overgenomen bronversienummer 0.8.0. Daarom zijn de opleveringen hieronder herkenbaar aan hun oorspronkelijke naam en datum. Ze worden niet achteraf omgenummerd.

### Samenvatting en detailbalk, 2026-10-29

Oorspronkelijk pakket: `Veneta-MemoAi-arm64-samenvatting.zip`.

- Nieuwe samenvattingen standaard uitgebreid, met instelbare generatielengte.
- Vijf voorbereide leesniveaus: Volledig, Beknopt, Kern, Kernzin en Onderwerpen.
- Expliciete AI-voorbereiding, opgeslagen brongebonden lagen en lokaal schuiven zonder nieuwe modelaanroep.
- Afzonderlijk uitklappen en opvraagbare bronzinnen uit de volledige samenvatting.
- 274 gerichte Python-, 727 Node- en 402 renderer-tests geslaagd; zes gebruikersproeven in het gebouwde pakket geslaagd. Onafhankelijke beoordelingen akkoord.
- Lokaal ondertekend, niet Apple-genotariseerd. Geen wijziging van bestaande gesprekken of installatie.
- SHA-256: `1ec6fb1e13a69b5703e301599e3098eb850668e1ea58876075eafdc7cfb035e4`.
- Grenzen: geen inhoudelijke modelkwalificatie; geen detailbalk voor aparte template-rapporten; geen herstel van ontbrekende details uit een al verkorte samenvatting.

### Productmodules, moduleproef r2, 2026-10-29

Oorspronkelijk pakket: `Veneta-MemoAi-arm64-moduleproef-r2.zip`.

- Runtime Default-/Veneta-profielen en afzonderlijk inschakelbare Gesprekschecklist.
- Eerste live-checklist met eigen criteria, expliciete AI-toestemming, bevestiging van het verkoperskanaal, menselijke correcties en één standaardlijst.
- Lokale modelcontrole, veilige verzoekoverdracht en bewaking tegen verouderde antwoorden.
- Opgelost: te lange transcripties blokkeren niet meer het opslaan van geldige criteria en menselijke correcties.
- 261 gerichte Python-, 715 Node- en 374 renderer-tests geslaagd; vier gebruikersproeven in het gebouwde pakket geslaagd. Onafhankelijke beoordelingen akkoord.
- SHA-256: `020b78ff04aa1a63a34cf482e394537021da0bc30a3a4bd9d680abd4161f69c9`.
- Grenzen: checklist zat nog als tab in het live-transcriptpaneel; geen meerdere benoemde lijsten of volwaardige controle achteraf.

### Veneta-interface, fase 1, 2026-10-28

Oorspronkelijk pakket: `Veneta-MemoAi-arm64-fase-1.zip`.

- Veneta-huisstijl, lettertype en zwarte V op geel voor app en menubalk.
- Opname-layout met eigen notities en live-transcriptweergave.
- Bestaande interne testidentiteit en gegevenspaden behouden.
- 237 gerichte Python-, 703 Node- en 327 renderer-tests geslaagd.
- Broncommit: `4652cf1d290766c59edd55e7a848ef3ba2551aa0`.
- SHA-256: `7e152141d2011ea2bc0ba2831de165975b1f8283990d06c3dda1df8276ab3690`.
