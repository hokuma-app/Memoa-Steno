import { test, expect } from '../fixtures/electron';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

test('watched-folder failure artifacts remain retryable, not completed (model-free)', async ({ launchApp, userDataDir }) => {
  const phone = path.join(path.dirname(userDataDir), `${path.basename(userDataDir)}-failed-phone`);
  mkdirSync(phone, { recursive: true });
  const source = path.join(phone, 'failed.wav');
  writeFileSync(source, 'preserved source');
  const { page } = await launchApp({ releaseHighlightsSeen: true });
  await page.evaluate(async (folder) => {
    const api = (window as any).stenoai.watchedFolders;
    const result = await api.add(folder);
    if (!result.success) throw new Error(result.error);
  }, phone);
  // Seed the backend's honest-failure artifacts, not an ASR/model invocation.
  // No active job exists, just as after a failed process or restart.
  const statePath = path.join(userDataDir, 'watched-folders.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const [sourceKey] = Object.keys(state.files);
  expect(sourceKey).toBeTruthy();
  const audio = path.join(userDataDir, 'failed-copy.wav');
  const summary = path.join(userDataDir, 'failed-copy_summary.md');
  writeFileSync(audio, 'preserved copy');
  writeFileSync(summary, '---\ntranscription_failed: true\nreprocessable: true\n---\n## Summary\nTranscription failed.');
  state.files[sourceKey] = { ...state.files[sourceKey], status: 'queued', audioFile: audio, summaryFile: summary };
  writeFileSync(statePath, JSON.stringify(state));
  const listing = await page.evaluate(() => (window as any).stenoai.watchedFolders.list());
  expect(listing.success).toBe(true);
  expect(listing.files).toHaveLength(1);
  expect(listing.files[0].status).toBe('failed');
  expect(listing.files[0].summaryFile).toBeUndefined();
  expect(readFileSync(source, 'utf8')).toBe('preserved source');
  expect(readFileSync(audio, 'utf8')).toBe('preserved copy');
});
