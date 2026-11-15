import { existsSync, mkdirSync, readFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/electron';
import en from '../../app/renderer/src/i18n/locales/en.json';
import nl from '../../app/renderer/src/i18n/locales/veneta-nl.json';

/**
 * T1 for Settings > AI > "Model per functie" (0.10.0). Mock IPC: the real IPC module and the real
 * renderer run against a stub state file in the temporary user-data dir (e2e-model-choice-mock.js).
 * No Ollama, no registry, no model: stub tags only, and every download/delete/trial is a stub.
 * Screenshots go to MODEL_SHOTS_DIR when set (local review).
 */
const launchOptions = {
  mockIpc: true, releaseHighlightsSeen: true,
  env: { STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1', STENOAI_E2E_PRODUCT_PROFILE: 'veneta' },
};
const shotsDir = process.env.MODEL_SHOTS_DIR;
const stateOf = (dir: string) => JSON.parse(readFileSync(path.join(dir, 'model-choice-e2e.json'), 'utf8'));

type Copy = Record<string, string>;
async function copyFor(page: Page): Promise<(key: string, params?: Record<string, string>) => string> {
  // The runtime product profile selects layout, not the build's language.
  // The branded package has Veneta copy; the generic build keeps English.
  const veneta = (await page.title()) === 'Veneta MemoAi';
  const catalogue: Copy = veneta ? { ...(en as Copy), ...(nl as Copy) } : (en as Copy);
  return (key, params = {}) => catalogue[key].replace(/\{\{(\w+)\}\}/g, (_m, name: string) => params[name] ?? '');
}

async function openAi(page: Page) {
  await expect(page.locator('[data-app-ready]')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => { window.location.hash = '#/settings?tab=ai'; });
  const section = page.getByTestId('model-choice-settings');
  await expect(section).toBeVisible();
  await expect(page.getByTestId('model-function-summary')).toBeVisible();
  return section;
}
const row = (page: Page, fn: string) => page.getByTestId(`model-function-${fn}`);
const openPicker = async (page: Page, fn: string) => {
  await page.getByTestId(`model-change-${fn}`).click();
  return page.getByTestId(`model-picker-${fn}`);
};
async function shot(page: Page, name: string) {
  if (!shotsDir) return;
  mkdirSync(shotsDir, { recursive: true });
  await page.getByTestId('model-choice-settings').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(shotsDir, name) });
}

test('each function keeps its own model after a restart; the other functions are untouched', async ({ launchApp, userDataDir }) => {
  test.setTimeout(90_000);
  let { app, page } = await launchApp(launchOptions);
  const c = await copyFor(page);
  await openAi(page);
  await expect(page.getByTestId('model-current-checklist')).toHaveText(c('models.sameAsSummaryNow', { model: 'Gemma 4 E2B' }));
  const picker = await openPicker(page, 'checklist');
  await picker.getByRole('radio', { name: /stub-extra:1b/ }).click();
  await expect(page.getByTestId('model-current-checklist')).toHaveText('stub-extra:1b');
  await expect.poll(() => stateOf(userDataDir).choices).toEqual({ summary: 'gemma4:e2b-it-qat', summary_fold: '', checklist: 'stub-extra:1b' });
  await app.close();
  ({ app, page } = await launchApp(launchOptions));
  await openAi(page);
  await expect(page.getByTestId('model-current-checklist')).toHaveText('stub-extra:1b');
  await expect(page.getByTestId('model-current-summary')).toHaveText('Gemma 4 E2B');
  await expect(page.getByTestId('model-current-summary_fold')).toContainText('Gemma 4 E2B');
  await openPicker(page, 'checklist');
  await page.getByLabel(c('models.sameAsSummary')).click();
  await expect.poll(() => stateOf(userDataDir).choices.checklist).toBe('');
});

