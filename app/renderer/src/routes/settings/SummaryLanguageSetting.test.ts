import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const brand = vi.hoisted(() => ({ veneta: true }));
vi.mock('@/lib/productBrand', () => ({
  get IS_VENETA_MEMOAI() {
    return brand.veneta;
  },
}));

import { summaryLanguageOptions } from './SummaryLanguageSetting';

describe('summary language setting', () => {
  it('offers following the meeting plus every pinned language, Dutch in the Veneta build', () => {
    const options = summaryLanguageOptions();
    expect(options[0]).toEqual({ value: 'auto', label: 'Zelfde taal als het gesprek' });
    expect(options.map((option) => option.value)).toContain('nl');
  });

  it('is shown only in the Veneta build, after the detail setting and before the provider', () => {
    const source = readFileSync('renderer/src/routes/settings/AiTab.tsx', 'utf8');
    const section = source.slice(source.indexOf('function SummarisationSection()'));
    const row = section.indexOf('{IS_VENETA_MEMOAI && <SummaryLanguageSetting />}');
    expect(row).toBeGreaterThan(section.indexOf('<SummaryDetailSettings />'));
    expect(row).toBeLessThan(section.indexOf("label={t('settingsAiTab.aiProvider')}"));
  });
});
