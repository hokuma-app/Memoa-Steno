import { test, expect } from '../fixtures/electron';
import type { Page } from '@playwright/test';

/**
 * T1 (0.10.2) — a speaker linked to a name AFTER the summary was made shows that name everywhere in the note:
 * summary, topics, key points, action items (the owner), the detail levels (local and AI) and the copy, without a
 * reload; "Speaker 20" is never touched; unlinking brings the label back; the saved note is never written.
 *
 * Model-free: the mock IPC layer stands in for the backend. The host's derivation of which label became which name
 * (from the speaker sidecar and the transcript) is proven separately against real files in
 * app/speaker-label-names.test.js; here the mock supplies `speaker_label_names` from the confirmations.
 */

const SUMMARY_FILE = 'speaker-review-mtg_summary.json';
const ENV = {
  STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1',
  STENOAI_E2E_SEED_SPEAKER_NAMES: '1',
  STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1',
};
const bar = (page: Page) => page.locator('.summary-fold-dock .zoombar');
const pressed = (page: Page) => bar(page).locator('[aria-pressed="true"]');
const panel = (page: Page) => page.getByTestId('summary-folding-panel');
const label2 = /Speaker 2(?!\d)/;

async function installClipboardRecorder(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __clipboardWrites: string[] };
    w.__clipboardWrites = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (text: string) => { w.__clipboardWrites.push(text); return Promise.resolve(); } },
    });
  });
}
const lastCopy = async (page: Page) =>
  (await page.evaluate(() => (window as unknown as { __clipboardWrites: string[] }).__clipboardWrites)).slice(-1)[0];
const copyNotes = async (page: Page) => {
  const before = await page.evaluate(() => (window as unknown as { __clipboardWrites: string[] }).__clipboardWrites.length);
  await page.getByRole('button', { name: 'Copy notes' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __clipboardWrites: string[] }).__clipboardWrites.length)).toBe(before + 1);
  return lastCopy(page);
};
const openNote = async (page: Page) => {
  await page.evaluate((f) => { window.location.hash = `#/meetings/${encodeURIComponent(f)}`; }, SUMMARY_FILE);
  await expect(page.getByTestId('speaker-review-panel')).toBeVisible();
  await expect(panel(page)).toHaveAttribute('data-provenance', 'ai', { timeout: 15000 });
};
type App = { evaluate: <T>(fn: () => T) => Promise<T> };
const mockCalls = (app: App) => app.evaluate(() => (globalThis as unknown as { __mockIpcCalls: string[] }).__mockIpcCalls);

test('a name linked after the summary shows in the note, the detail levels and the copy, and unlinking brings the label back', async ({ launchApp }) => {
  const { app, page } = await launchApp({ mockIpc: true, releaseHighlightsSeen: true, env: ENV });
  await page.setViewportSize({ width: 1440, height: 900 });
  await installClipboardRecorder(page);
  await openNote(page);

  // Before: the labels as the model wrote them, in the fold and under it (action items).
  const actions = page.locator('ul.mv-bullets').last();
  await expect(actions).toContainText('Speaker 2: plan de demo in');
  await expect(actions).toContainText('Speaker 20: stuur de offerte (due 2026-11-06)');
  await expect(panel(page)).toContainText('Speaker 2 wil de demo plannen');
  expect(await copyNotes(page)).toMatch(label2);

  const callsBefore = (await mockCalls(app)).length;

  // Link a name to the speaker, in the app (the real panel), no reload.
  const row = page.getByTestId('speaker-row-mic:SPEAKER_2');
  await row.getByRole('button', { name: 'New person' }).click();
  await page.getByTestId('speaker-new-person-input').fill('Anna de Vries');
  await page.getByTestId('speaker-new-person-input').press('Enter');
  await expect(row).toContainText('✓ Confirmed as Anna de Vries');

  // After: the owner, the summary, the topics and key points in the reader, all show the name; Speaker 20 stays.
  await expect(actions).toContainText('Anna de Vries: plan de demo in');
  await expect(actions).toContainText('Speaker 20: stuur de offerte (due 2026-11-06)');
  await expect(panel(page)).toContainText('Anna de Vries wil de demo plannen');
  await expect(panel(page)).toContainText('Speaker 20 vraagt om de offerte');
  await expect(panel(page)).toContainText('Demo van Anna de Vries');
  const full = await copyNotes(page);
  expect(full).not.toMatch(label2);
  expect(full).toContain('Anna de Vries: plan de demo in');
  expect(full).toContain('Speaker 20: stuur de offerte');

  // The chosen detail level survives the rename and the copy of that level carries the name too.
  await bar(page).getByRole('button', { name: 'Beknopt', exact: true }).click();
  await expect(pressed(page)).toHaveText('Beknopt');
  await expect(page.locator('.tf-root .doc[data-level="3"]')).toBeVisible();
  const brief = await copyNotes(page);
  expect(brief).not.toMatch(label2);
  expect(brief).toContain('Anna de Vries');

  // Another person for the same speaker: the note follows at once, still at Beknopt.
  await row.getByRole('button', { name: 'Change' }).click();
  await page.getByTestId('speaker-pick-person-p-beta').click();
  await expect(row).toContainText('Confirmed as Person Beta');
  await expect(actions).toContainText('Person Beta: plan de demo in');
  await expect(pressed(page)).toHaveText('Beknopt');
  const changed = await copyNotes(page);
  expect(changed).toContain('Person Beta');
  expect(changed).not.toContain('Anna de Vries');

  // The full-note copy from the menu has the name as well.
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByTestId('copy-full-notes').click();
  const menuCopy = await lastCopy(page);
  expect(menuCopy).toContain('Person Beta: plan de demo in');
  expect(menuCopy).not.toMatch(label2);

  // Nothing wrote the saved note while names were linked and changed.
  const written = (await mockCalls(app)).slice(callsBefore).filter((c) => /^(update|save|write|delete)-(meeting|summary|note)/.test(c));
  expect(written).toEqual([]);

  // Unlink in the app: marking the speaker as "more than one person" withdraws the name (the host restores the label
  // in the transcript), and the note shows the label again at once.
  await row.getByTestId('speaker-mark-multi-mic:SPEAKER_2').click();
  await expect(row).toContainText('More than one person');
  await expect(actions).toContainText('Speaker 2: plan de demo in');
  await expect(actions).not.toContainText('Person Beta');
  await expect(panel(page)).toContainText('Speaker 2 wil de demo plannen');
  expect(await copyNotes(page)).toMatch(label2);
});
