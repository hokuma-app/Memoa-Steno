import { test, expect } from '../fixtures/electron';

// Empty meetings are an explicit UI fixture, not generated meeting/model output.
test('Veneta welcome and new-note hover remain readable in real light and dark renderers', async ({ launchApp }, testInfo) => {
  const { app, page } = await launchApp({ mockIpc: true, releaseHighlightsSeen: true,
    env: { STENOAI_E2E_PRODUCT_PROFILE: 'veneta', STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1' } });
  await app.evaluate(({ ipcMain }) => {
    // Electron 42 stores handlers on the instance; override only this owned UI fixture.
    const registry = (ipcMain as unknown as { _invokeHandlers: Map<string, unknown> })._invokeHandlers;
    if (!(registry instanceof Map)) throw new Error('Unsupported Electron test fixture');
    registry.set('list-meetings', async () => ({ success: true, meetings: [] }));
  });
  await page.reload();
  await expect(page.locator('[data-app-ready]')).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#/'; });
  test.skip((await page.title()) !== 'Veneta MemoAi', 'Requires the branded Veneta build, not the generic renderer');
  await expect(page.getByRole('heading', { name: 'Welkom bij Veneta MemoAi.', exact: true })).toBeVisible();
  const button = page.locator('.veneta-new-note');
  await expect(button).toBeVisible();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
    await button.hover();
    await page.screenshot({ path: testInfo.outputPath(`veneta-welcome-${colorScheme}.png`), animations: 'disabled' });
    const painted = await button.evaluate((element) => {
      const css = getComputedStyle(element);
      const luminance = (color: string) => {
        const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((n) => {
          const value = n / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const bg = luminance(css.backgroundColor), fg = luminance(css.color);
      return { background: css.backgroundColor, foreground: css.color,
        ratio: (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05) };
    });
    expect(painted.background).toBe('rgb(255, 248, 207)');
    expect(painted.foreground).toBe('rgb(0, 0, 0)');
    expect(painted.ratio).toBeGreaterThanOrEqual(4.5);
    console.log(`new-note-${colorScheme}-hover`, JSON.stringify(painted));
    await button.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(button).toBeFocused();
    expect(await button.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
    expect(await button.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe('2px');
  }
});
