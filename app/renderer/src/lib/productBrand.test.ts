import { afterEach, describe, expect, it, vi } from 'vitest';

async function brand(flag: string) {
  vi.resetModules();
  vi.stubEnv('VITE_VENETA_MEMOAI', flag);
  return import('./productBrand');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('product build boundary', () => {
  it('activates the exact approved name only for the explicit Veneta build', async () => {
    const product = await brand('1');
    expect(product.IS_VENETA_MEMOAI).toBe(true);
    expect(product.APP_NAME).toBe('Veneta MemoAi');
    const { t } = await import('../i18n');
    expect(t('recording.notesHeading')).toBe('Mijn notities');
    expect(t('recording.transcriptHeading')).toBe('Live transcriptie');
  });

  it('retains legacy branding outside the Veneta build', async () => {
    const product = await brand('0');
    expect(product.IS_VENETA_MEMOAI).toBe(false);
    expect(product.APP_NAME).toBe('Steno');
    const { t } = await import('../i18n');
    expect(t('recording.notesHeading')).toBe('My notes');
    expect(t('recording.microphone')).toBe('Microphone');
  });
});
