import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '../fixtures/electron';
import { emitBufferedLiveSegments as emitLiveSegments } from '../fixtures/buffered-live-transcript';
import { ui } from '../fixtures/ui-copy';

// Agenda en voorzitter, stand 1 (Stille voorzitter): Home > agenda inladen, opname met de stille voorzitter, notulen in
// de notitie. Mock-IPC with the real host channels, planner, guards and files. MODELGRENS: only the model boundary is
// replaced (app/e2e-mock-ipc.js agendaModel, a synthetic, deterministic labeller). This proves the route and the
// interface, not the quality of a real local model. Invented agenda and conversation; no real persons.
const launchOptions = { mockIpc: true, fakeAudio: true, releaseHighlightsSeen: true,
  env: { STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1', STENOAI_E2E_PRODUCT_PROFILE: 'veneta', STENOAI_E2E_SEED_CHECKLIST_NOTE: '1' } };
const agendaSwitch = (page: Page) => page.getByRole('switch', { name: 'Agenda en voorzitter', exact: true });
const modelCalls = (app: ElectronApplication) => app.evaluate(() => (global as typeof global & { __agendaModelCalls?: number }).__agendaModelCalls ?? 0);
const AGENDA = [
  '# Werkoverleg Kastanje',
  'Datum: 3 maart',
  '1. Opening (5 min)',
  '2. Nieuwe roosters (besluit, 10 min, Noor) [vereist]',
  '3. Rondvraag',
].join('\n');

test('module off: Home shows no agenda card, the host reads and writes no agenda files and asks no model', async ({ launchApp, userDataDir }) => {
  const { app, page } = await launchApp(launchOptions);
  await expect(page.locator('[data-app-ready]')).toBeVisible();
  await expect(page.getByTestId('agenda-prepare')).toHaveCount(0);
  expect(await page.evaluate(() => window.stenoai.agenda.getPreparation())).toMatchObject({ success: false, code: 'module_disabled' });
  const root = path.join(userDataDir, 'veneta-modules');
  expect(existsSync(root) ? readdirSync(root).filter((name) => name.startsWith('agenda')) : []).toEqual([]);
  expect(await modelCalls(app)).toBe(0);
});

test('before, during and after: agenda in, silent chair with a confirmed suggestion and findings, minutes in the note', async ({ launchApp, userDataDir }) => {
  test.setTimeout(150_000);
  const { app, page } = await launchApp(launchOptions);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('[data-app-ready]')).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#/settings?tab=product'; });
  // Product and modules lists both modules side by side.
  await expect(page.getByRole('switch', { name: 'Gesprekschecklist', exact: true })).toBeVisible();
  await agendaSwitch(page).click();
  await expect(agendaSwitch(page)).toBeChecked();
  await page.evaluate(() => { window.location.hash = '#/'; });
  // ---- BEFORE: paste, read (deterministic, no model), edit, prepare ----
  const card = page.getByTestId('agenda-prepare');
  await card.getByRole('button', { name: 'Agenda inladen', exact: true }).click();
  await card.getByRole('textbox', { name: 'Plak de agenda (één punt per regel)', exact: true }).fill(AGENDA);
  await card.getByRole('button', { name: 'Agenda lezen', exact: true }).click();
  await expect(card.getByTestId('agenda-edit-row')).toHaveCount(3);
  await expect(card.getByRole('textbox', { name: 'Eigenaar van punt 2', exact: true })).toHaveValue('Noor');
  await expect(card.getByRole('combobox', { name: 'Uitkomst van punt 2', exact: true })).toHaveValue('besluit');
  await card.getByRole('spinbutton', { name: 'Minuten voor punt 3', exact: true }).fill('5');
  await card.getByRole('button', { name: 'Klaarzetten voor de volgende opname', exact: true }).click();
  await expect(card.getByText('Staat klaar · 3 punten · AI volgt stil mee', { exact: true })).toBeVisible();
  expect(await modelCalls(app)).toBe(0);
  // ---- DURING ----
  await page.getByRole('button', { name: ui('mainToolbar.newNote'), exact: true }).last().click();
  const sidebar = page.locator('[data-agenda-runtime]');
  await expect(sidebar.getByRole('heading', { name: 'Werkoverleg Kastanje', exact: true })).toBeVisible();
  await expect(sidebar.getByText('Laat deelnemers weten dat er een AI meeluistert.', { exact: true })).toBeVisible();
  const status = sidebar.getByRole('status', { name: 'Status agendacontrole', exact: true });
  await expect(status).toHaveText('AI volgt mee · lokaal · wacht op gesproken tekst');
  const session = await page.evaluate(async () => (await window.stenoai.recording.getQueue()).sessionName as string);
  // Manual start always works; time counts from that moment.
  await sidebar.locator('[data-agenda-item="p1"]').getByRole('button', { name: 'Start', exact: true }).click();
  await expect(sidebar.locator('[data-agenda-item="p1"]')).toHaveAttribute('data-status', 'loopt');
  await emitLiveSegments(app, session, [
    { text: 'Welkom allemaal bij het werkoverleg.', start: 2, end: 5, isFinal: true, speaker: 'You' },
    { text: 'We gaan nu naar nieuwe roosters.', start: 30, end: 33, isFinal: true, speaker: 'Others' },
  ]);
  const suggestion = sidebar.getByTestId('agenda-suggestion');
  await expect(suggestion).toContainText('Punt 2 lijkt begonnen: Nieuwe roosters', { timeout: 75_000 });
  // A suggestion changes nothing by itself; one tap confirms it.
  await expect(sidebar.locator('[data-agenda-item="p2"]')).toHaveAttribute('data-status', 'open');
  await suggestion.getByRole('button', { name: 'Bevestig', exact: true }).click();
  await expect(sidebar.locator('[data-agenda-item="p2"]')).toHaveAttribute('data-status', 'loopt');
  await expect(sidebar.locator('[data-agenda-item="p1"]')).toHaveAttribute('data-status', 'afgerond');
  await expect(sidebar.locator('[data-agenda-item="p2"]')).toContainText('voorstel bevestigd');
  // 0.11.0: the switch can be taken back with one tap (p1 runs again, with its time), and confirmed again.
  const undo = sidebar.getByTestId('agenda-undo');
  await expect(undo).toContainText('Opening afgerond.');
  await undo.getByRole('button', { name: 'Wissel ongedaan maken: Opening loopt weer', exact: true }).click();
  await expect(sidebar.locator('[data-agenda-item="p1"]')).toHaveAttribute('data-status', 'loopt');
  await expect(sidebar.locator('[data-agenda-item="p2"]')).toHaveAttribute('data-status', 'open');
  await expect(undo).toHaveCount(0);
  await sidebar.locator('[data-agenda-item="p2"]').getByRole('button', { name: 'Start', exact: true }).click();
  await expect(sidebar.locator('[data-agenda-item="p2"]')).toHaveAttribute('data-status', 'loopt');
  await expect(sidebar.locator('[data-agenda-item="p1"]')).toHaveAttribute('data-status', 'afgerond');
  await expect(sidebar.locator('[data-agenda-item="p2"]')).toContainText('gestart door jou');
  // 0.11.1: a spoken command on the user's own microphone moves the agenda directly, with the same undo.
  await expect(sidebar.locator('[data-voice-hint]')).toContainText('volgend punt');
  await emitLiveSegments(app, session, [
    { text: 'Oké, volgend punt.', start: 300, end: 302, isFinal: true, speaker: 'You' },
  ]);
  await expect(sidebar.locator('[data-agenda-item="p3"]')).toHaveAttribute('data-status', 'loopt');
  await expect(sidebar.locator('[data-agenda-item="p2"]')).toHaveAttribute('data-status', 'afgerond');
  await undo.getByRole('button', { name: /Wissel ongedaan maken/ }).click();
  await expect(sidebar.locator('[data-agenda-item="p2"]')).toHaveAttribute('data-status', 'loopt');
  await expect(sidebar.locator('[data-agenda-item="p3"]')).toHaveAttribute('data-status', 'open');
  await emitLiveSegments(app, session, [
    { text: 'We besluiten het nieuwe rooster in mei in te voeren.', start: 600, end: 604, isFinal: true, speaker: 'Others' },
    { text: 'Noor stuurt het rooster voor vrijdag rond.', start: 606, end: 609, isFinal: true, speaker: 'You' },
    { text: 'Wie boekt de zaal voor de volgende keer?', start: 612, end: 615, isFinal: true, speaker: 'Others' },
  ]);
  const running = sidebar.locator('[data-agenda-item="p2"]');
  await expect(running).toContainText('Besluiten 1 · acties 1 · vragen 1', { timeout: 75_000 });
  // 0.11.0: only a missing owner is a signal; the missing deadline is shown quietly at the decision.
  await expect(running.locator('[data-signal="besluit_zonder_eigenaar"]')).toHaveText('Besluit zonder eigenaar');
  await expect(running.locator('[data-finding-kind="besluit"] [data-due-missing]')).toHaveText('Termijn: niet genoemd');
  // The answer comes later; the question check after stopping finds it (over the whole conversation).
  await emitLiveSegments(app, session, [
    { text: 'Sanne boekt de zaal voor de volgende keer.', start: 640, end: 643, isFinal: true, speaker: 'You' },
  ]);
  await expect(sidebar.locator('[data-agenda-diagnostics]')).toHaveText(/^tekstregels 7 · controles \d+ · laatste reden (stil|maxwacht)$/, { timeout: 75_000 });
  // The renderer plans nothing itself.
  expect(await modelCalls(app)).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: test.info().outputPath('agenda-tijdens.png'), animations: 'disabled' });
  // ---- AFTER ----
  await page.getByRole('button', { name: ui('liveDock.showTranscript'), exact: true }).click();
  await page.getByTestId('live-transcript-panel').getByRole('button', { name: ui('mainToolbar.stopRecording'), exact: true }).click();
  const tab = page.getByTestId('tab-agenda');
  await expect(tab).toHaveText('Notulen');
  await tab.click();
  const minutes = page.getByTestId('agenda-note-tab');
  // The question check after stopping found the answer: the question is no longer open.
  await expect(page.getByTestId('agenda-questions-review')).toHaveText(
    'Na het stoppen zijn de open vragen nog eens nagegaan over het hele gesprek: 1 van 1 beantwoord.', { timeout: 30_000 });
  await expect(page.getByTestId('agenda-pills')).toHaveText('1 besluiten1 acties0 open vragen1 beantwoord3 voorstellen');
  await expect(minutes.locator('[data-review]').filter({ hasText: 'Wie boekt de zaal' }).getByTestId('agenda-answer'))
    .toHaveText('Antwoord: “Sanne boekt de zaal voor de volgende keer.” · 10:40 · Jij');
  const item = minutes.locator('[data-agenda-note-item="p2"]');
  await expect(item).toContainText('Liep nog bij het stoppen');
  const decision = item.locator('[data-review]').filter({ hasText: 'We besluiten het nieuwe rooster in mei in te voeren.' }).first();
  await expect(decision).toHaveAttribute('data-review', 'voorstel');
  await expect(decision).toContainText('10:00 · Anderen');
  await decision.getByRole('button', { name: 'Corrigeer', exact: true }).click();
  await decision.getByRole('textbox', { name: 'Eigenaar', exact: true }).fill('Noor');
  await decision.getByRole('textbox', { name: 'Termijn', exact: true }).fill('1 mei');
  await decision.getByRole('button', { name: 'Bewaar', exact: true }).click();
  await expect(decision).toHaveAttribute('data-review', 'gecorrigeerd');
  await expect(decision).toContainText('Eigenaar: Noor · Termijn: 1 mei');
  const action = item.locator('[data-review]').filter({ hasText: 'Noor stuurt het rooster' }).first();
  await action.getByRole('button', { name: 'Bevestig', exact: true }).click();
  await expect(action).toHaveAttribute('data-review', 'bevestigd');
  await expect(page.getByTestId('agenda-pills')).toHaveText('1 besluiten1 acties0 open vragen1 beantwoord1 voorstellen');
  await page.screenshot({ path: test.info().outputPath('agenda-na.png'), animations: 'disabled' });
  const noteFile = path.join(userDataDir, 'notes', 'klantgesprek_summary.md');
  const note = await page.evaluate((file) => window.stenoai.agenda.noteResult({ noteFile: file }), noteFile);
  if (!note.success || !note.found) throw new Error('no minutes');
  expect(note.markdown).toMatch(/^# Notulen Werkoverleg Kastanje\n/);
  expect(note.markdown).toContain('[gecorrigeerd] We besluiten het nieuwe rooster in mei in te voeren. · Eigenaar: Noor · Termijn: 1 mei');
  expect(note.markdown).toContain('[bevestigd] Noor stuurt het rooster voor vrijdag rond.');
  expect(note.markdown).toContain('[voorstel] Wie boekt de zaal voor de volgende keer?');
  expect(note.markdown).toContain('**Beantwoorde vragen**');
  expect(note.markdown).toContain('Beantwoord: "Sanne boekt de zaal voor de volgende keer." (10:40, Jij)');
  const root = path.join(userDataDir, 'veneta-modules');
  for (const directory of ['agenda-sessions', 'agenda-reviews', 'agenda-note-results']) expect(readdirSync(path.join(root, directory))).toHaveLength(1);
  // The canonical note is never written by the module.
  expect(existsSync(noteFile)).toBe(false);
});
