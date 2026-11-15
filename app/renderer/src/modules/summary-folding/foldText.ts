import type { FoldLevel, SummaryDetail } from '../../lib/summaryFoldingContracts';

/** Module-local Dutch copy; intentionally not the canonical application's t(). */
export const foldText = {
  reader: 'Samenvatting',
  detail: 'Samenvattingsdetail',
  ai: 'AI',
  levels: {
    full: 'Volledig',
    brief: 'Beknopt',
    key: 'Kern',
    takeaway: 'Kernzin',
    topic: 'Onderwerpen',
  } satisfies Record<FoldLevel, string>,
  showFull: 'Volledige paragraaf tonen',
  collapse: 'Terug naar gekozen detail',
  source: 'Bron in samenvatting tonen',
  evidence: 'Zinnen uit de volledige samenvatting',
  sourceNote: 'Bron: de volledige samenvatting, niet het transcript.',
  fixtureNote: 'Besluiten en acties blijven buiten deze lezer bereikbaar.',
  hint: 'Scroll op deze balk om te zoomen, toetsen 1 tot 5',
  provisional: 'Voorlopig: de AI-niveaus worden gemaakt. Zoomen werkt al, toetsen 1 tot 5',
  hintUnprepared: 'Kies een niveau om het eenmalig voor te bereiden, toetsen 1 tot 5',
  empty: 'Geen samenvatting beschikbaar.',
  settings: 'Lengte van nieuwe samenvattingen',
  choices: { brief: 'Kort', balanced: 'Gemiddeld', detailed: 'Uitgebreid' } satisfies Record<
    SummaryDetail,
    string
  >,
  settingsHelp:
    'Dit bepaalt de lengte bij het maken van een samenvatting. De detailbalk verandert alleen de weergave.',
} as const;
export const foldLevels: readonly FoldLevel[] = ['full', 'brief', 'key', 'takeaway', 'topic'];
