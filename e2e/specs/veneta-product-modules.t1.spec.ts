import type { ElectronApplication, Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '../fixtures/electron';
import { emitBufferedLiveSegments as emitLiveSegments } from '../fixtures/buffered-live-transcript';

const launchOptions = { mockIpc: true, fakeAudio: true, releaseHighlightsSeen: true,
  env: { STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1', STENOAI_E2E_PRODUCT_PROFILE: 'veneta' } };
// A synthetic stand-in for the shipped Veneta standard: the real definition has no points until Veneta delivers them.
function syntheticStandards(criteria: number) {
  const dir = mkdtempSync(path.join(tmpdir(), 'veneta-standards-'));
  writeFileSync(path.join(dir, 'adviseur-gesprek.json'), JSON.stringify({ id: 'veneta-adviseur-gesprek', name: 'Adviseur Gesprek', version: 1, locked: true,
    criteria: Array.from({ length: criteria }, (_, i) => ({ id: `syn-${i + 1}`, label: `Synthetisch standaardpunt ${i + 1}`, required: true })) }));
  return dir;
}
const moduleId = 'conversation-checklist';
const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
// Evidence screenshots go to the directory named by CHECKLIST_SHOTS_DIR when set (local review).
const shotsDir = process.env.CHECKLIST_SHOTS_DIR;
const profileSelect = (page: Page) => page.getByRole('combobox', { name: 'Productprofiel', exact: true });
const moduleSwitch = (page: Page) => page.getByRole('switch', { name: 'Gesprekschecklist', exact: true });
async function productSettings(page: Page) {
  await expect(page.locator('[data-app-ready]')).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#/settings?tab=product'; });
  await expect(profileSelect(page)).toBeVisible();
}
// The host plans and runs the live check itself; the mocked model boundary counts how often it was asked.
async function evaluationCalls(app: ElectronApplication) {
  return app.evaluate(() => (global as typeof global & { __checklistModelCalls?: number }).__checklistModelCalls ?? 0);
}

test('product profile persists locally and Default gates the module without erasing its preference', async ({ launchApp, userDataDir }) => {
  test.setTimeout(90_000);
  let { app, page } = await launchApp(launchOptions);
  const settingsFile = path.join(userDataDir, 'veneta-modules', 'product-settings.json');
  await productSettings(page);
  await expect(profileSelect(page)).toHaveValue('veneta');
  await expect(moduleSwitch(page)).not.toBeChecked();
  await moduleSwitch(page).click();
  await profileSelect(page).selectOption('default');
  await expect(moduleSwitch(page)).toBeDisabled();
  await expect(moduleSwitch(page)).not.toBeChecked();
  await expect(page.locator('html')).not.toHaveAttribute('data-product', 'veneta-memoai');
  await expect.poll(() => readJson(settingsFile)).toEqual({ schemaVersion: 1, profile: 'default', modules: { [moduleId]: true } });
  await app.close();
  ({ app, page } = await launchApp(launchOptions));
  await productSettings(page);
  await expect(profileSelect(page)).toHaveValue('default');
  await profileSelect(page).selectOption('veneta');
  await expect(moduleSwitch(page)).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-product', 'veneta-memoai');
  expect(await page.evaluate(() => window.stenoai.productSettings.get())).toEqual({ success: true, settings: readJson(settingsFile) });
  expect(await evaluationCalls(app)).toBe(0);
});

test('with the module off Home shows no checklist card and the host reads no checklist data', async ({ launchApp, userDataDir }) => {
  const { app, page } = await launchApp(launchOptions);
  await expect(page.locator('[data-app-ready]')).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#/'; });
  await expect(page.getByTestId('checklist-choice')).toHaveCount(0);
  await expect(page.getByTestId('checklist-preparation')).toHaveCount(0);
  const calls = await app.evaluate(() => (global as typeof global & { __mockIpcCalls: unknown[] }).__mockIpcCalls.filter(call => typeof call === 'string' && call.startsWith('veneta-checklist-')));
  expect(calls).toEqual([]);
  expect(existsSync(path.join(userDataDir, 'veneta-modules', 'checklist-preparation.json'))).toBe(false);
});

const card = (page: Page) => page.getByTestId('checklist-choice');
const choice = (page: Page) => card(page).getByRole('combobox', { name: /Gesprekschecklist voor de volgende opname/ });
async function enableModule(page: Page) {
  await productSettings(page);
  await moduleSwitch(page).click();
  await page.evaluate(() => { window.location.hash = '#/'; });
  await expect(card(page)).toBeVisible();
}
async function createOwn(page: Page, name: string, lines: string[]) {
  await card(page).getByRole('button', { name: '+ Eigen checklist maken', exact: true }).click();
  await card(page).getByRole('textbox', { name: 'Naam van je checklist', exact: true }).fill(name);
  await card(page).getByRole('textbox', { name: 'Checklistpunten (één per regel)', exact: true }).fill(lines.join('\n'));
  await card(page).getByRole('button', { name: 'Bewaar checklist', exact: true }).click();
  await expect(card(page).getByText('Staat klaar · AI controleert automatisch mee', { exact: true })).toBeVisible();
}

test('Home has one card; the shipped Adviseur Gesprek standard is locked and not selectable while its content is missing', async ({ launchApp, userDataDir }) => {
  test.setTimeout(90_000);
  const { page } = await launchApp(launchOptions);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await productSettings(page);
  await moduleSwitch(page).click();
  await page.evaluate(() => { window.location.hash = '#/'; });
  await expect(card(page)).toBeVisible();
  await expect(page.getByText('Gesprekschecklist voorbereiden', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Overzicht van eerdere gesprekken', { exact: true })).toHaveCount(0);
  await choice(page).click();
  const option = page.getByRole('option', { name: /Adviseur Gesprek/ });
  await expect(option).toHaveAttribute('aria-disabled', 'true');
  await expect(option).toContainText('Inhoud volgt van Veneta');
  await option.click({ force: true });
  await expect(card(page).getByText('Staat klaar · AI controleert automatisch mee')).toHaveCount(0);
  expect(existsSync(path.join(userDataDir, 'veneta-modules', 'checklist-preparation.json'))).toBe(false);
  await page.keyboard.press('Escape');
  await createOwn(page, 'Eigen synthetische leidraad', ['Synthetisch criterium: bespreek de meetafspraak', 'Synthetisch criterium: noem de garantie']);
  await expect(choice(page)).toContainText('Eigen synthetische leidraad');
  await card(page).getByRole('button', { name: '+ Eigen checklist maken', exact: true }).click();
  await card(page).getByRole('textbox', { name: 'Naam van je checklist', exact: true }).fill('adviseur  GESPREK');
  await expect(card(page).getByText('Deze naam is al in gebruik. Kies een andere naam.', { exact: true })).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Bewaar checklist', exact: true })).toBeDisabled();
});

test('with a synthetic standard definition the locked standard can be chosen, stays after restart and can never be edited or deleted', async ({ launchApp, userDataDir }) => {
  test.setTimeout(90_000);
  const dir = syntheticStandards(8);
  try {
    const options = { ...launchOptions, env: { ...launchOptions.env, STENOAI_E2E_STANDARD_CHECKLISTS_DIR: dir } };
    let { app, page } = await launchApp(options);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await enableModule(page);
    await choice(page).click();
    await expect(page.getByRole('option', { name: /Adviseur Gesprek/ })).toContainText('Veneta-standaard · vast · 8 punten');
    await page.getByRole('option', { name: /Adviseur Gesprek/ }).click();
    await expect(card(page).getByText('Staat klaar · AI controleert automatisch mee', { exact: true })).toBeVisible();
    await expect(card(page).getByText('Vaste Veneta-checklist: niet te bewerken of te verwijderen.', { exact: true })).toBeVisible();
    await expect(card(page).getByRole('button', { name: 'Bewerken', exact: true })).toHaveCount(0);
    await expect(card(page).getByRole('button', { name: 'Verwijderen', exact: true })).toHaveCount(0);
    // Not even through the host: no overwrite, no delete, and the shipped definition stays byte for byte.
    const before = readFileSync(path.join(dir, 'adviseur-gesprek.json'));
    const refused = await page.evaluate(async () => ({
      overwrite: await window.stenoai.checklists.saveNamedTemplate({ id: 'veneta-adviseur-gesprek', name: 'Adviseur Gesprek', criteria: [{ id: 'x', label: 'Verzonnen', required: true }] }),
      sameName: await window.stenoai.checklists.saveNamedTemplate({ name: 'Adviseur Gesprek', criteria: [{ id: 'y', label: 'Verzonnen', required: true }] }),
      remove: await window.stenoai.checklists.deleteNamedTemplate({ id: 'veneta-adviseur-gesprek' }),
    }));
    expect([refused.overwrite.success, refused.sameName.success, refused.remove.success]).toEqual([false, false, false]);
    expect(readFileSync(path.join(dir, 'adviseur-gesprek.json'))).toEqual(before);
    expect(existsSync(path.join(userDataDir, 'veneta-modules', 'checklist-templates.json'))).toBe(false);
    await app.close();
    ({ app, page } = await launchApp(options));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(choice(page)).toContainText('Adviseur Gesprek');
    await expect(card(page).getByText('Staat klaar · AI controleert automatisch mee', { exact: true })).toBeVisible();
    // Own checklists can be edited and deleted; Geen checklist clears the choice.
    await createOwn(page, 'Eigen synthetische leidraad', ['Punt A', 'Punt B']);
    await card(page).getByRole('button', { name: 'Bewerken', exact: true }).click();
    await card(page).getByRole('textbox', { name: 'Checklistpunten (één per regel)', exact: true }).fill('Punt A\nPunt C');
    await card(page).getByRole('button', { name: 'Bewaar checklist', exact: true }).click();
    await expect.poll(() => readJson(path.join(userDataDir, 'veneta-modules', 'checklist-templates.json'))[0].criteria.map((c: { label: string }) => c.label)).toEqual(['Punt A', 'Punt C']);
    await card(page).getByRole('button', { name: 'Verwijderen', exact: true }).click();
    await card(page).getByRole('button', { name: 'Ja, verwijderen', exact: true }).click();
    await expect(choice(page)).toContainText('Geen checklist');
    expect(readJson(path.join(userDataDir, 'veneta-modules', 'checklist-templates.json'))).toEqual([]);
    expect(existsSync(path.join(userDataDir, 'veneta-modules', 'checklist-preparation.json'))).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('before, during and after: automatic AI check without opt-in or manual ticking, result as tab in the note with score and rejection', async ({ launchApp, userDataDir }, testInfo) => {
  test.setTimeout(240_000);
  const dir = syntheticStandards(8);
  const evidence = (name: string) => (shotsDir ? path.join(shotsDir, name) : testInfo.outputPath(name));
  try {
    const options = { ...launchOptions, env: { ...launchOptions.env, STENOAI_E2E_STANDARD_CHECKLISTS_DIR: dir, STENOAI_E2E_SEED_CHECKLIST_NOTE: '1' } };
    const { app, page } = await launchApp(options);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await enableModule(page);
    const criteria = ['Leg gratis inmeten uit', 'Noem de garantie', 'Maak een concrete vervolgafspraak'];
    await createOwn(page, 'Eigen synthetische leidraad', criteria);
    const root = path.join(userDataDir, 'veneta-modules');
    // ---- DURING ----
    const session = 'Synthetic conversation';
    await page.evaluate(async name => { await window.stenoai.recording.start(name); }, session);
    await page.getByRole('button', { name: 'Open recording in progress', exact: true }).click();
    const panel = page.getByTestId('live-transcript-panel');
    await expect(panel).toHaveCount(0);
    await page.getByRole('button', { name: 'Show transcript', exact: true }).click();
    const sidebar = page.locator('[data-checklist-runtime]');
    await expect(sidebar.getByRole('heading', { name: 'Eigen synthetische leidraad', exact: true })).toBeVisible();
    await expect(sidebar.getByText('0 / 3', { exact: true })).toBeVisible();
    const status = sidebar.getByRole('status', { name: 'Status AI-controle', exact: true });
    await expect(status).toHaveText('AI luistert mee · lokaal · wacht op gesproken tekst');
    // No opt-in, no manual ticking, no editing: nothing to click except the points once they have a quote.
    for (const role of ['checkbox', 'textbox', 'combobox', 'switch'] as const) await expect(sidebar.getByRole(role)).toHaveCount(0);
    await expect(sidebar.getByRole('button')).toHaveCount(0);
    expect(await evaluationCalls(app)).toBe(0);
    await emitLiveSegments(app, session, [
      { text: 'Wij komen gratis meten bij u thuis.', start: 192, end: 196, isFinal: true, speaker: 'You' },
      { text: 'Dat is akkoord voor ons.', start: 200, end: 203, isFinal: true, speaker: 'Others' },
      { text: 'Garantie.', start: 210, end: 213, isFinal: true, speaker: 'You' },
    ]);
    await expect(panel.getByText('Wij komen gratis meten bij u thuis.', { exact: true })).toBeVisible();
    await expect(status).toHaveText('AI luistert mee · lokaal · wacht op stabiele tekst');
    // The packaged energy-saver profile waits thirty stable seconds; the
    // development profile keeps the original ten-second cadence.
    await expect(status).toHaveText(/^AI luistert mee · lokaal · laatst \d\d:\d\d$/, { timeout: 75_000 });
    expect(await evaluationCalls(app)).toBe(1);
    const points = sidebar.getByRole('listitem');
    await expect(points.nth(0)).toHaveAttribute('data-state', 'done');
    await expect(points.nth(1)).toHaveAttribute('data-state', 'half');
    await expect(points.nth(2)).toHaveAttribute('data-state', 'open');
    await expect(sidebar.getByText('1 / 3', { exact: true })).toBeVisible();
    await expect(points.nth(0)).toContainText('03:12 · Jij');
    await expect(points.nth(1)).toContainText('Genoemd, nog niet uitgelegd');
    // A click on a point scrolls to its quote in the transcript.
    await points.nth(0).getByRole('button').click();
    await expect(panel.locator('li[data-live-start="192"]')).toHaveClass(/veneta-jump-flash/);
    // The transcript folds away independently; the checklist stays.
    await panel.getByRole('button', { name: 'Minimize transcript', exact: true }).click();
    await expect(panel).toHaveCount(0);
    await expect(sidebar.getByRole('heading', { name: 'Eigen synthetische leidraad', exact: true })).toBeVisible();
    await points.nth(0).getByRole('button').click();
    await expect(sidebar.getByText('Open het transcript om het citaat te zien.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Show transcript', exact: true }).click();
    await expect(panel).toBeVisible();
    // Drafts are keyed by the recording identity and carry the checklist name; nothing manual was written.
    const draftsDir = path.join(root, 'drafts');
    await expect.poll(() => (existsSync(draftsDir) ? readdirSync(draftsDir).length : 0)).toBe(1);
    const draft = readJson(path.join(draftsDir, readdirSync(draftsDir)[0]));
    expect([draft.templateName, draft.manualOverrides]).toEqual(['Eigen synthetische leidraad', {}]);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      for (const width of [1440, 1000]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect(status).toBeInViewport();
        await expect(points.nth(2)).toBeInViewport();
        await expect.poll(async () => {
          const notes = await page.locator('.veneta-recording-notes').boundingBox();
          const side = await page.locator('.veneta-conversation-sidebar').boundingBox();
          return !!notes && !!side && notes.x + notes.width <= side.x + 1 && side.x + side.width <= width + 1;
        }).toBe(true);
        await expect(panel.getByRole('button', { name: 'Stop recording', exact: true })).toBeInViewport();
        await page.screenshot({ path: evidence(`tijdens-${width}-${scheme}.png`), animations: 'disabled' });
      }
    }
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    // ---- AFTER: stopping binds the result to the note the host knows ----
    await panel.getByRole('button', { name: 'Stop recording', exact: true }).click();
    const tab = page.getByTestId('tab-checklist');
    await expect(tab).toHaveText('Eigen synthetische leidraad 1/3');
    await expect(page.getByTestId('tab-summary')).toBeVisible();
    const links = path.join(root, 'note-results');
    expect(readdirSync(links)).toHaveLength(1);
    await tab.click();
    const result = page.getByTestId('checklist-note-tab');
    await expect(page.getByTestId('checklist-pills')).toHaveText('1 besproken1 deels1 gemist');
    const first = result.getByRole('listitem').nth(0);
    await expect(first).toContainText('uitgelegd + klant bevestigd');
    await expect(first).toContainText('03:12 · Jij');
    await expect(result.getByRole('listitem').nth(1)).toContainText('genoemd');
    await expect(result.getByRole('listitem').nth(2)).toContainText('niet gehoord');
    for (const role of ['checkbox', 'combobox', 'switch'] as const) await expect(result.getByRole(role)).toHaveCount(0);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      for (const width of [1440, 1000]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect(tab).toBeInViewport();
        await expect(result.getByRole('listitem').nth(2)).toBeInViewport();
        await page.screenshot({ path: evidence(`na-${width}-${scheme}.png`), animations: 'disabled' });
      }
    }
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    // The only human actions: reject an AI tick with a reason, and Niet van toepassing with a reason.
    await first.getByRole('button', { name: 'Onterecht? Afwijzen', exact: true }).click();
    await expect(result.getByRole('button', { name: 'Afwijzen', exact: true })).toBeDisabled();
    await result.getByRole('textbox', { name: 'Korte reden (verplicht)', exact: true }).fill('Synthetisch: de klant noemde dit zelf.');
    await result.getByRole('button', { name: 'Afwijzen', exact: true }).click();
    await expect(tab).toHaveText('Eigen synthetische leidraad 0/3');
    await expect(first).toContainText('Afgewezen door mens: Synthetisch: de klant noemde dit zelf.');
    await expect(first).toContainText('AI had dit als uitgelegd gemarkeerd');
    await expect(first).toContainText('niet gehoord');
    const noteLink = readJson(path.join(links, readdirSync(links)[0]));
    const savedDraft = readJson(path.join(draftsDir, `${noteLink.sessionKey}.json`));
    expect(Object.values(savedDraft.manualOverrides)).toEqual([{ origin: 'human', status: 'unmentioned', rejected: true, reason: 'Synthetisch: de klant noemde dit zelf.' }]);
    await result.getByRole('listitem').nth(2).getByRole('button', { name: 'Niet van toepassing', exact: true }).click();
    await result.getByRole('textbox', { name: 'Korte reden (verplicht)', exact: true }).fill('Synthetisch: geen vervolg nodig.');
    await result.getByRole('button', { name: 'Bewaar', exact: true }).click();
    await expect(tab).toHaveText('Eigen synthetische leidraad 0/2');
    await expect(page.getByTestId('checklist-pills')).toHaveText('0 besproken1 deels1 gemist1 niet van toepassing');
    await result.getByRole('button', { name: 'Afwijzing ongedaan maken', exact: true }).click();
    await expect(tab).toHaveText('Eigen synthetische leidraad 1/2');
    await result.getByRole('button', { name: 'Kopieer', exact: true }).click();
    await expect(result.getByText(/Gekopieerd|Kopiëren is niet gelukt/)).toBeVisible();
    // ---- Home: the score on the recent note, not a separate list ----
    await page.evaluate(() => { window.location.hash = '#/'; });
    const row = page.getByTestId('previous-row').filter({ hasText: 'Klantgesprek De Vries' });
    await expect(row.getByTestId('checklist-score')).toHaveText('Checklist 1/2');
    await expect(page.getByText('Overzicht van eerdere gesprekken', { exact: true })).toHaveCount(0);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      for (const width of [1440, 1000]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect(card(page)).toBeInViewport();
        await expect(row).toBeInViewport();
        await page.screenshot({ path: evidence(`voor-${width}-${scheme}.png`), animations: 'disabled' });
      }
    }
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await choice(page).click();
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.screenshot({ path: evidence('voor-keuzelijst-1440-light.png'), animations: 'disabled' });
    // The canonical note and the earlier overview files are not touched by any of this.
    expect(existsSync(path.join(userDataDir, 'notes', 'klantgesprek_summary.md'))).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a failed live check names its content-free reason and advice in the always-visible status line', async ({ launchApp }, testInfo) => {
  test.setTimeout(90_000);
  const { app, page } = await launchApp({ ...launchOptions, env: { ...launchOptions.env, STENOAI_E2E_CHECKLIST_FAIL: 'model_missing' } });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await enableModule(page);
  await createOwn(page, 'Foutproef', ['Synthetisch punt']);
  const session = 'Synthetic failing conversation';
  await page.evaluate(async name => { await window.stenoai.recording.start(name); }, session);
  await page.getByRole('button', { name: 'Open recording in progress', exact: true }).click();
  const sidebar = page.locator('[data-checklist-runtime]');
  await emitLiveSegments(app, session, [{ text: 'Synthetische uitleg.', start: 0, end: 2, isFinal: true, speaker: 'You' }]);
  const status = sidebar.getByRole('status', { name: 'Status AI-controle', exact: true });
  await expect(status).toContainText('AI-controle mislukt om', { timeout: 75_000 });
  await expect(status).toContainText('niet geïnstalleerd');
  await expect(status).toContainText('downloadt zelf nooit iets');
  expect(await evaluationCalls(app)).toBe(1);
  await expect(status).toBeInViewport();
  if (shotsDir) await page.screenshot({ path: path.join(shotsDir, 'tijdens-fout-1440-light.png'), animations: 'disabled' });
  await page.screenshot({ path: testInfo.outputPath('status-error.png'), animations: 'disabled' });
});
