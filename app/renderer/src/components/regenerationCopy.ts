import { createTranslator } from '@/i18n';
export const regenerationText = createTranslator({
  open: 'Opnieuw samenvatten',
  length: 'Lengte voor deze versie',
  template: 'Samenvattingssjabloon',
  brief: 'Kort', balanced: 'Gebalanceerd', detailed: 'Uitgebreid',
  generate: 'Maak nieuwe versie', cancel: 'Annuleren',
  help: 'Gebruikt het bestaande transcript, zonder opnieuw te transcriberen. Vorige versies blijven terug te lezen. Dit wijzigt je standaardinstelling niet.',
  loadError: 'De standaardlengte kon niet worden geladen. Kies zelf een lengte voor deze versie.',
});
