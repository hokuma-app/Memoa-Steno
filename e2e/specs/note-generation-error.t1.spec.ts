import { test, expect } from '../fixtures/electron';
import { ui, uiPart, uiText } from '../fixtures/ui-copy';

const summaryFile = 'pending_summary.md';

for (const scenario of [
  { name: 'connection', code: 'generation_connection_failed', message: uiText('noteGenerationError.couldNotReachTheAi') },
  { name: 'missing model', code: 'generation_model_unavailable', message: uiText('noteGenerationError.theSelectedAiModelIs') },
  { name: 'unknown diagnostics', code: 'unexpected-server-code', message: uiText('noteGenerationError.notesCouldNotBeGenerated') },
  { name: 'stream then generic exit', code: 'generation_connection_failed', message: uiText('noteGenerationError.couldNotReachTheAi'), stream: true },
]) {
  test(`${scenario.name}: stable detail, safe cause and working retry`, async ({ launchApp }) => {
    const { app, page } = await launchApp({
      mockIpc: true,
      env: { STENOAI_E2E_SEED_PENDING_NOTE: '1', STENOAI_E2E_REPROCESS_PENDING: '1' },
    });

    await page.evaluate((file) => { window.location.hash = `#/meetings/${encodeURIComponent(file)}`; }, summaryFile);
    await page.getByTestId('generate-notes-dock-button').click();
    await expect.poll(() => app.evaluate(() => (globalThis as any).__reprocessTest.calls)).toBe(1);
    await app.evaluate(({ BrowserWindow }, { code, stream, file }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      if (stream) {
        contents.send('summary-chunk', { summaryFile: file, sessionName: 'New note', chunk: 'Unfinished synthetic summary' });
        contents.send('summary-complete', { success: false, summaryFile: file, sessionName: 'New note', error_code: code });
        contents.send('processing-complete', { success: false, summaryFile: file, sessionName: 'New note' });
      }
      (globalThis as any).__reprocessTest.finish({ success: false, error: 'Synthetic private detail https://internal.invalid/token=secret', error_code: stream ? undefined : code });
    }, { code: scenario.code, stream: Boolean(scenario.stream), file: summaryFile });
    const alert = page.getByRole('alert');
    await expect(alert).toContainText(scenario.message);
    await expect(page.getByRole('button', { name: uiPart('askBar.copyTranscript') })).toBeVisible();
    await expect(alert.getByRole('button', { name: ui('meetingDetail.generateNotes'), exact: true })).toBeEnabled();
    await expect(page.getByText('Unfinished synthetic summary', { exact: true })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('internal.invalid');
    await expect(page.locator('body')).not.toContainText('unexpected-server-code');
    // Disk preservation is verified by note-generation-error.t2; this mock returns static data.

    await alert.getByRole('button', { name: ui('meetingDetail.generateNotes'), exact: true }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as any).__reprocessTest.calls)).toBe(2);
    await app.evaluate(({ BrowserWindow }, file) => {
      BrowserWindow.getAllWindows()[0].webContents.send('processing-complete', { success: true, summaryFile: file, sessionName: 'New note', notesGenerated: false });
      (globalThis as any).__reprocessTest.finish({ success: true });
    }, summaryFile);
    await expect(alert).toHaveCount(0);
    await expect(page.getByTestId('generate-notes-dock-button')).toBeEnabled();
    await expect(page.getByRole('button', { name: uiPart('askBar.copyTranscript') })).toBeVisible();
  });
}

test('completion failures from another note do not affect the open detail', async ({ launchApp }) => {
  const { app, page } = await launchApp({ mockIpc: true, env: { STENOAI_E2E_SEED_PENDING_NOTE: '1' } });
  await page.evaluate((file) => { window.location.hash = `#/meetings/${encodeURIComponent(file)}`; }, summaryFile);
  await expect(page.getByTestId('generate-notes-dock-button')).toBeEnabled();
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    for (const channel of ['summary-complete', 'processing-complete']) {
      contents.send(channel, { success: false, sessionName: 'New note', summaryFile: 'other_summary.md', error_code: 'generation_model_unavailable' });
    }
  });
  await expect(page.getByTestId('generate-notes-dock-button')).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('failed regeneration keeps the existing summary visible and My notes usable', async ({ launchApp }) => {
  const { app, page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_STALE_NOTE: '1', STENOAI_E2E_REPROCESS_PENDING: '1' },
  });
  await page.evaluate(() => { window.location.hash = '#/meetings/stale_summary.md'; });
  await expect(page.getByText('Covers only the first segment.', { exact: true })).toBeVisible();
  // The mock folding pass must preserve this note's own source, not replace it
  // with the generic seed after the background levels arrive.
  await expect(page.getByTestId('summary-folding-panel')).toHaveAttribute('data-provenance', 'ai');
  await expect(page.getByText('Covers only the first segment.', { exact: true })).toBeVisible();
  await page.getByTestId('generate-notes-dock-button').click();
  await expect.poll(() => app.evaluate(() => (globalThis as any).__reprocessTest.calls)).toBe(1);
  await app.evaluate(() => (globalThis as any).__reprocessTest.finish({ success: false, error: 'Synthetic failure', error_code: 'generation_model_unavailable' }));
  await expect(page.getByRole('alert')).toContainText(uiText('noteGenerationError.theSelectedAiModelIs'));
  await expect(page.getByText('Covers only the first segment.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: ui('recording.notesHeading'), exact: true }).click();
  await expect(page.getByRole('tab', { name: ui('recording.notesHeading'), exact: true })).toHaveAttribute('aria-selected', 'true');
});