test('the list shows the stub tags first and then the recommended and candidate models with their badges', async ({ launchApp }) => {
  const { page } = await launchApp(launchOptions);
  const c = await copyFor(page);
  await openAi(page);
  const picker = await openPicker(page, 'summary_fold');
  await expect(picker.getByTestId('installed-gemma4:e2b-it-qat')).toContainText('gguf');
  await expect(picker.getByTestId('installed-stub-extra:1b')).toContainText('safetensors');
  await expect(picker.getByTestId('installed-stub-extra:1b')).toContainText('nvfp4');
  const order = await picker.evaluate((node, labels) => {
    const text = node.textContent ?? '';
    return [text.indexOf(labels[0]), text.indexOf(labels[1])];
  }, [c('models.onThisMac'), c('models.recommended')]);
  expect(order[0]).toBeGreaterThanOrEqual(0);
  expect(order[0]).toBeLessThan(order[1]);
  const nano = picker.getByTestId('catalog-nemotron-3-nano-4b');
  await expect(nano).toContainText(c('models.badgeSmall'));
  await expect(nano).toContainText(c('models.badgeCandidate'));
  await expect(picker.getByTestId('catalog-nemotron-3-5-bolt-e4b')).toContainText(c('models.badgeSmall'));
  const lightning = picker.getByTestId('catalog-nemotron-3-5-lightning-30b-a3b');
  await expect(lightning).toContainText(c('models.badgeCandidate'));
  await expect(lightning).toContainText(c('models.downloadNotDirect'));
  await expect(lightning.getByRole('button', { name: c('models.download') })).toHaveCount(0);
  await expect(picker.getByTestId('catalog-gemma4-e4b')).toContainText(c('models.badgeRecommended'));
  await shot(page, 'ai-model-per-function-picker.png');
});

test('adding a model validates the name, refuses cloud tags and downloads only after the click', async ({ launchApp, userDataDir }) => {
  test.setTimeout(90_000);
  const { page } = await launchApp({ ...launchOptions, env: { ...launchOptions.env, STENOAI_E2E_PULL_MS: '250' } });
  const c = await copyFor(page);
  await openAi(page);
  const add = page.getByTestId('model-add');
  const input = add.getByLabel(c('models.add.label'));
  const status = page.getByTestId('model-add-status');
  await input.fill('gemma4:31b-cloud');
  await add.getByRole('button', { name: c('models.add.check') }).click();
  await expect(status).toContainText(c('models.reason.cloud'));
  await input.fill('a b');
  await add.getByRole('button', { name: c('models.add.check') }).click();
  await expect(status).toContainText(c('models.reason.invalid'));
  await input.fill('hf.co/org/mini-model:Q4_K_M');
  await add.getByRole('button', { name: c('models.add.check') }).click();
  await expect(status).toContainText('hf.co/org/mini-model:Q4_K_M');
  await expect(status).toContainText(/1[.,]9 GB/);
  expect(stateOf(userDataDir).pulls).toEqual([]);
  await shot(page, 'ai-model-per-function-add.png');
  const start = add.getByRole('button', { name: c('models.add.start', { model: 'hf.co/org/mini-model:Q4_K_M' }) });
  await start.click();
  await expect(add.getByRole('progressbar')).toBeVisible();
  const picker = await openPicker(page, 'checklist');
  await expect(picker.getByTestId('installed-hf.co/org/mini-model:Q4_K_M')).toBeVisible({ timeout: 15_000 });
  expect(stateOf(userDataDir).pulls).toEqual(['hf.co/org/mini-model:Q4_K_M']);
  // Adding a model does not choose it for any function.
  expect(stateOf(userDataDir).choices).toEqual({ summary: 'gemma4:e2b-it-qat', summary_fold: '', checklist: '' });
  await input.fill('unknown-size:1');
  await add.getByRole('button', { name: c('models.add.check') }).click();
  await expect(status).toContainText(c('models.sizeUnknown'));
});

