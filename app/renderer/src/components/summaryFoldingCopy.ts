import type { FoldFailureReason } from '@/lib/summaryFoldingContracts';

const unchanged = 'Je bestaande notities zijn niet gewijzigd.';
const copy = {
  explanation:
    'Alleen de al gegenereerde samenvatting gaat eenmalig naar de ingestelde AI-aanbieder, niet het transcript. Je bestaande notities worden niet overschreven.',
  makeLevels: 'AI-niveaus maken',
  loading: 'Opgeslagen detailniveaus laden…',
  preparing: 'Detailniveaus voorbereiden…',
  loadError:
    'De opgeslagen detailniveaus konden niet worden geladen. Je bestaande notities blijven beschikbaar.',
  retry: 'Opnieuw proberen',
  settingsTitle: 'Detail van nieuwe samenvattingen',
  settingsExplanation:
    'Geldt alleen voor toekomstige samenvattingen. Bestaande notities worden niet gewijzigd. Standaard: uitgebreid.',
  settingsLoading: 'Samenvattingsinstelling laden…',
  settingsSaving: 'Samenvattingsinstelling opslaan…',
  settingsLoadError: 'De samenvattingsinstelling kon niet worden geladen.',
  settingsSaveError: 'De instelling kon niet worden opgeslagen. De vorige keuze blijft actief.',
} as const;

/** One content-free explanation with concrete advice per host failure reason. */
const failures: Record<FoldFailureReason, string> = {
  invalid_structure: `Het model gaf geen geldige structuur terug, ook niet na een nieuwe poging. ${unchanged} Probeer het opnieuw of kies onder Instellingen › AI een groter model.`,
  timeout: `De voorbereiding duurde te lang en is gestopt. ${unchanged} Probeer het opnieuw wanneer er geen andere verwerking loopt, of kies een sneller model.`,
  too_long: `Deze samenvatting is te lang om in detailniveaus te verdelen. ${unchanged} Volledig blijft altijd beschikbaar.`,
  provider_unavailable: `De AI-aanbieder was niet bereikbaar of weigerde de aanvraag. ${unchanged} Controleer Instellingen › AI en of het lokale model draait, en probeer het opnieuw.`,
  invalid_request: `Deze samenvatting kon niet worden gelezen voor detailniveaus. ${unchanged} Volledig blijft beschikbaar.`,
  busy: `Wacht tot de huidige opname of verwerking klaar is. ${unchanged} Kies daarna opnieuw een niveau.`,
  failed: `De detailniveaus konden niet worden voorbereid. ${unchanged} Probeer het opnieuw.`,
};

export function summaryFoldingText(key: keyof typeof copy): string {
  return copy[key];
}
export function summaryFoldingFailure(reason: unknown): string {
  return typeof reason === 'string' && Object.prototype.hasOwnProperty.call(failures, reason)
    ? failures[reason as FoldFailureReason]
    : failures.failed;
}
export function summaryFoldingProgress(done: number, total: number): string {
  return `Detailniveaus voorbereiden… stap ${done} van ${total}`;
}
