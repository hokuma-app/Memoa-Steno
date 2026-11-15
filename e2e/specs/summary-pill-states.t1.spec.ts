import { test, expect } from '../fixtures/electron';
import type { Page } from '@playwright/test';

// 0.10.1: the detail bar (the pill) belongs to every finished note. These states are the ones where it went missing:
// a note that was open while its summary streamed in (the recording pipeline's closing event names the job, not the
// note), and one left and re-opened between the two closing events. Model-free: the mock IPC stands in for the backend.
const ENV = { STENOAI_E2E_SEED_MEETING: '1', STENOAI_E2E_FOLD_RICH: '1', STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1' };
const FILE = 'epsilon_summary.json';
const bar = (page: Page) => page.locator('.summary-fold-dock .zoombar');
const panel = (page: Page) => page.getByTestId('summary-folding-panel');
const openNote = (page: Page) => page.evaluate((file) => { window.location.hash = `#/meetings/${file}`; }, FILE);
type App = { evaluate: <T, A>(fn: (modules: { BrowserWindow: { getAllWindows(): { webContents: { send(c: string, p: unknown): void } }[] } }, arg: A) => T, arg: A) => Promise<T> };
const emit = (app: App, channel: string, payload: unknown) =>
  app.evaluate(({ BrowserWindow }, [c, p]) => { BrowserWindow.getAllWindows()[0].webContents.send(c as string, p); }, [channel, payload] as [string, unknown]);

async function streamedSummary(app: App) {
  await emit(app, 'summary-chunk', { chunk: 'Het team besluit vrijdag te leveren.', sessionName: 'Note', summaryFile: FILE });
  await emit(app, 'summary-complete', { success: true, sessionName: 'Note', summaryFile: FILE });
}

test('a note open while its summary streams in shows the bar when the recording pipeline closes under the job name', async ({ launchApp }) => {
  const { app, page } = await launchApp({ mockIpc: true, releaseHighlightsSeen: true, env: ENV });
  await openNote(page);
  await expect(bar(page)).toBeVisible();
  await streamedSummary(app as unknown as App);
  // The pipeline's processing-complete carries the job's session name and no summaryFile; the note has its own title.
  await emit(app as unknown as App, 'processing-complete', { success: true, sessionName: 'Note', notesGenerated: true });
  await expect(page.getByTestId('report-content').or(panel(page))).toBeVisible();
  await expect(bar(page)).toBeVisible({ timeout: 4000 });
});

test('the bar is back after leaving a note between summary-complete and processing-complete', async ({ launchApp }) => {
  const { app, page } = await launchApp({ mockIpc: true, releaseHighlightsSeen: true, env: ENV });
  await openNote(page);
  await expect(bar(page)).toBeVisible();
  await streamedSummary(app as unknown as App);
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForTimeout(500);
  await emit(app as unknown as App, 'processing-complete', { success: true, sessionName: 'Note', summaryFile: FILE, notesGenerated: true });
  await openNote(page);
  await expect(bar(page)).toBeVisible({ timeout: 4000 });
});

test('the bar shows once the summary stream is done even when no closing event ever names this note', async ({ launchApp }) => {
  const { app, page } = await launchApp({ mockIpc: true, releaseHighlightsSeen: true, env: ENV });
  await openNote(page);
  await expect(bar(page)).toBeVisible();
  await streamedSummary(app as unknown as App);
  await expect(bar(page)).toBeVisible({ timeout: 4000 });
});

test('a custom report keeps the bar, and a model that is not available (Ollama off, fold model not installed) never takes it away', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true, releaseHighlightsSeen: true, env: { ...ENV, STENOAI_E2E_SEED_REPORT: '1', STENOAI_E2E_FOLD_FAIL_REASON: 'provider_unavailable' } });
  await openNote(page);
  await expect(bar(page)).toBeVisible();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByTestId('note-view-menu-trigger').click();
  await page.getByTestId('note-view-menu').getByRole('button', { name: /^Status Report/ }).click();
  await expect(page.getByTestId('meeting-detail')).toContainText('Pipeline');
  await expect(panel(page)).toHaveAttribute('data-provenance', 'local');
  await expect(bar(page)).toBeVisible();
});
