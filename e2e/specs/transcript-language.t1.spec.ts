import { test, expect } from '../fixtures/electron';
import { uiPart, uiText } from '../fixtures/ui-copy';

for (const scenario of [
  { detected: 'fr', setting: 'auto', label: uiText('transcript.detectedLanguage'), value: uiText('settingsLanguages.french') },
  { detected: 'unknown', setting: 'auto', label: uiText('transcript.detectedLanguage'), value: uiText('transcript.languageUnknown') },
  { detected: 'nl', setting: 'nl', label: uiText('transcript.reportedLanguage'), value: uiText('settingsLanguages.dutch') },
]) {
  test(`transcript language: ${scenario.setting}/${scenario.detected}`, async ({ launchApp }, testInfo) => {
    const { page } = await launchApp({ mockIpc: true, env: {
      STENOAI_E2E_SEED_MEETING: '1',
      STENOAI_E2E_TRANSCRIPT_LANGUAGE: scenario.detected,
      STENOAI_E2E_LANGUAGE_SETTING: scenario.setting,
    } });
    await page.evaluate(() => { window.location.hash = '#/meetings/epsilon_summary.json'; });
    await page.getByTestId('transcript-toggle').click();
    const info = page.getByTestId('transcript-language-info');
    await expect(info.locator('summary')).toHaveText(`${scenario.label}: ${scenario.value}`);
    await expect(page.getByPlaceholder(uiPart('liveTranscriptBar.searchTranscript'))).toBeVisible();
    if (scenario.detected === 'fr') {
      await page.screenshot({ path: testInfo.outputPath('language-collapsed.png') });
    }
    await info.locator('summary').click();
    await expect(info).toContainText(`${uiText('transcript.notesLanguage')}${uiText('settingsLanguages.dutch')}`);
    await expect(info).toContainText(uiPart('transcript.languageSetting'));
    await expect(info).toContainText(uiPart('meetingDetail.reTranscribeRecording'));
    if (scenario.detected === 'fr') {
      await page.screenshot({ path: testInfo.outputPath('language-expanded.png') });
    }
    if (scenario.detected === 'unknown') {
      await expect(info).toContainText(uiText('transcript.unknownLanguageHint'));
    }
    if (scenario.setting !== 'auto') {
      await expect(info).toContainText(uiText('transcript.selectedLanguageHint'));
    }
  });
}

test('older transcripts show unknown language without borrowing the notes language', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true, env: { STENOAI_E2E_SEED_MEETING: '1' } });
  await page.evaluate(() => { window.location.hash = '#/meetings/epsilon_summary.json'; });
  await page.getByTestId('transcript-toggle').click();
  await expect(page.getByTestId('transcript-language-info').locator('summary'))
    .toHaveText(`${uiText('transcript.detectedLanguage')}: ${uiText('transcript.languageUnknown')}`);
});