test('a download can be cancelled and leaves nothing behind', async ({ launchApp, userDataDir }) => {
  const { page } = await launchApp({ ...launchOptions, env: { ...launchOptions.env, STENOAI_E2E_PULL_MS: '600' } });
  const c = await copyFor(page);
  await openAi(page);
  const picker = await openPicker(page, 'summary_fold');
  await picker.getByTestId('catalog-nemotron-3-nano-4b').getByRole('button', { name: c('models.download') }).click();
  await picker.getByRole('button', { name: c('models.cancel') }).click();
  await expect(picker.getByText(c('models.downloadCancelled'))).toBeVisible();
  expect(stateOf(userDataDir).installed.map((m: { name: string }) => m.name)).not.toContain('nemotron-3-nano:4b');
  expect(stateOf(userDataDir).choices.summary_fold).toBe('');
});

test('deleting is refused while a function uses the model, and works with a confirmation otherwise', async ({ launchApp, userDataDir }) => {
  const { page } = await launchApp(launchOptions);
  const c = await copyFor(page);
  await openAi(page);
  const picker = await openPicker(page, 'checklist');
  await expect(picker.getByRole('button', { name: c('models.delete', { model: 'gemma4:e2b-it-qat' }) })).toBeDisabled();
  // The host refuses too, whatever the interface does.
  const refused = await page.evaluate(() => window.stenoai.models.delete('gemma4:e2b-it-qat'));
  expect(refused).toMatchObject({ success: false, reason: 'in_use' });
  expect(stateOf(userDataDir).installed.map((m: { name: string }) => m.name)).toContain('gemma4:e2b-it-qat');
  await picker.getByRole('button', { name: c('models.delete', { model: 'stub-extra:1b' }) }).click();
  await page.getByRole('button', { name: c('models.deleteConfirm'), exact: true }).click();
  await expect(picker.getByTestId('installed-stub-extra:1b')).toHaveCount(0);
  expect(stateOf(userDataDir).deleted).toEqual(['stub-extra:1b']);
});

test('the trial button runs only on click, per function, and shows validity, time and a reason', async ({ launchApp, userDataDir }) => {
  const { page } = await launchApp(launchOptions);
  const c = await copyFor(page);
  await openAi(page);
  expect(stateOf(userDataDir).tests).toEqual([]);
  await page.getByTestId('model-test-checklist').click();
  await expect(page.getByTestId('model-test-result-checklist')).toContainText(c('models.yes'));
  await expect(page.getByTestId('model-test-result-checklist')).toContainText(/1[.,]2 s/);
  expect(stateOf(userDataDir).tests).toEqual(['checklist']);
  await expect(page.getByTestId('model-test-result-summary')).toHaveText('');
  await shot(page, 'ai-model-per-function-overview.png');
});

test('a failing trial names the content-free reason', async ({ launchApp }) => {
  const { page } = await launchApp({ ...launchOptions, env: { ...launchOptions.env, STENOAI_E2E_MODEL_TEST_FAIL: 'truncated' } });
  const c = await copyFor(page);
  await openAi(page);
  await page.getByTestId('model-test-summary_fold').click();
  const result = page.getByTestId('model-test-result-summary_fold');
  await expect(result).toContainText(c('models.no'));
  await expect(result).toContainText(c('models.testReason.truncated'));
});

test('the host refuses a cloud model and an unknown function even when the renderer asks', async ({ launchApp, userDataDir }) => {
  const { page } = await launchApp(launchOptions);
  await openAi(page);
  const cloud = await page.evaluate(() => window.stenoai.modelChoice.set('checklist', 'gemma4:31b-cloud'));
  expect(cloud).toMatchObject({ success: false, reason: 'cloud' });
  // @ts-expect-error deliberately outside the type: the host must still refuse it
  const unknown = await page.evaluate(() => window.stenoai.modelChoice.set('transcribe', 'a:1'));
  expect(unknown).toMatchObject({ success: false, reason: 'invalid_function' });
  expect(stateOf(userDataDir).choices.checklist).toBe('');
  expect(existsSync(path.join(userDataDir, 'model-choice-e2e.json'))).toBe(true);
  void copyFileSync;
});
