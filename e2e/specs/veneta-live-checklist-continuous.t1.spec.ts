import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '../fixtures/electron';
import { emitBufferedLiveSegments as emitLiveSegments } from '../fixtures/buffered-live-transcript';
import { ui } from '../fixtures/ui-copy';

// 0.9.4: Martin's real recording never got a single point assessed, because the plan lived in React components.
// The host now plans the automatic check, so ninety seconds of continuous speech must keep producing checks while the
// window goes to the background, the transcript folds, the route changes and the viewport changes.
const launchOptions = { mockIpc: true, fakeAudio: true, releaseHighlightsSeen: true,
  env: { STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1', STENOAI_E2E_PRODUCT_PROFILE: 'veneta', STENOAI_E2E_SEED_CHECKLIST_NOTE: '1', STENOAI_E2E_CHECKLIST_DELAY_MS: '2500' } };
const shotsDir = process.env.CHECKLIST_SHOTS_DIR;
const moduleSwitch = (page: Page) => page.getByRole('switch', { name: 'Gesprekschecklist', exact: true });
const card = (page: Page) => page.getByTestId('checklist-choice');
const modelCalls = (app: ElectronApplication) => app.evaluate(() => (global as typeof global & { __checklistModelCalls?: number }).__checklistModelCalls ?? 0);
const ipcCalls = (app: ElectronApplication, channel: string) => app.evaluate((_electron, name) => (global as typeof global & { __mockIpcCalls: unknown[] }).__mockIpcCalls.filter((call) => call === name).length, channel);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const mainWindow = (app: ElectronApplication, action: 'hide' | 'show') => app.evaluate(({ BrowserWindow }, what) => {
  const window = BrowserWindow.getAllWindows()[0];
  if (what === 'hide') { window.webContents.setBackgroundThrottling(true); window.hide(); window.emit('blur'); } else { window.showInactive(); }
}, action);

test('90 s of continuous finals through Home > New note keep producing host checks across background, transcript folding, navigation and resizing', async ({ launchApp, userDataDir }, testInfo) => {
  test.setTimeout(300_000);
  const { app, page } = await launchApp(launchOptions);
  const energySaver = await app.evaluate(({ app: electronApp }) => electronApp.isPackaged && process.env.STENOAI_VENETA_ENERGY_SAVER !== '0');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('[data-app-ready]')).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#/settings?tab=product'; });
  await moduleSwitch(page).click();
  await page.evaluate(() => { window.location.hash = '#/'; });
  // The checklist as Martin typed it: the same point three times. It is merged, said so, and shown once.
  await card(page).getByRole('button', { name: '+ Eigen checklist maken', exact: true }).click();
  await card(page).getByRole('textbox', { name: 'Naam van je checklist', exact: true }).fill('Proeflijst');
  await card(page).getByRole('textbox', { name: 'Checklistpunten (één per regel)', exact: true }).fill('Leg gratis inmeten uit\nLeg gratis inmeten uit\nLeg gratis inmeten uit\nNoem de garantie\nMaak een concrete vervolgafspraak\nLeg een korting uit');
  await expect(card(page).getByTestId('checklist-duplicates')).toHaveText('2 dubbele punten worden samengevoegd.');
  await card(page).getByRole('button', { name: 'Bewaar checklist', exact: true }).click();
  await expect(card(page).getByText('Staat klaar · AI controleert automatisch mee', { exact: true })).toBeVisible();
  // The real user route: Home, New note (no window.stenoai.recording.start shortcut).
  await page.getByRole('button', { name: ui('mainToolbar.newNote'), exact: true }).last().click();
  await expect(page.getByTestId('live-transcript-panel')).toHaveCount(0);
  await page.getByRole('button', { name: ui('liveDock.showTranscript'), exact: true }).click();
  const sidebar = page.locator('[data-checklist-runtime]');
  await expect(sidebar.getByRole('heading', { name: 'Proeflijst', exact: true })).toBeVisible();
  await expect(sidebar.getByRole('listitem')).toHaveCount(4);
  const session = await page.evaluate(async () => (await window.stenoai.recording.getQueue()).sessionName as string);
  const status = sidebar.getByRole('status', { name: 'Status AI-controle', exact: true });
  const diagnostics = sidebar.locator('[data-checklist-diagnostics]');
  await expect(diagnostics).toHaveText('tekstregels 0 · controles 0 · laatste reden geen');
  const marks: Record<number, number> = {};
  const visibility: string[] = [];
  const started = Date.now();
  for (let i = 0; i < 30; i++) {
    const at = i * 3;
    // Parakeet-like: a partial first, then the final; speakers alternate; one final arrives late and out of order.
    await emitLiveSegments(app, session, [{ text: `bezig met zin ${i}`, start: at, end: at + 1, isFinal: false, speaker: i % 3 === 2 ? 'Others' : 'You' }]);
    await emitLiveSegments(app, session, [{ text: `Wij komen gratis meten bij u thuis, zin ${i}.`, start: at, end: at + 2, isFinal: true, speaker: i % 3 === 2 ? 'Others' : 'You' }]);
    if (i === 12) await emitLiveSegments(app, session, [{ text: 'Een laat vrijgegeven zin uit het midden.', start: 7.5, end: 8.5, isFinal: true, speaker: 'You' }]);
    if (i === 3) { await mainWindow(app, 'hide'); visibility.push(await page.evaluate(() => document.visibilityState)); }
    if (i === 8) { await page.getByRole('button', { name: ui('liveTranscriptBar.minimizeTranscript'), exact: true }).click(); await expect(page.getByTestId('live-transcript-panel')).toHaveCount(0); }
    if (i === 11) { await page.getByRole('button', { name: ui('liveDock.showTranscript'), exact: true }).click(); await expect(page.getByTestId('live-transcript-panel')).toBeVisible(); }
    if (i === 14) await page.evaluate(() => { window.location.hash = '#/'; });
    if (i === 16) { await page.getByRole('button', { name: ui('mainToolbar.openRecording'), exact: true }).click(); await expect(sidebar).toBeVisible(); }
    if (i === 18) await page.setViewportSize({ width: 1000, height: 1000 });
    if (i === 22) await page.setViewportSize({ width: 1440, height: 1000 });
    if (i === 24) await mainWindow(app, 'show');
    await sleep(3000);
    const seconds = Math.round((Date.now() - started) / 1000);
    if (seconds >= 30 && marks[30] === undefined) marks[30] = await modelCalls(app);
    if (seconds >= 60 && marks[60] === undefined) marks[60] = await modelCalls(app);
  }
  marks[90] = await modelCalls(app);
  testInfo.annotations.push({ type: 'checks at 30/60/90 s', description: JSON.stringify(marks) });
  testInfo.annotations.push({ type: 'visibility while hidden', description: visibility.join(',') });
  if (energySaver) {
    expect(marks[30]).toBe(0);
    expect(marks[60]).toBeGreaterThanOrEqual(1);
    expect(marks[90]).toBeGreaterThanOrEqual(marks[60]);
  } else {
    expect(marks[30]).toBeGreaterThanOrEqual(1);
    expect(marks[60]).toBeGreaterThan(marks[30]);
    expect(marks[90]).toBeGreaterThan(marks[60]);
  }
  // The renderer plans nothing: it never calls the manual evaluation or attaches by itself.
  expect(await ipcCalls(app, 'veneta-checklist-evaluate')).toBe(0);
  expect(await ipcCalls(app, 'veneta-checklist-attach-prepared')).toBe(0);
  await expect(status).toHaveText(/^AI (luistert|controleert) mee · lokaal · (laatst \d\d:\d\d|bezig)$/);
  await expect(diagnostics).toHaveText(/^tekstregels 3[01] · controles \d+ · laatste reden (stil|maxwacht)$/);
  const counted = Number((await diagnostics.innerText()).match(/controles (\d+)/)?.[1]);
  expect(counted).toBeGreaterThanOrEqual(marks[90] - 1);
  expect(counted).toBeLessThanOrEqual(marks[90] + 1);
  await expect(sidebar.getByRole('listitem')).toHaveCount(4);
  if (shotsDir) await sidebar.locator('header').screenshot({ path: path.join(shotsDir, 'status-diagnose-1440-light.png'), animations: 'disabled' });
  // ---- Stop: the last check over what was not assessed shows in the note tab, from the same session file ----
  await emitLiveSegments(app, session, [{ text: 'Laatste woorden vlak voor het stoppen.', start: 95, end: 97, isFinal: true, speaker: 'You' }]);
  await page.getByTestId('live-transcript-panel').getByRole('button', { name: ui('mainToolbar.stopRecording'), exact: true }).click();
  const tab = page.getByTestId('tab-checklist');
  await expect(tab).toBeVisible();
  const before = await modelCalls(app);
  await tab.click();
  await expect(page.getByTestId('checklist-final-running')).toBeVisible();
  if (shotsDir) await page.screenshot({ path: path.join(shotsDir, 'notitie-laatste-controle-bezig-1440-light.png'), animations: 'disabled' });
  await expect(page.getByTestId('checklist-final-running')).toHaveCount(0, { timeout: 20_000 });
  expect(await modelCalls(app)).toBeGreaterThanOrEqual(before);
  await expect(tab).toHaveText('Proeflijst 1/4');
  const sessionFiles = readdirSync(path.join(userDataDir, 'veneta-modules', 'checklists'));
  expect(sessionFiles).toHaveLength(1);
  const saved = JSON.parse(readFileSync(path.join(userDataDir, 'veneta-modules', 'checklists', sessionFiles[0]), 'utf8'));
  expect(saved.request.segments.some((segment: { text: string }) => segment.text === 'Laatste woorden vlak voor het stoppen.')).toBe(true);
  expect(existsSync(path.join(userDataDir, 'veneta-modules', 'note-results'))).toBe(true);
});
