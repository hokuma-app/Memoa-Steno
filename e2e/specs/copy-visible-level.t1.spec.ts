import { test, expect } from '../fixtures/electron';
import type { Page } from '@playwright/test';
import { uiPart, uiSource, uiText } from '../fixtures/ui-copy';

/**
 * T1 (0.10.2) — "Copy notes" copies what is visible: the detail level the reader shows (Beknopt, Kern, Kernzin,
 * Onderwerpen) of the open note or the open report, as Markdown; "Kopieer volledige notitie" (More options) is the
 * whole note. Model-free: the mock IPC layer stands in for the backend (fold documents in the host's schema 2).
 * The oracle is the reader's own rendered text, not the copy builder: the words in the copy must be the words on
 * screen, so no hidden text or morph in-between frame can slip in.
 */

const ENV = {
  STENOAI_E2E_SEED_MEETING: '1',
  STENOAI_E2E_SEED_REPORT: '1',
  STENOAI_E2E_FOLD_RICH: '1',
  STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1',
};
const SUMMARY_FILE = 'epsilon_summary.json';
const bar = (page: Page) => page.locator('.summary-fold-dock .zoombar');
const pressed = (page: Page) => bar(page).locator('[aria-pressed="true"]');
const panel = (page: Page) => page.getByTestId('summary-folding-panel');
const LEVEL_NUMBER: Record<string, number> = { Volledig: 4, Beknopt: 3, Kern: 2, Kernzin: 1, Onderwerpen: 0 };

async function installClipboardRecorder(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __clipboardWrites: string[] };
    w.__clipboardWrites = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (text: string) => { w.__clipboardWrites.push(text); return Promise.resolve(); } },
    });
  });
}
const clipboardWrites = (page: Page) =>
  page.evaluate(() => (window as unknown as { __clipboardWrites: string[] }).__clipboardWrites);

const words = (text: string) =>
  new Set(text.toLowerCase().normalize('NFC').split(/[^\p{L}\p{N}]+/u).filter(Boolean));

/** Choose a level and wait until the reader has settled on it (no morph in progress). */
async function chooseLevel(page: Page, name: keyof typeof LEVEL_NUMBER) {
  await bar(page).getByRole('button', { name, exact: true }).click();
  await expect(pressed(page)).toHaveText(name);
  await expect(page.locator(`.tf-root .doc[data-level="${LEVEL_NUMBER[name]}"]`)).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __reader?: { busy: boolean } }).__reader?.busy))).toBe(false);
}

/** The words the reader shows now (the doc element only; ghosts are separate and hidden). */
const visibleWords = async (page: Page) => words(await page.locator('.tf-root .doc').innerText());

async function openNote(page: Page) {
  await page.evaluate((f) => { window.location.hash = `#/meetings/${encodeURIComponent(f)}`; }, SUMMARY_FILE);
  await expect(page.getByRole('button', { name: uiPart('meetingDetail.copyNotes') })).toBeVisible();
  await expect(panel(page)).toHaveAttribute('data-provenance', 'ai', { timeout: 15000 });
}

