import { test, expect } from '../fixtures/electron';

for (const templateId of ['standard', 'exec-summary']) {
  test(`existing transcript regeneration sends per-run length and ${templateId} without changing defaults`, async ({ launchApp }) => {
    const { app, page } = await launchApp({ mockIpc: true, releaseHighlightsSeen: true,
      env: { STENOAI_E2E_SEED_MEETING: '1', STENOAI_E2E_REPROCESS_PENDING: '1' } });
    await expect(page.locator('[data-app-ready]')).toBeVisible();
    await page.evaluate(() => { window.location.hash = '#/meetings/epsilon_summary.json'; });
    const original = 'The team agreed to ship on Friday; Bob owns the release notes.';
    await expect(page.getByText(original, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Opnieuw samenvatten', exact: true }).click();
    await page.getByRole('combobox', { name: 'Lengte voor deze versie', exact: true }).selectOption('brief');
    await page.getByRole('combobox', { name: 'Samenvattingssjabloon', exact: true }).selectOption(templateId);
    await expect(page.getByText(original, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Maak nieuwe versie', exact: true }).click();
    const stateKey = templateId === 'standard' ? '__reprocessTest' : '__reportRegenerationTest';
    await expect.poll(() => app.evaluate((_electron, key) => (globalThis as unknown as Record<string, { calls: number }>)[key]?.calls, stateKey)).toBe(1);
    const args = await app.evaluate((_electron, key) => (globalThis as unknown as Record<string, { args: unknown[] }>)[key].args, stateKey);
    if (templateId === 'standard') expect(args).toEqual(['epsilon_summary.json', false, 'Epsilon Planning', false, 'brief']);
    else expect(args).toEqual(['epsilon_summary.json', 'exec-summary', 'brief']);
    const calls = await app.evaluate(() => (globalThis as unknown as { __mockIpcCalls: unknown[] }).__mockIpcCalls);
    expect(calls.filter(call => call === 'set-summary-detail')).toHaveLength(0);
    expect(calls.filter(call => call === 'start-recording-ui')).toHaveLength(0);
    await app.evaluate(({ BrowserWindow }, { key, report }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('summary-complete', { success: false, summaryFile: 'epsilon_summary.json', sessionName: 'Epsilon Planning', report });
      (globalThis as unknown as Record<string, { finish: (value: unknown) => void }>)[key].finish({ success: false, error: 'Synthetic interrupted generation' });
    }, { key: stateKey, report: templateId !== 'standard' });
    await expect(page.getByText(original, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.stenoai.summaryFolding.getSettings())).toEqual({ success: true, summary_detail: 'detailed' });
  });
}

test('a selected generated report keeps its own detail cache and reasoning stays hidden', async ({ launchApp }) => {
  const { app, page } = await launchApp({ mockIpc: true, releaseHighlightsSeen: true,
    env: { STENOAI_E2E_SEED_MEETING: '1', STENOAI_E2E_SEED_REPORT: '1' } });
  await expect(page.locator('[data-app-ready]')).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#/meetings/epsilon_summary.json'; });
  await page.getByTestId('note-view-menu-trigger').click();
  await page.getByTestId('note-view-menu').getByRole('button', { name: /^Status Report/ }).click();
  await expect(page.getByTestId('meeting-detail')).toContainText('Pipeline healthy');
  // 0.9.2: the levels are there at once (local) and the AI levels are made in the background, once.
  const bar = page.locator('.summary-fold-dock .zoombar');
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Beknopt', exact: true }).click();
  await expect(page.locator('.tf-root .doc')).toContainText('Pipeline healthy');
  await expect(page.locator('.tf-root .doc')).not.toContainText('secret chain of thought');
  for (const name of ['Beknopt', 'Kern', 'Kernzin', 'Onderwerpen', 'Volledig']) {
    await bar.getByRole('button', { name, exact: true }).click();
    await expect(bar.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(page.getByTestId('summary-folding-panel')).toHaveAttribute('data-provenance', 'ai');
  await page.reload();
  await expect(page.locator('[data-app-ready]')).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#/meetings/epsilon_summary.json'; });
  await expect(page.getByTestId('meeting-detail')).toContainText('Pipeline healthy');
  await bar.getByRole('button', { name: 'Beknopt', exact: true }).click();
  await expect(page.locator('.tf-root .doc')).toContainText('Pipeline healthy');
  const calls = await app.evaluate(() => (globalThis as unknown as { __mockIpcCalls: unknown[] }).__mockIpcCalls);
  // One background run per source (the Standard note and this report), none after the reload.
  expect(calls.filter(call => call === 'summary-fold-generate')).toHaveLength(2);
});
