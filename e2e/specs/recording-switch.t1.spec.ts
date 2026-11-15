import { test, expect } from '../fixtures/electron';
import type { ElectronApplication } from '@playwright/test';
import { ui, uiPart } from '../fixtures/ui-copy';

const ENV = { STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1', STENOAI_E2E_CALENDAR: '1' };

const calls = (app: ElectronApplication, channel: string) =>
  app.evaluate(
    (_e, ch) => (globalThis as unknown as { __mockIpcCalls: unknown[] }).__mockIpcCalls
      .filter((c) => c === ch).length,
    channel,
  );

test('toolbar: the recording segment opens the note and the red button stops in one click', async ({ launchApp }) => {
  const { app, page } = await launchApp({ mockIpc: true, fakeAudio: true, env: ENV });
  await page.locator('.record-btn').click();
  await expect.poll(() => calls(app, 'start-recording-ui')).toBe(1);
  // New note lands on the live note, which has its own pill; the toolbar
  // controls are what every other page shows while recording.
  await page.evaluate(() => { window.location.hash = '#/'; });
  const controls = page.getByTestId('toolbar-recording');
  await expect(controls).toBeVisible();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({
      path: test.info().outputPath(`toolbar-recording-${colorScheme}.png`),
      clip: { x: 0, y: 0, width: 1200, height: 60 },
      animations: 'disabled',
    });
  }
  await page.emulateMedia({ colorScheme: 'light' });

  // The open segment navigates and never stops.
  await controls.getByRole('button', { name: uiPart('mainToolbar.openRecording') }).click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('/recording');
  expect(await calls(app, 'stop-recording-ui')).toBe(0);

  await page.evaluate(() => { window.location.hash = '#/'; });
  await controls.getByRole('button', { name: uiPart('mainToolbar.stopRecording') }).click();
  await expect.poll(() => calls(app, 'stop-recording-ui')).toBe(1);
  await expect(controls).toHaveCount(0);
});

test('starting a calendar meeting while recording asks to switch, and only switches on confirm', async ({ launchApp }) => {
  const { app, page } = await launchApp({ mockIpc: true, fakeAudio: true, env: ENV });
  await page.locator('.record-btn').click();
  await expect.poll(() => calls(app, 'start-recording-ui')).toBe(1);

  const joinAndTakeNotes = async () => {
    await page.evaluate(() => { window.location.hash = '#/calendar'; });
    await page.getByRole('button', { name: 'Calendar review fixture', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: ui('upcomingCard.join_take_notes'), exact: true }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: uiPart('switchRecording.title') });
    await expect(confirm).toContainText('Calendar review fixture');
    return confirm;
  };

  // Keep recording: nothing stops, nothing starts, the meeting link stays closed.
  await (await joinAndTakeNotes()).getByRole('button', { name: uiPart('switchRecording.cancel') }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await calls(app, 'stop-recording-ui')).toBe(0);
  expect(await calls(app, 'start-recording-ui')).toBe(1);
  expect(await calls(app, 'open-external')).toBe(0);

  // Stop and switch: the running note stops, the meeting starts, then its link opens.
  await (await joinAndTakeNotes()).getByRole('button', { name: uiPart('switchRecording.confirm') }).click();
  await expect.poll(() => calls(app, 'start-recording-ui')).toBe(2);
  expect(await calls(app, 'stop-recording-ui')).toBe(1);
  await expect.poll(() => calls(app, 'open-external')).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('toolbar-recording')).toBeVisible();
});
