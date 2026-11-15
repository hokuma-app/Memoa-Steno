import { test, expect } from '../fixtures/electron';
import { ui, uiText } from '../fixtures/ui-copy';

// Real packaged host and fresh isolated profile, with no model download or microphone request.
test('first-run onboarding names the packaged product throughout', async ({ launchApp }) => {
  const { page } = await launchApp();
  await page.evaluate(() => { window.location.hash = '#/setup'; });
  const name = (await page.title()) === 'Veneta MemoAi' ? 'Veneta MemoAi' : 'Steno';
  await expect(page.getByRole('heading', { name: uiText('setup.welcome', { product: name }) })).toBeVisible();
  await expect(page.getByText(uiText('setup.summarizeWith', { product: name }))).toBeVisible();
  await expect(page.getByText(uiText('setup.launchOnLoginDescription', { product: name }), { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: ui('setup.beginSetup') })).toBeVisible();
});
