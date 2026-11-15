export const nl = {
  invalidEvidence: 'Geen controleerbaar verkopersbewijs; oordeel onzeker.',
  missing: 'Geen geldig oordeel voor dit criterium ontvangen.',
  reason_server_unreachable: 'De lokale AI-dienst is niet bereikbaar. Veneta MemoAi probeert hem zelf te starten; lukt dat niet, start de app dan opnieuw.',
  reason_server_start_failed: 'De lokale AI-dienst kon niet worden gestart. Start de app opnieuw en controleer in Instellingen onder AI of een lokaal model is gekozen.',
  reason_model_missing: 'Het gekozen lokale model is niet geïnstalleerd. Download het model in Instellingen onder AI; de checklist downloadt zelf nooit iets.',
  reason_model_not_local: 'Het gekozen model is niet aantoonbaar lokaal. Kies in Instellingen onder AI een lokaal model.',
  reason_timeout: 'Het lokale model antwoordde niet op tijd. Probeer het later opnieuw of kies een kleiner model in Instellingen onder AI.',
  reason_invalid_answer: 'Het lokale model gaf geen bruikbaar antwoord. Probeer het opnieuw; er is niets bewaard.',
  reason_empty_answer: 'Het lokale model gaf een leeg antwoord. Probeer het opnieuw; er is niets bewaard.',
  reason_not_json: 'Het lokale model antwoordde niet in het gevraagde formaat. Probeer het opnieuw of kies in Instellingen onder AI een ander model; er is niets bewaard.',
  reason_wrong_shape: 'Het lokale model gaf een andere structuur terug dan gevraagd. Probeer het opnieuw of kies in Instellingen onder AI een ander model; er is niets bewaard.',
  reason_truncated: 'Het antwoord van het lokale model werd afgekapt. Probeer het opnieuw met minder punten of kies een ander model in Instellingen onder AI; er is niets bewaard.',
  reason_provider_not_local: 'Checklistcontrole werkt alleen met de lokale AI-provider. Kies Lokaal in Instellingen onder AI.',
  reason_invalid_request: 'De punten of het transcript zijn ongeldig of te groot voor één controle. Verkort de punten en probeer opnieuw.',
  reason_config_invalid: 'De lokale AI-instellingen zijn onleesbaar. Controleer Instellingen onder AI.',
  reason_module_disabled: 'De Gesprekschecklist staat uit. Zet haar aan onder Instellingen, Veneta, Uitbreidingen.',
  reason_busy: 'Er loopt al een controle. Probeer het zo opnieuw.',
  reason_failed: 'De controle kon niet worden afgerond. Probeer het opnieuw.',
} as const;
export type ChecklistCopyKey = keyof typeof nl;
export function checklistText(key: ChecklistCopyKey, params: Record<string, string | number> = {}): string {
  return nl[key].replace(/\{\{(\w+)\}\}/g, (token, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : token));
}
