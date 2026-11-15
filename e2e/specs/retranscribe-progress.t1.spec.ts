import { test, expect } from '../fixtures/electron';
import { ui } from '../fixtures/ui-copy';

test('re-transcription progress counts completed parts and ignores other notes', async ({ launchApp }) => {
  const file = 'stale_summary.md';
  const { app, page } = await launchApp({ mockIpc: true, env: {
    STENOAI_E2E_SEED_STALE_NOTE: '1', STENOAI_E2E_REPROCESS_PENDING: '1',
  } });
  await page.evaluate(() => { window.location.hash = '#/meetings/stale_summary.md'; });
  await page.getByTestId('generate-notes-dock-button').click();
  await expect.poll(() => app.evaluate(() => (globalThis as any).__reprocessTest.calls)).toBe(1);
  const progress = async (summaryFile: string, line: string) => {
    await app.evaluate(({ BrowserWindow }, data) => {
      BrowserWindow.getAllWindows()[0].webContents.send('processing-progress', data);
    }, { summaryFile, line });
  };
  await progress(file, 'PROGRESS:audio:preparing');
  await expect(page.getByText(ui('meeting.preparingAudio'), { exact: true })).toBeVisible();
  await progress(file, 'PROGRESS:transcribe:2/30');
  await expect(page.getByText(ui('meeting.transcriptionProgress', { done: '2', total: '30' }), { exact: true })).toBeVisible();
  await progress('other_summary.md', 'PROGRESS:transcribe:9/10');
  await expect(page.getByText(ui('meeting.transcriptionProgress', { done: '2', total: '30' }), { exact: true })).toBeVisible();
  await progress(file, 'PROGRESS:transcribe:24/30');
  await expect(page.getByText(ui('meeting.transcriptionProgress', { done: '24', total: '30' }), { exact: true })).toBeVisible();
  await progress(file, 'PROGRESS:diarize:You:start');
  await expect(page.getByText(ui('meeting.identifyingMicSpeakers'), { exact: true })).toBeVisible();
  await progress(file, 'PROGRESS:diarize:Others:start');
  await expect(page.getByText(ui('meeting.identifyingCallSpeakers'), { exact: true })).toBeVisible();
  await progress(file, 'PROGRESS:summarize:start');
  await expect(page.getByText(ui('meeting.generatingNotes'), { exact: true })).toBeVisible();
  await app.evaluate(() => (globalThis as any).__reprocessTest.finish({ success: false, error_code: 'generation_failed' }));
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('Covers only the first segment.', { exact: true })).toBeVisible();
});

for (const surface of ['reprocess', 'recording'] as const) {
test(`opening an active ${surface} note restores the last backend stage without waiting for an event`, async ({ launchApp }, testInfo) => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const queueFile = testInfo.outputPath('queue.json');
  fs.mkdirSync(path.dirname(queueFile), { recursive: true });
  const writeStage = (progressLine: string) => fs.writeFileSync(queueFile, JSON.stringify({
    ...(surface === 'reprocess'
      ? { currentReprocesses: [{ summaryFile: 'stale_summary.md', sessionName: 'Stale summary', progressLine }] }
      : { currentProgress: { summaryFile: 'stale_summary.md', progressLine } }),
  }));
  writeStage('PROGRESS:diarize:Others:start');
  const { page } = await launchApp({ mockIpc: true, env: {
    STENOAI_E2E_SEED_STALE_NOTE: '1', STENOAI_E2E_QUEUE_STATE_PATH: queueFile,
  } });
  await page.evaluate(() => { window.location.hash = '#/meetings/stale_summary.md'; });
  await expect(page.getByText(ui('meeting.identifyingCallSpeakers'), { exact: true })).toBeVisible();
  await page.getByRole('button', { name: ui('sidebar.home'), exact: true }).click();
  writeStage('PROGRESS:transcribe:18/30');
  await page.evaluate(() => { window.location.hash = '#/meetings/stale_summary.md'; });
  await expect(page.getByText(ui('meeting.transcriptionProgress', { done: '18', total: '30' }), { exact: true })).toBeVisible();
});
}
