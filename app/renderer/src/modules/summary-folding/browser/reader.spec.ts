import { expect, test } from '@playwright/test';

// The local levels morph to the AI levels (same words slide, the rest fades) without a button or a reload.
test('the page morphs from the local levels to the AI levels at the level the reader is on', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto('/src/modules/summary-folding/browser/index.html');
  await page.waitForFunction(() => !!(window as unknown as { __reader?: unknown }).__reader);
  await page.keyboard.press('3');
  await expect(page.locator('.zoombar [aria-pressed="true"]')).toHaveText('Kern');
  await page.waitForTimeout(1500);
  const before = await page.locator('.tf-root .doc').innerText();
  await page.evaluate(() => {
    const seen = { transform: 0, fade: 0 };
    (window as unknown as { __seen: typeof seen }).__seen = seen;
    const tick = () => {
      let t = 0, f = 0;
      for (const a of document.getAnimations()) {
        const kf = (a.effect as KeyframeEffect | null)?.getKeyframes?.() ?? [];
        if (kf.some((k) => k.transform && k.transform !== 'none')) t++;
        if (kf.some((k) => k.opacity !== undefined && String(k.opacity) !== '1')) f++;
      }
      seen.transform = Math.max(seen.transform, t);
      seen.fade = Math.max(seen.fade, f);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    (window as unknown as { __fold: { swapToAi(): void } }).__fold.swapToAi();
  });
  await expect(page.getByTestId('status')).toHaveText('ai:key');
  await page.waitForTimeout(900);
  const seen = await page.evaluate(() => (window as unknown as { __seen: { transform: number; fade: number } }).__seen);
  expect(seen.transform, 'words that stay slide').toBeGreaterThan(3);
  expect(seen.fade, 'words that go fade').toBeGreaterThan(0);
  expect(await page.locator('.tf-root .doc').innerText()).not.toBe(before);
  await expect(page.locator('.zoombar [aria-pressed="true"]')).toHaveText('Kern');
});

test('with reduced motion nothing animates and levels still change at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/src/modules/summary-folding/browser/index.html');
  await page.waitForFunction(() => !!(window as unknown as { __reader?: unknown }).__reader);
  await page.keyboard.press('4');
  await expect(page.locator('.zoombar [aria-pressed="true"]')).toHaveText('Kernzin');
  await expect(page.locator('.tf-root .doc[data-level="1"]')).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a.constructor.name === 'Animation').length)).toBe(0);
});

test('the reader works inside a scrolling element of the host, not only on the window', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto('/src/modules/summary-folding/browser/index.html?inner=1');
  await page.waitForFunction(() => !!(window as unknown as { __reader?: unknown }).__reader);
  await page.keyboard.press('2');
  await expect(page.locator('.zoombar [aria-pressed="true"]')).toHaveText('Beknopt');
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const s = document.querySelector('[data-testid=scroller]')!; s.scrollTop = 400; });
  await page.keyboard.press('3');
  await expect(page.locator('.zoombar [aria-pressed="true"]')).toHaveText('Kern');
  await page.waitForTimeout(1200);
  await page.keyboard.press('5');
  await expect(page.locator('.tf-root .doc[data-level="0"]')).toBeVisible();
  const cards = await page.locator('.tf-root .doc .chunk').count();
  expect(cards).toBeGreaterThan(4);
});
