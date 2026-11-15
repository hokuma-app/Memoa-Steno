import { mkdirSync } from 'fs';
import path from 'path';
import { test, expect } from '../fixtures/electron';
import type { Page } from '@playwright/test';
import { uiPart } from '../fixtures/ui-copy';

// Model-free: the mock IPC layer stands in for the backend (documents in the host's schema 2). Screenshots and short
// frame series go to SUMMARY_FOLD_SHOTS (or the Playwright output dir) for a visual review.
const shots = (name: string) => {
  const dir = process.env.SUMMARY_FOLD_SHOTS || test.info().outputDir;
  mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
};
const bar = (page: Page) => page.locator('.summary-fold-dock .zoombar');
const pressed = (page: Page) => bar(page).locator('[aria-pressed="true"]');
const panel = (page: Page) => page.getByTestId('summary-folding-panel');
const openNote = (page: Page) => page.evaluate(() => { window.location.hash = '#/meetings/epsilon_summary.json'; });
const theme = (page: Page, value: 'light' | 'dark') => page.evaluate((v) => {
  document.documentElement.classList.toggle('dark', v === 'dark');
  document.documentElement.dataset.theme = v;
}, value);
type App = { evaluate: <T>(fn: () => T) => Promise<T> };
const calls = async (app: App, name: string) => {
  const all = await app.evaluate(() => (globalThis as unknown as { __mockIpcCalls: string[] }).__mockIpcCalls);
  return all.filter((c) => c === name).length;
};
const ENV = { STENOAI_E2E_SEED_MEETING: '1', STENOAI_E2E_FOLD_RICH: '1', STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1' };

// A tally of the animations a level change creates (TextFold's FLIP, ghosts and stage), counted where they start:
// Element.animate is wrapped, and every call made in one synchronous burst (one motion being built) is one batch.
// Deterministic: it does not depend on a requestAnimationFrame tick catching the motion while it runs, which under load
// could miss a motion that started and was cancelled between two frames (the old 'animations count 0' flake).
const WATCH = `(() => {
  const seen = { transform: 0, fade: 0, batches: 0 };
  let batch = null;
  const original = Element.prototype.animate;
  Element.prototype.animate = function (keyframes, options) {
    const animation = original.call(this, keyframes, options);
    if (window.__watching) {
      if (!batch) { batch = { transform: 0, fade: 0 }; seen.batches++; queueMicrotask(() => { batch = null; }); }
      const kf = animation.effect && animation.effect.getKeyframes ? animation.effect.getKeyframes() : [];
      if (kf.some((k) => k.transform && k.transform !== 'none')) batch.transform++;
      if (kf.some((k) => k.opacity !== undefined && String(k.opacity) !== '1')) batch.fade++;
      seen.transform = Math.max(seen.transform, batch.transform); seen.fade = Math.max(seen.fade, batch.fade);
    }
    return animation;
  };
  window.__watching = true; window.__seen = seen;
})()`;

test('all five levels work at once from local levels, morph word by word, then morph to the AI levels without any button', async ({ launchApp }) => {
  const { app, page } = await launchApp({ mockIpc: true, releaseHighlightsSeen: true, env: { ...ENV, STENOAI_E2E_FOLD_STEP_MS: '1500' } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNote(page);
  await expect(page.getByRole('button', { name: uiPart('askBar.copyTranscript') })).toBeVisible();
  // The levels are there without a button and without waiting for the model: local levels, marked as provisional.
  await expect(panel(page)).toHaveAttribute('data-provenance', 'local');
  await expect(bar(page)).toBeVisible();
  await expect(pressed(page)).toHaveText('Volledig');
  await expect(page.getByText(/Voorlopig: de AI-niveaus worden gemaakt/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bereid detailniveaus voor' })).toHaveCount(0);
  await page.screenshot({ path: shots('t1-1440-light-volledig-local.png') });
  // Choosing a level now (before the AI levels exist) is immediate and morphs: tokens carry running transforms.
  await page.evaluate(WATCH);
  await bar(page).getByRole('button', { name: 'Kern', exact: true }).click();
  await page.screenshot({ path: shots('t1-frame-volledig-kern-mid.png') });
  await expect(pressed(page)).toHaveText('Kern');
  // Deterministic end of the motion: TextFold drops the 'morphing' class when the level change has come to rest.
  await expect(page.locator('.tf-root .doc[data-level="2"]')).toBeVisible();
  await expect(page.locator('.tf-root.morphing')).toHaveCount(0);
  const seen = await page.evaluate(() => (window as unknown as { __seen: { transform: number; fade: number; batches: number } }).__seen);
  expect(seen.batches, 'the level change built its motion').toBeGreaterThan(0);
  expect(seen.transform, 'animations with a transform on tokens').toBeGreaterThan(5);
  expect(seen.fade, 'fading pieces').toBeGreaterThan(0);
  await page.evaluate(() => { (window as unknown as { __watching: boolean }).__watching = false; });
  await expect(page.locator('.tf-root .doc[data-level="2"]')).toBeVisible();
  // The AI levels arrive in the background (one run, progress in the dock) and the page morphs to them.
  await expect(page.getByRole('status')).toContainText(/stap \d van 3/);
  await expect(panel(page)).toHaveAttribute('data-provenance', 'ai', { timeout: 15000 });
  await expect(page.getByText(/Voorlopig/)).toHaveCount(0);
  expect(await calls(app, 'summary-fold-generate')).toBe(1);
  expect(await calls(app, 'summary-fold-local')).toBe(1);
  await expect(pressed(page)).toHaveText('Kern');
  for (const [name, key] of [['Kernzin', '4'], ['Onderwerpen', '5'], ['Beknopt', '2'], ['Volledig', '1']]) {
    await page.keyboard.press(key);
    await expect(pressed(page)).toHaveText(name);
  }
  // Reload: the stored levels show at once; no new model run, no local pass.
  await page.reload();
  await expect(page.locator('[data-app-ready]')).toBeVisible();
  await openNote(page);
  await expect(panel(page)).toHaveAttribute('data-provenance', 'ai');
  await page.keyboard.press('3');
  await expect(pressed(page)).toHaveText('Kern');
  expect(await calls(app, 'summary-fold-generate')).toBe(1);
});

test('keys 1 to 5 and the wheel on the bar zoom; typing in the composer and reduced motion are respected', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true, releaseHighlightsSeen: true, env: ENV });
  await openNote(page);
  await expect(bar(page)).toBeVisible();
  await page.keyboard.press('5');
  await expect(pressed(page)).toHaveText('Onderwerpen');
  await expect(page.locator('.tf-root .doc .chunk').first()).toBeVisible();
  await page.keyboard.press('3');
  await expect(pressed(page)).toHaveText('Kern');
  const composer = page.getByTestId('primary-dock-row').getByRole('textbox').first();
  await composer.click();
  await page.keyboard.press('5');
  await expect(pressed(page)).toHaveText('Kern');
  await composer.blur();
  const box = (await bar(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  await expect.poll(async () => pressed(page).textContent()).not.toBe('Kern');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.locator('[data-app-ready]')).toBeVisible();
  await openNote(page);
  await expect(bar(page)).toBeVisible();
  await page.keyboard.press('2');
  await expect(pressed(page)).toHaveText('Beknopt');
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.constructor.name === 'Animation').length);
  expect(running).toBe(0);
});

test('the bar stays fixed at the bottom centre above the dock while long notes scroll, and the last text stays reachable', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true, releaseHighlightsSeen: true, env: { ...ENV, STENOAI_E2E_LONG_SUMMARY: '1' } });
  for (const [width, height] of [[1000, 780], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    await openNote(page);
    await expect(bar(page)).toBeVisible();
    for (const key of ['1', '3']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(900);
      const geometry = () => page.evaluate(() => {
        const pillBox = document.querySelector('.summary-fold-dock .zoombar')!.getBoundingClientRect();
        const dock = document.querySelector('.summary-fold-dock')!;
        const composer = document.querySelector('[data-testid="primary-dock-row"]')!.getBoundingClientRect();
        const column = document.querySelector('[data-testid="meeting-detail"]')!.getBoundingClientRect();
        const fade = document.querySelector('[data-dock-fade]')!.parentElement!;
        return {
          position: getComputedStyle(dock).position,
          pillBottom: pillBox.bottom, pillTop: pillBox.top,
          pillCentre: (pillBox.left + pillBox.right) / 2, columnCentre: (column.left + column.right) / 2,
          composerTop: composer.top,
          dockLayer: Number(getComputedStyle(fade).zIndex), pillLayer: Number(getComputedStyle(dock).zIndex),
          withinViewport: pillBox.left >= 0 && pillBox.right <= innerWidth && pillBox.bottom <= innerHeight,
        };
      });
      const before = await geometry();
      expect(before.position).toBe('fixed');
      expect(before.withinViewport).toBe(true);
      expect(before.pillBottom).toBeLessThan(before.composerTop - 8);
      expect(before.pillLayer).toBeGreaterThan(before.dockLayer);
      expect(Math.abs(before.pillCentre - before.columnCentre)).toBeLessThan(12);
      await page.evaluate(() => {
        const scroller = document.querySelector('[data-testid="meeting-detail"]')!.closest('.overflow-auto')!;
        scroller.scrollTop = scroller.scrollHeight;
      });
      await page.waitForTimeout(300);
      const after = await geometry();
      expect(Math.round(after.pillTop)).toBe(Math.round(before.pillTop));
      // The last line of the folded note can be read above the bar.
      const lastBottom = await page.evaluate(() => {
        const units = [...document.querySelectorAll('.tf-root .doc .u')].filter((n) => (n as HTMLElement).getBoundingClientRect().height > 0);
        return units[units.length - 1].getBoundingClientRect().bottom;
      });
      expect(lastBottom).toBeLessThan(after.pillTop);
      await page.screenshot({ path: shots(`t1-${width}-long-scrolled-level${key}.png`) });
    }
  }
});

