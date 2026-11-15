import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from '../fixtures/electron';
import { emitBufferedLiveSegments as emitLiveSegments } from '../fixtures/buffered-live-transcript';
import { ui } from '../fixtures/ui-copy';

// 0.10.1: Martin's recording showed points 1 and 2 half, then everything full, then a reset. A small local model is not
// stable between runs, so a later check may say "not mentioned" about a point it found before. The host now keeps what
// was said: levels per point only go up while the quoted segment still stands. The mock model answers with the points
// found at the first check and "not mentioned" for every later one; the real host planner, guards and files stay in the loop.
const launchOptions = { mockIpc: true, fakeAudio: true, releaseHighlightsSeen: true,
  env: { STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1', STENOAI_E2E_PRODUCT_PROFILE: 'veneta', STENOAI_E2E_SEED_CHECKLIST_NOTE: '1', STENOAI_E2E_CHECKLIST_FLIP: '1' } };
const moduleSwitch = (page: Page) => page.getByRole('switch', { name: 'Gesprekschecklist', exact: true });
const card = (page: Page) => page.getByTestId('checklist-choice');
const modelCalls = (app: ElectronApplication) => app.evaluate(() => (global as typeof global & { __checklistModelCalls?: number }).__checklistModelCalls ?? 0);
const held = (page: Page) => page.evaluate(async () => {
  const answer = await window.stenoai.checklists.liveState();
  return answer.success && answer.live.active ? answer.live.counters.held : -1;
});

test('a point the model found stays found when later checks say not mentioned: sidebar, remount and the note tab show the same', async ({ launchApp }) => {
  test.setTimeout(180_000);
  const { app, page } = await launchApp(launchOptions);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('[data-app-ready]')).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#/settings?tab=product'; });
  await moduleSwitch(page).click();
  await page.evaluate(() => { window.location.hash = '#/'; });
  await card(page).getByRole('button', { name: '+ Eigen checklist maken', exact: true }).click();
  await card(page).getByRole('textbox', { name: 'Naam van je checklist', exact: true }).fill('Proeflijst');
  await card(page).getByRole('textbox', { name: 'Checklistpunten (één per regel)', exact: true }).fill('Leg gratis inmeten uit\nNoem de garantie\nMaak een concrete vervolgafspraak');
  await card(page).getByRole('button', { name: 'Bewaar checklist', exact: true }).click();
  await expect(card(page).getByText('Staat klaar · AI controleert automatisch mee', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: ui('mainToolbar.newNote'), exact: true }).last().click();
  const sidebar = page.locator('[data-checklist-runtime]');
  await expect(sidebar.getByRole('listitem')).toHaveCount(3);
  const session = await page.evaluate(async () => (await window.stenoai.recording.getQueue()).sessionName as string);
  const first = sidebar.getByRole('listitem').first();
  const diagnostics = sidebar.locator('[data-checklist-diagnostics]');

  await emitLiveSegments(app, session, [
    { text: 'Wij komen gratis meten bij u thuis.', start: 0, end: 2, isFinal: true, speaker: 'You' },
    { text: 'Dat is akkoord voor ons.', start: 4, end: 5, isFinal: true, speaker: 'Others' },
    { text: 'Daarna maken we een offerte met alle details.', start: 7, end: 9, isFinal: true, speaker: 'You' },
  ]);
  // First check after the quiet period: the point is explained and confirmed by the customer.
  await expect(first).toHaveAttribute('data-state', 'done', { timeout: 75_000 });
  await expect(diagnostics).toContainText('controles 1');
  expect(await modelCalls(app)).toBe(1);

  // More speech, a second check: the model now says "not mentioned" about everything. The sidebar keeps what was said.
  await emitLiveSegments(app, session, [{ text: 'Verder nog een losse opmerking over het weer.', start: 12, end: 14, isFinal: true, speaker: 'You' }]);
  await expect(diagnostics).toContainText('controles 2', { timeout: 75_000 });
  expect(await modelCalls(app)).toBe(2);
  await expect(first).toHaveAttribute('data-state', 'done');
  await expect(first.locator('[data-customer-confirmed]')).toBeVisible();
  expect(await held(page)).toBeGreaterThanOrEqual(1);

  // A remount in the middle of the recording (route change and back) shows the host's truth, not a reset.
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.getByRole('button', { name: ui('mainToolbar.openRecording'), exact: true }).click();
  await expect(sidebar.getByRole('listitem').first()).toHaveAttribute('data-state', 'done');

  // The last check at stop follows the same rule, and the note tab reads the same persisted result.
  await emitLiveSegments(app, session, [{ text: 'Tot ziens en bedankt voor het gesprek.', start: 20, end: 22, isFinal: true, speaker: 'You' }]);
  await page.getByRole('button', { name: ui('liveDock.showTranscript'), exact: true }).click();
  await page.getByTestId('live-transcript-panel').getByRole('button', { name: ui('mainToolbar.stopRecording'), exact: true }).click();
  const tab = page.getByTestId('tab-checklist');
  await expect(tab).toBeVisible();
  // The last check starts after the drain; wait for it to have run and for the note tab to stop saying it is running.
  await expect.poll(() => modelCalls(app), { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
  await tab.click();
  await expect(page.getByTestId('checklist-final-running')).toHaveCount(0, { timeout: 30_000 });
  await expect(tab).toHaveText('Proeflijst 1/3');
});
