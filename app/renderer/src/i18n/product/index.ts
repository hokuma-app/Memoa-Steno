import { createTranslator } from '@/i18n';

// Isolated Dutch product catalogue: does not change the existing UI language.
export const productCopy = {
  'product.welcome': 'Welkom bij Veneta MemoAi.',
  'product.title': 'Product en modules',
  'product.profile': 'Productprofiel',
  'product.default': 'Default',
  'product.veneta': 'Veneta',
  'product.description':
    'Default behoudt de bestaande forkfuncties, zonder Veneta-modules. Veneta voegt de Veneta-uitstraling en optionele modules toe.',
  'product.separation':
    'Dit staat los van licht, donker of systeem, de interfacetaal en je AI-profielen. Accounts, aanmeldingen en modelinstellingen blijven ongewijzigd.',
  'product.modules': 'Optionele Veneta-modules',
  'product.checklist': 'Gesprekschecklist',
  'product.checklistDescription':
    'Standaard uit. Toont de gekozen checklist naast je notities tijdens een gesprek en controleert automatisch mee. Uitschakelen stopt nieuwe analyses, ook tijdens een opname.',
  'product.permission':
    'Inschakelen geeft geen toestemming voor cloudaanroepen: alleen de lokale AI wordt gebruikt, zonder downloads. Zodra je een checklist voor de volgende opname klaarzet, controleert die AI automatisch mee. Kies Geen checklist om dat te voorkomen.',
  'product.sellerMic': 'Mijn microfoon is de verkoper',
  'product.sellerMicDescription':
    'Standaard aan: de microfoon geldt als de verkoper en het systeemgeluid als de klant. Zet dit uit als dat bij jou niet klopt; de AI kan dan alleen noteren dat een punt genoemd is, niet dat de verkoper het uitlegde.',
  'product.sellerMicError':
    'Verkoperskanaal kon niet worden gelezen of opgeslagen. De laatst bevestigde instelling blijft gelden.',
  'product.retention':
    'Bij Default zijn Veneta-modules niet actief. Je moduleconfiguratie en bestaande bestanden blijven bewaard.',
  'product.busy':
    'Tijdens een opname of verwerking kun je het productprofiel niet wijzigen of een module inschakelen. Een actieve module kun je wel uitschakelen.',
  'product.loading': 'Productinstellingen laden…',
  'product.error':
    'Productinstellingen konden niet worden geladen of opgeslagen. De laatst bevestigde instellingen blijven gelden.',
} as const;
export type ProductTranslationKey = keyof typeof productCopy;
export const productText = createTranslator(productCopy);