test('screenshots and a frame series of the morph at 1000 and 1440 px in light and dark', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true, releaseHighlightsSeen: true, env: ENV });
  await openNote(page);
  await expect(bar(page)).toBeVisible();
  for (const width of [1000, 1440]) {
    await page.setViewportSize({ width, height: width === 1000 ? 780 : 900 });
    for (const mode of ['light', 'dark'] as const) {
      await theme(page, mode);
      for (const [name, key] of [['Volledig', '1'], ['Onderwerpen', '5']] as const) {
        await page.keyboard.press(key);
        await expect(pressed(page)).toHaveText(name);
        await page.waitForTimeout(900);
        const bounds = (await bar(page).boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        await page.screenshot({ path: shots(`t1-${width}-${mode}-${name.toLowerCase()}.png`) });
      }
    }
  }
  // A short frame series of one morph (Volledig to Kern) in the dark 1440 px window.
  await page.setViewportSize({ width: 1440, height: 900 });
  await theme(page, 'dark');
  await page.keyboard.press('1');
  await page.waitForTimeout(1500);
  await page.keyboard.press('3');
  for (let i = 0; i < 6; i++) {
    await page.screenshot({ path: shots(`t1-morph-frame-${i}.png`) });
    await page.waitForTimeout(90);
  }
});

