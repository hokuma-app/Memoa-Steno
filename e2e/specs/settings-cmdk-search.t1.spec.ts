import { test, expect } from '../fixtures/electron';
import type { Page } from '@playwright/test';
import { ui, uiPart, uiText } from '../fixtures/ui-copy';

/**
 * T1 — renderer-only, mock IPC. Drives the context-aware ⌘K palette while the
 * Settings page is open: it must switch to "Search settings…" mode, filter the
 * settings index, and navigate to the tab the chosen setting lives on — and,
 * critically, switch the VISIBLE tab even when Settings is already open (the
 * route-reactive fix in Settings.tsx). Ported/adapted from @Vassista's PR #349.
 */

const palette = '[data-testid="command-palette"]';
const input = '[data-testid="command-palette-input"]';
const result = '[data-testid="command-palette-result"]';
const settingsPage = '[data-testid="settings-page"]';

const launchOpts = { mockIpc: true } as const;

async function openSettings(page: Page, tab?: string) {
  await page.evaluate((t) => {
    window.location.hash = t ? `#/settings?tab=${t}` : '#/settings';
  }, tab);
  await expect(page.locator(settingsPage)).toBeVisible();
}

test('⌘K in Settings searches settings, not notes', async ({ launchApp }) => {
  const { page } = await launchApp(launchOpts);
  await openSettings(page);

  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator(palette)).toBeVisible();

  // Context-aware: the palette is in settings mode.
  await expect(page.locator(input)).toHaveAttribute('placeholder', ui('commandPalette.searchSettings2'));
  await expect(page.locator(palette)).toContainText(uiPart('recording.microphone'));
  await expect(page.locator(palette)).toContainText(uiPart('settingsAiTab.aiProvider'));

  // Filtering narrows the settings index.
  await page.locator(input).fill(uiText('settingsAiTab.aiProvider').split(/[ -]/).pop()!.toLowerCase());
  await expect(page.locator(result)).toHaveCount(1);
  await expect(page.locator(result).nth(0)).toContainText(uiPart('settingsAiTab.aiProvider'));

  // Query is trimmed, and the index title matches the real settings label
  // ("Post meeting notifications", no hyphen) so searching the visible label
  // works even with surrounding whitespace.
  await page.locator(input).fill(`  ${uiText('settingsGeneralTab.postMeetingNotifications').split(' ').slice(0, 2).join(' ').toLowerCase()}  `);
  await expect(page.locator(result).filter({ hasText: uiPart('settingsGeneralTab.postMeetingNotifications') })).toHaveCount(1);
});

test('selecting a setting navigates to its tab and switches the visible tab', async ({
  launchApp,
}) => {
  const { page } = await launchApp(launchOpts);
  // Start on the AI tab so the jump to a General-tab setting has to actually
  // switch tabs — this exercises the route-reactive sync, not just first mount.
  await openSettings(page, 'ai');
  await expect(page.locator(settingsPage)).toContainText(uiPart('settingsAiTab.aiProvider'));

  await page.keyboard.press('ControlOrMeta+k');
  await page.locator(input).fill(uiText('privacyConsentModal.launchOnLogin').toLowerCase());
  await expect(page.locator(result)).toHaveCount(1);
  await expect(page.locator(result).nth(0)).toContainText(uiPart('privacyConsentModal.launchOnLogin'));
  await page.keyboard.press('Enter');

  // Palette closes, the route carries the target tab, and the General tab is
  // now the one rendered (its content is visible; the AI-only row is gone).
  await expect(page.locator(palette)).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('tab=general');
  await expect(page.locator(settingsPage)).toContainText(uiPart('privacyConsentModal.launchOnLogin'));
  await expect(page.locator(settingsPage)).not.toContainText(uiPart('settingsAiTab.aiProvider'));
});

test('search still works after a manual nav-rail tab switch (#405 regression)', async ({
  launchApp,
}) => {
  const { page } = await launchApp(launchOpts);
  await openSettings(page);

  // 1. ⌘K → jump to a setting on the AI tab. This navigates `?tab=ai`.
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator(input).fill(uiText('settingsAiTab.aiProvider').toLowerCase());
  await expect(page.locator(result)).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.locator(palette)).toBeHidden();
  await expect(page.locator(settingsPage)).toContainText(uiPart('settingsAiTab.aiProvider'));

  // 2. Click a DIFFERENT tab (General) in the nav rail. Pre-fix this called
  // setTab only and left the URL's `?tab=ai` stale; now it navigates
  // `?tab=general`, keeping the route the single source of truth.
  await page.locator('[data-settings-nav="general"]').click();
  await expect(page.locator(settingsPage)).toContainText(uiPart('privacyConsentModal.launchOnLogin'));
  await expect(page.locator(settingsPage)).not.toContainText(uiPart('settingsAiTab.aiProvider'));

  // 3. ⌘K → jump to the AI-tab setting AGAIN. Pre-fix, navigate('?tab=ai')
  // bailed on router's unchanged-hash early-return (the URL still said ai),
  // the route effect never fired, and the visible tab stayed stuck on General.
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator(input).fill(uiText('settingsAiTab.aiProvider').toLowerCase());
  await expect(page.locator(result)).toHaveCount(1);
  await page.keyboard.press('Enter');

  // The visible tab must actually switch back to AI — not silently do nothing.
  await expect(page.locator(palette)).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('tab=ai');
  await expect(page.locator(settingsPage)).toContainText(uiPart('settingsAiTab.aiProvider'));
  await expect(page.locator(settingsPage)).not.toContainText(uiPart('privacyConsentModal.launchOnLogin'));
});

test('browser Back to bare /settings resets the visible tab to General (#405)', async ({
  launchApp,
}) => {
  const { page } = await launchApp(launchOpts);
  await openSettings(page); // bare /settings → General

  // Nav to AI via the rail — pushes /settings?tab=ai onto the hash history.
  await page.locator('[data-settings-nav="ai"]').click();
  await expect(page.locator(settingsPage)).toContainText(uiPart('settingsAiTab.aiProvider'));

  // Browser Back returns to the bare route. The route→tab effect must treat
  // the absent param like first mount (General), not leave the AI tab stale.
  await page.goBack();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/settings');
  await expect(page.locator(settingsPage)).toContainText(uiPart('privacyConsentModal.launchOnLogin'));
  await expect(page.locator(settingsPage)).not.toContainText(uiPart('settingsAiTab.aiProvider'));
});

// Drift guard: a few index titles must still match the labels their tabs
// actually render, so a renamed control can't leave a stale search entry that
// jumps to a tab where nothing matches. Uses only cross-platform settings.
test('index titles match the rendered setting labels', async ({ launchApp }) => {
  const { page } = await launchApp(launchOpts);
  await openSettings(page);

  const cases: Array<{ query: string; label: string }> = [
    { query: uiText('settingsAiTab.aiProvider').toLowerCase(), label: uiText('settingsAiTab.aiProvider') },
    { query: 'discord', label: 'Discord' },
    { query: uiText('settingsGeneralTab.launchOnLogin').toLowerCase(), label: uiText('settingsGeneralTab.launchOnLogin') },
  ];

  for (const { query, label } of cases) {
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator(input).fill(query);
    await expect(page.locator(result).filter({ hasText: label })).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(page.locator(palette)).toBeHidden();
    // The tab the index entry points at actually renders that exact label.
    await expect(page.locator(settingsPage)).toContainText(label);
  }
});
