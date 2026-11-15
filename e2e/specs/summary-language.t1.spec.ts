import { test, expect } from '../fixtures/electron';
import { ui } from '../fixtures/ui-copy';

/**
 * T1, mock IPC. Settings > AI shows the summary language in both builds (0.11.0). A user who never chose one
 * sees "same as the meeting" (auto), so the default build keeps writing in the meeting's language until the
 * user picks one. Runs against the Default (English) and the Veneta (Dutch) renderer build.
 */
test('the summary language is offered in this build and starts at "same as the meeting"', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true, releaseHighlightsSeen: true });
  await expect(page.locator('[data-app-ready]')).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#/settings?tab=ai'; });
  const trigger = page.getByTestId('summary-language-select');
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveText(ui('settingsSummaryLanguage.auto'));
  await expect(page.getByText(ui('settingsSummaryLanguage.label'), { exact: true })).toBeVisible();
});
