import { describe, expect, it, vi } from 'vitest';
import en from './locales/en.json';
import nl from './locales/veneta-nl.json';

const brand = vi.hoisted(() => ({ veneta: false }));
vi.mock('@/lib/productBrand', () => ({
  get IS_VENETA_MEMOAI() {
    return brand.veneta;
  },
}));

import { t, type TranslationKey } from './index';

const english: Record<string, string> = en;
const dutch: Record<string, string> = nl;
const placeholders = (value: string) =>
  [...value.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((match) => match[1]).sort();

// Values that are the same word in Dutch: product names, units, URLs and placeholders.
// Anything else that equals the English text is an untranslated string.
const SAME_IN_DUTCH = new Set([
  'settings.ai.cloudAsr.modelLabel',
  'settings.ai.cloudAsr.apiUrlPlaceholder',
  'settings.ai.cloudAsr.modelPlaceholder',
  'settings.ai.cloudAsr.apiKeyPlaceholder',
  'settings.ai.diarization.nemotron3Name',
  'chat.context.label',
  'models.fn.checklist',
  'models.add.start',
  'askBar.transcript',
  'liveTranscriptBar.transcript',
  'sidebar.chat',
  'sidebar.org',
  'updateToast.update',
  'updateToast.v',
  'home.google',
  'home.outlook',
  'home.ctrl',
  'home.shift',
  'home.r',
  'meetingDetail.details',
  'setup.cloud',
  'setup.anthropicClaude',
  'setup.awsBedrockClaude',
  'setup.usEast1',
  'setup.usAnthropicClaude',
  'setup.httpsApiExampleComV1',
  'setup.skAnt',
  'setup.sk',
  'settingsAiTab.model',
  'settingsAiTab.http1921681100',
  'settingsAiTab.anthropicClaude',
  'settingsAiTab.awsBedrockClaude',
  'settingsAiTab.usEast1',
  'settingsAiTab.usAnthropicClaude',
  'settingsAiTab.httpsApiExampleComV1',
  'settingsAiTab.skAnt',
  'settingsAiTab.sk',
  'settingsAiTab.anthropicClaudeV10',
  'settingsAiTab.claude',
  'settingsAiTab.gpt',
  'settingsGeneralTab.google',
  'settingsGeneralTab.outlook',
  'settingsOrganisationTab.org',
  'settingsOrganisationTab.httpsStenoAdapterYourcompanyCom',
  'agentSkills.agents',
  'transcriptBundle.transcript',
  'chat.cloud',
  'settingsLanguages.hindi',
  'settingsSettingsNav.ai',
  'processing.sec',
  'processing.min',
  'upcomingCard.minutes.one',
  'previousRow.duration.minutes',
  'previousRow.duration.seconds',
  'meetingDetail.duration.minutes',
  'meetingDetail.duration.seconds',
  'processing.elapsed.seconds',
  'processing.elapsed.minutesSeconds',
]);

describe('Veneta Dutch catalogue', () => {
  it('translates every English key and nothing else', () => {
    expect(Object.keys(dutch).filter((key) => !(key in english))).toEqual([]);
    expect(Object.keys(english).filter((key) => !(key in dutch))).toEqual([]);
  });

  it('keeps every interpolation parameter', () => {
    expect(placeholders('{{b}} and {{ a }}')).toEqual(['a', 'b']);
    const mismatched = Object.keys(english).filter(
      (key) => JSON.stringify(placeholders(english[key])) !== JSON.stringify(placeholders(dutch[key] ?? '')),
    );
    expect(mismatched).toEqual([]);
  });

  it('leaves no English text behind, apart from the reviewed identical values', () => {
    const untranslated = Object.keys(english).filter(
      (key) => !dutch[key]?.trim() || (dutch[key] === english[key] && !SAME_IN_DUTCH.has(key)),
    );
    expect(untranslated).toEqual([]);
    for (const key of SAME_IN_DUTCH) expect(dutch[key]).toBe(english[key]);
  });

  it('uses Dutch in the Veneta build and English in the default build', () => {
    const key = 'sidebar.settings' as TranslationKey;
    brand.veneta = false;
    expect(t(key)).toBe('Settings');
    brand.veneta = true;
    expect(t(key)).toBe('Instellingen');
    expect(t('meetingDetail.shareWith', { orgId: 'Veneta' })).toBe('Delen met Veneta');
    brand.veneta = false;
    expect(t('meetingDetail.shareWith', { orgId: 'Veneta' })).toBe('Share with Veneta');
  });
});
