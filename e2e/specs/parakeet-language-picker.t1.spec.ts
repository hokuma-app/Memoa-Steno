import { test, expect } from '../fixtures/electron';
import type { Page } from '@playwright/test';
import { uiPart, uiText } from '../fixtures/ui-copy';

/**
 * T1 — renderer-only, mock IPC, no backend. Proves the Settings → Transcribe
 * language picker exposes the European languages on the Parakeet engine, so a
 * French/German/… user can pin their language (which drives the summary/title/
 * chat output language even though Parakeet's decoder is language-agnostic).
 * Before #264's fix the Parakeet picker offered only Auto/English, leaving
 * non-English European users stuck with English notes.
 *
 * The picker list is engine-gated in the renderer (LANGUAGES_PARAKEET in
 * Settings.tsx, mirrored by PARAKEET_LANGUAGES in hooks/useModels.ts for the
 * engine-switch coercion). Mock IPC seeds engine=parakeet + language=auto (see
 * app/e2e-mock-ipc.js) so the picker renders enabled on first paint.
 */

const EUROPEAN = ['english', 'spanish', 'french', 'german', 'dutch', 'portuguese', 'russian']
  .map((language) => uiText(`transcriptionLanguages.${language}`));
// Non-European: Whisper-only, must NOT appear on Parakeet (it can't transcribe them). Only labels that exist in
// the catalogue: an absence check of a name the app never shows proves nothing.
const NON_EUROPEAN = ['japanese', 'korean', 'hindi', 'arabic']
  .map((language) => uiText(`settingsLanguages.${language}`));

async function openTranscribeLanguagePicker(page: Page) {
  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=transcription';
  });
  // The Transcribe section now has two comboboxes (Language, and the
  // Parakeet/Whisper Model picker) — target the Language trigger by testid
  // rather than relying on it being the only one.
  const trigger = page.getByTestId('transcription-language-select');
  await expect(trigger).toBeVisible();
  await trigger.click();
}

test('Parakeet language picker offers European languages and hides non-European ones', async ({
  launchApp,
}) => {
  const { page } = await launchApp({ mockIpc: true });

  await openTranscribeLanguagePicker(page);

  // Auto + the seven European languages are pinnable on Parakeet.
  await expect(page.getByRole('option', { name: uiPart('settingsLanguages.autoDetect') })).toBeVisible();
  for (const lang of EUROPEAN) {
    await expect(page.getByRole('option', { name: lang, exact: true })).toBeVisible();
  }
  // Languages Parakeet cannot transcribe stay Whisper-only.
  for (const lang of NON_EUROPEAN) {
    await expect(page.getByRole('option', { name: lang, exact: true })).toHaveCount(0);
  }
});
