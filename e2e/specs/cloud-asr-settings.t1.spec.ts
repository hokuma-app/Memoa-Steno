import { test, expect } from '../fixtures/electron';
import { uiPart, uiText } from '../fixtures/ui-copy';

async function openAiSettings(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=ai';
  });
  await expect(page.getByTestId('transcription-model-select')).toBeVisible();
}

async function chooseCloudApi(page: import('@playwright/test').Page) {
  await page.getByTestId('transcription-model-select').click();
  await page.getByRole('option', { name: uiPart('settings.ai.cloudAsr.providerLabel') }).click();
}

test('cloud ASR requires confirmation and honours cancellation', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true });
  await openAiSettings(page);

  await chooseCloudApi(page);
  const dialog = page.locator('[data-confirm-dialog]');
  await expect(dialog).toContainText(uiPart('settings.ai.cloudAsr.confirmTitle'));
  await expect(dialog).toContainText(uiText('settings.ai.cloudAsr.confirmDescription'));
  await dialog.getByRole('button', { name: uiPart('models.cancel') }).click();

  await expect(page.getByTestId('openai-asr-config')).toHaveCount(0);

  await chooseCloudApi(page);
  await dialog.getByRole('button', { name: uiPart('settings.ai.cloudAsr.confirmAction') }).click();
  await expect(page.getByTestId('openai-asr-config')).toBeVisible();
});

test('cloud ASR save failures stay visible and restore the committed endpoint', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_OAI_ASR_SAVE_FAIL: '1' },
  });
  await openAiSettings(page);
  await chooseCloudApi(page);
  await page.locator('[data-confirm-dialog]').getByRole('button', { name: uiPart('settings.ai.cloudAsr.confirmAction') }).click();

  const config = page.getByTestId('openai-asr-config');
  const endpoint = config.getByLabel(uiPart('settings.ai.cloudAsr.apiBaseUrlLabel'));
  await endpoint.fill('https://rejected.example/v1');
  await endpoint.blur();

  await expect(config.getByRole('alert')).toContainText(uiText('settings.ai.cloudAsr.saveSettingError'));
  await expect(endpoint).toHaveValue('https://api.openai.com/v1');
});

test('clearing a saved key wins over the replacement queued by input blur', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: {
      STENOAI_E2E_OAI_ASR_KEY_SET: '1',
      STENOAI_E2E_OAI_ASR_KEY_RACE: '1',
    },
  });
  await openAiSettings(page);
  await chooseCloudApi(page);
  await page.locator('[data-confirm-dialog]').getByRole('button', { name: uiPart('settings.ai.cloudAsr.confirmAction') }).click();

  const config = page.getByTestId('openai-asr-config');
  await config.getByLabel(uiPart('settings.ai.cloudAsr.apiKeyLabel')).fill('replacement-key');
  await config.getByRole('button', { name: uiPart('settings.ai.cloudAsr.clearAction') }).click();

  await expect(config).toContainText(uiText('settings.ai.cloudAsr.keyEmptyDescription'));
  await expect(config.getByRole('button', { name: uiPart('settings.ai.cloudAsr.clearAction') })).toHaveCount(0);
});