test('Copy notes copies the chosen detail level of the note, in Markdown, and the menu copies the whole note', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true, releaseHighlightsSeen: true, env: ENV });
  await page.setViewportSize({ width: 1440, height: 900 });
  await installClipboardRecorder(page);
  await openNote(page);

  // Volledig: the whole note (unchanged behaviour).
  await page.getByRole('button', { name: uiPart('meetingDetail.copyNotes') }).click();
  let writes = await clipboardWrites(page);
  expect(writes).toHaveLength(1);
  const full = writes[0];
  expect(full).toContain(uiText('notesCopy.participants'));
  expect(full).toContain('Alice, Bob');

  const sizes: number[] = [full.length];
  for (const level of ['Beknopt', 'Kern', 'Kernzin', 'Onderwerpen'] as const) {
    await chooseLevel(page, level);
    await page.getByRole('button', { name: uiPart('meetingDetail.copyNotes') }).click();
    writes = await clipboardWrites(page);
    const copy = writes[writes.length - 1];
    // Markdown as shown: the note title, then the sections as headings.
    expect(copy, level).toContain('Epsilon Planning');
    expect(copy, level).toMatch(/\n## /);
    expect(copy, level).not.toContain(uiText('notesCopy.participants'));
    // The words in the copy are the words on screen: nothing hidden, nothing from another level.
    const shown = await visibleWords(page);
    const body = copy.slice(copy.indexOf('\n## '));
    const copied = words(body.replace(new RegExp(`(?:${uiSource('notesCopy.actionItems2')}|${uiSource('notesCopy.participants2')})[\\s\\S]*$`), ''));
    const onlyCopied = [...copied].filter((w) => !shown.has(w));
    const onlyShown = [...shown].filter((w) => !copied.has(w));
    expect(onlyCopied, `${level}: words in the copy that are not on screen`).toEqual([]);
    expect(onlyShown, `${level}: words on screen that are not in the copy`).toEqual([]);
    sizes.push(copy.length);
  }
  // Fewer words at every step down from Volledig to Onderwerpen.
  expect(sizes[1]).toBeLessThan(sizes[0]);
  expect(sizes[3]).toBeLessThan(sizes[1]);

  // "Kopieer volledige notitie" is the whole note whatever level is shown.
  await page.getByRole('button', { name: uiPart('meetingDetail.moreOptions') }).click();
  await page.getByTestId('copy-full-notes').click();
  writes = await clipboardWrites(page);
  expect(writes[writes.length - 1]).toBe(full);
});

test('Copy notes copies the chosen version: the open report at its detail level, not the standard note', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true, releaseHighlightsSeen: true, env: ENV });
  await page.setViewportSize({ width: 1440, height: 900 });
  await installClipboardRecorder(page);
  await openNote(page);

  const menu = page.getByTestId('note-view-menu');
  await page.getByTestId('note-view-menu-trigger').click();
  await menu.getByRole('button', { name: /^Status Report/ }).click();
  await expect(page.getByTestId('meeting-detail')).toContainText('Pipeline healthy');
  await expect(panel(page)).toHaveAttribute('data-provenance', 'ai', { timeout: 15000 });

  await page.getByRole('button', { name: uiPart('meetingDetail.copyNotes') }).click();
  let writes = await clipboardWrites(page);
  const fullReport = writes[writes.length - 1];
  expect(fullReport).toContain('- Pipeline healthy');
  expect(fullReport).toContain('- Next: open the reqs');

  await chooseLevel(page, 'Kernzin');
  await page.getByRole('button', { name: uiPart('meetingDetail.copyNotes') }).click();
  writes = await clipboardWrites(page);
  const short = writes[writes.length - 1];
  expect(short).toContain('Epsilon Planning');
  // The report is only two bullets, so the level copy is not shorter here; it is the level's text, as Markdown.
  expect(short).not.toBe(fullReport);
  expect(short).toMatch(/\n## /);
  expect(short).not.toContain(uiText('notesCopy.participants'));
  expect(short).not.toContain('secret chain of thought');
  expect(short).not.toContain('The team agreed');
  const shown = await visibleWords(page);
  const copied = words(short.slice(short.indexOf('\n## ') >= 0 ? short.indexOf('\n## ') : short.indexOf('\n')));
  expect([...copied].filter((w) => !shown.has(w))).toEqual([]);

  // The menu entry still gives the whole report.
  await page.getByRole('button', { name: uiPart('meetingDetail.moreOptions') }).click();
  await page.getByTestId('copy-full-notes').click();
  writes = await clipboardWrites(page);
  expect(writes[writes.length - 1]).toBe(fullReport);

  // Back on the standard note the copy is the standard note again, at the level that note shows (Volledig).
  await page.getByTestId('note-view-menu-trigger').click();
  await menu.getByRole('button', { name: uiPart('models.fn.summary') }).click();
  await expect(panel(page)).toHaveAttribute('data-provenance', /ai|local/);
  await page.getByRole('button', { name: uiPart('meetingDetail.copyNotes') }).click();
  writes = await clipboardWrites(page);
  expect(writes[writes.length - 1]).toContain(uiText('notesCopy.participants'));
  expect(writes[writes.length - 1]).not.toContain('Pipeline healthy');
});