test('a failed preparation keeps the local levels usable and names a content-free reason with advice', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true, releaseHighlightsSeen: true, env: { ...ENV, STENOAI_E2E_FOLD_FAIL_REASON: 'invalid_structure' } });
  await openNote(page);
  await expect(page.getByRole('alert')).toContainText('geen geldige structuur');
  await expect(page.getByRole('alert')).toContainText('Instellingen › AI');
  await expect(panel(page)).toHaveAttribute('data-provenance', 'local');
  await page.keyboard.press('5');
  await expect(pressed(page)).toHaveText('Onderwerpen');
  await page.keyboard.press('1');
  await expect(pressed(page)).toHaveText('Volledig');
});

test('with a cloud provider the AI levels are never made on opening, only after the explicit AI-niveaus maken button', async ({ launchApp }) => {
  const { app, page } = await launchApp({ mockIpc: true, releaseHighlightsSeen: true, env: { ...ENV, STENOAI_E2E_AI_PROVIDER: 'cloud' } });
  await openNote(page);
  await expect(panel(page)).toHaveAttribute('data-provenance', 'local');
  const make = page.getByRole('button', { name: 'AI-niveaus maken', exact: true });
  await expect(make).toBeVisible();
  await page.keyboard.press('5');
  await expect(pressed(page)).toHaveText('Onderwerpen');
  expect(await calls(app, 'summary-fold-generate')).toBe(0);
  await make.click();
  await expect(panel(page)).toHaveAttribute('data-provenance', 'ai');
  expect(await calls(app, 'summary-fold-generate')).toBe(1);
  await expect(make).toHaveCount(0);
});
