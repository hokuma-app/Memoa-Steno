import { test, expect } from '../fixtures/electron';
import { ui } from '../fixtures/ui-copy';

test('calendar card clicks and Join never record; Join & take notes is explicit', async ({ launchApp }) => {
  const { app, page } = await launchApp({ mockIpc: true, fakeAudio: true, env: { STENOAI_E2E_CALENDAR: '1' } });
  const starts = () => app.evaluate(() => (globalThis as unknown as { __mockIpcCalls: string[] }).__mockIpcCalls.filter(c => c === 'start-recording-ui').length);
  await page.evaluate(() => { window.location.hash = '#/calendar'; });
  const row = page.getByRole('button', { name: 'Calendar review fixture', exact: true });
  await row.click();
  await expect(page.getByRole('dialog')).toContainText('Invitation details');
  expect(await starts()).toBe(0);
  await page.getByRole('dialog').getByRole('button', { name: ui('upcomingCard.join'), exact: true }).click();
  expect(await starts()).toBe(0);
  await page.getByRole('dialog').getByRole('button', { name: ui('models.close'), exact: true }).click();
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await starts()).toBe(0);
  await page.screenshot({ path: test.info().outputPath('calendar-details.png'), animations: 'disabled' });
  await page.getByRole('dialog').getByRole('button', { name: ui('upcomingCard.join_take_notes'), exact: true }).click();
  await expect.poll(starts).toBe(1);
});
