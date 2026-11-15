import { test, expect } from '../fixtures/electron';

// Real packaged host and fresh isolated profile, with no model download or microphone request.
test('first-run onboarding names the packaged product throughout', async ({ launchApp }) => {
  const { page } = await launchApp();
  await page.evaluate(() => { window.location.hash = '#/setup'; });
  const name = (await page.title()) === 'Veneta MemoAi' ? 'Veneta MemoAi' : 'Steno';
  await expect(page.getByRole('heading', { name: `Welcome to ${name}` })).toBeVisible();
  await expect(page.getByText(`How should ${name} summarize meetings?`)).toBeVisible();
  await expect(page.getByText(`Start ${name} automatically when you log in`, { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Begin setup' })).toBeVisible();
});
