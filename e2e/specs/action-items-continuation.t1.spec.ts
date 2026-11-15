import { test, expect } from '../fixtures/electron';
import { uiPart } from '../fixtures/ui-copy';

/**
 * T1 (0.10.2) — action items the model wrote over several lines show as "Name: task (due ...)", never as an owner
 * and a date alone. Model-free: the seeded note's lines go through app/action-items.js, the function the main process
 * uses to read a saved note (its rules and the Python twin are proven in app/action-items.test.js and
 * tests/test_action_items_continuation.py against the same cases).
 */
test('action items with the task on the next line show name and task; an owner with no task is left out', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    releaseHighlightsSeen: true,
    env: { STENOAI_E2E_SEED_MEETING: '1', STENOAI_E2E_SEED_ACTION_LINES: '1' },
  });
  await page.evaluate(() => { window.location.hash = '#/meetings/epsilon_summary.json'; });
  await expect(page.getByRole('button', { name: uiPart('meetingDetail.copyNotes') })).toBeVisible();

  const items = page.locator('ul.mv-bullets').last().locator('li');
  await expect(items).toHaveText([
    'Speaker 2: Stuur de offerte naar de klant (due 2026-11-06)',
    'Speaker 2: Plan de demo in (due 2026-11-06)',
    'Team members: Controleer de planning en meld afwijkingen (due 2026-11-06)',
    'Management: Besluit over het budget (due 2026-11-06)',
    'Anna: deel de slides',
  ]);
  // The trailing "Team members (due ...)" had no task at all: it is not shown as a bare owner and date.
  await expect(page.locator('ul.mv-bullets').last()).not.toContainText(/^Team members \(due/m);
});
