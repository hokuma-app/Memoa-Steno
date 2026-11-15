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

  it('offers "same as the meeting" first in the default build too (0.11.0: the default is auto)', () => {
    brand.veneta = false;
    try {
      const options = summaryLanguageOptions();
      expect(options[0]).toEqual({ value: 'auto', label: 'Same as the meeting' });
    } finally {
      brand.veneta = true;
    }
  });

  it('is shown in both builds (0.11.0), after the detail setting and before the provider', () => {
    const source = readFileSync('renderer/src/routes/settings/AiTab.tsx', 'utf8');
    const section = source.slice(source.indexOf('function SummarisationSection()'));
    const row = section.indexOf('<SummaryLanguageSetting />');
    expect(row).toBeGreaterThan(section.indexOf('<SummaryDetailSettings />'));
    expect(row).toBeLessThan(section.indexOf("label={t('settingsAiTab.aiProvider')}"));
    expect(section.slice(row - 40, row)).not.toContain('IS_VENETA_MEMOAI');
  });
});
