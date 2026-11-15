import { test, expect } from '../fixtures/electron';
import type { Page } from '@playwright/test';
import { ui, uiPart, uiText } from '../fixtures/ui-copy';

/**
 * T1 — renderer-only, mock IPC, no backend. Drives the real SpeakerReviewPanel
 * (MeetingDetail.tsx) against a seeded diarised meeting + seeded suggestions
 * (STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS=1, see app/e2e-mock-ipc.js). This
 * panel has real interaction risk -- four distinct actions, a popover, a
 * dialog -- so it earns T1 coverage per CLAUDE.md's carve-out, on top of the
 * model-free T2 spec (speaker-naming.t2) that proves the real backend/IPC
 * wire-shape truth.
 */

const SUMMARY_FILE = 'speaker-review-mtg_summary.json';

async function navigateToDetail(page: Page) {
  await page.evaluate((f) => {
    window.location.hash = `#/meetings/${encodeURIComponent(f)}`;
  }, SUMMARY_FILE);
  await expect(page.getByTestId('meeting-detail-title')).toContainText('Speaker Review Meeting');
}

async function openDetail(page: Page) {
  await navigateToDetail(page);
  await expect(page.getByTestId('speaker-review-panel')).toBeVisible();
}

test('calendar invitees fill new names and invited known people lead the Change picker', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: {
      STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1',
      STENOAI_E2E_SEED_CALENDAR_INVITEES: '1',
    },
  });
  await openDetail(page);
  const row = page.getByTestId('speaker-row-mic:SPEAKER_0');
  await row.getByRole('button', { name: ui('speakerReviewPanel.newPerson'), exact: true }).click();
  const invitees = page.getByTestId('speaker-invitees');
  await expect(invitees).toBeVisible();
  await expect(invitees).not.toContainText('Owner');
  await expect(invitees).not.toContainText('Person Beta');
  await invitees.getByRole('button', { name: 'Invited New Person' }).click();
  await expect(page.getByTestId('speaker-new-person-input')).toHaveValue('Invited New Person');
  await page.getByRole('button', { name: ui('models.cancel'), exact: true }).click();
  await row.getByRole('button', { name: ui('speakerReviewPanel.change'), exact: true }).click();
  const choices = page.locator('[data-testid^="speaker-pick-person-"]');
  await expect(choices.first()).toContainText('Person Beta');
});

test('saved transcript identifies each acoustically diarised speaker', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await navigateToDetail(page);

  await page.getByRole('button', { name: uiPart('askBar.showTranscript') }).click();
  const transcript = page.locator('.mv-transcript.open');

  await expect(transcript.getByText('Speaker 2', { exact: true })).toBeVisible();
  await expect(transcript.getByText('Speaker 3', { exact: true })).toBeVisible();
  await expect(transcript.getByText('Speaker 4', { exact: true })).toBeVisible();
  await expect(transcript.getByText('Others', { exact: true })).toHaveCount(0);
});

test('sidecar has multiple clusters opens review even when the transcript is not diarised', async ({
  launchApp,
}) => {
  // This catches a gate based only on is_diarised: the sidecar's separate
  // clusters are still actionable even though their transcript labels stay
  // generic.
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SIDECAR: '1' },
  });

  await openDetail(page);
  await expect(page.locator('[data-testid^="speaker-row-"]').nth(1)).toBeVisible();
});

test('a single sidecar cluster remains reviewable when the transcript is diarised', async ({
  launchApp,
}) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SINGLE_CLUSTER: '1' },
  });

  await openDetail(page);
  await expect(page.getByTestId('speaker-row-mic:SPEAKER_0')).toBeVisible();
  await expect(page.locator('[data-testid^="speaker-row-"]').nth(1)).toHaveCount(0);
});

test('Approve confirms the suggested person for a "confirmed"-tier row', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_0');
  await expect(row).toContainText(uiPart('speakerReviewPanel.likely', { suggested_name: 'Person Alpha' }));
  // Identification anchor (channel + first-heard timestamp + duration) --
  // without this, an "Unidentified speaker" row gives a human nothing to
  // go on to figure out who a cluster actually is.
  await expect(row).toContainText(uiPart('speakerReviewPanel.yourMic'));
  await expect(row).toContainText(uiPart('speakerReviewPanel.firstAt', { first_timestamp: '02:10' }));
  await row.getByRole('button', { name: uiPart('speakerReviewPanel.approve') }).click();

  // The row's own label becomes the acknowledgment -- confirmed_by_user
  // (real persisted evidence) always wins over the distance-based
  // "Likely X" text, so there's no separate, potentially-contradictory
  // feedback line to keep in sync with it.
  await expect(row).toContainText(uiPart('speakerReviewPanel.confirmedAs', { confirmed_by_user: 'Person Alpha' }));
  await expect(row).not.toContainText(uiPart('speakerReviewPanel.likely', { suggested_name: 'Person Alpha' }));
  // Re-approving an already-confirmed cluster is a no-op that would change
  // nothing visible -- the button is hidden rather than inviting a
  // pointless click.
  await expect(row.getByRole('button', { name: uiPart('speakerReviewPanel.approve') })).toHaveCount(0);
});

test('a stale speaker action refreshes the analysis and explains what changed', async ({
  launchApp,
}) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: {
      STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1',
      STENOAI_E2E_STALE_SPEAKER_RUN: '1',
    },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_0');
  await row.getByRole('button', { name: uiPart('speakerReviewPanel.approve') }).click();

  await expect(row.getByTestId('speaker-feedback-mic:SPEAKER_0')).toContainText(
    uiPart('speakerReviewPanel.theSpeakerAnalysisChangedWhile'),
  );
  await expect(row.getByTestId('speaker-feedback-mic:SPEAKER_0')).not.toContainText('Reload');
  await expect(row).toContainText('refreshed after new analysis');
  await expect(row.getByRole('button', { name: uiPart('speakerReviewPanel.approve') })).toBeEnabled();
});

test('Change picks a different existing person for a "possible"-tier row', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_1');
  await expect(row).toContainText(uiPart('speakerReviewPanel.mightBe', { display_name: 'Person Beta' }));
  await row.getByRole('button', { name: uiPart('speakerReviewPanel.change') }).click();

  // The popover portals outside the row's DOM subtree, so target it at the
  // page level -- there's only one "Person Alpha" entry visible while the popover
  // is open.
  await page.getByRole('button', { name: 'Person Alpha', exact: true }).click();

  await expect(row).toContainText(uiPart('speakerReviewPanel.confirmedAs', { confirmed_by_user: 'Person Alpha' }));
});

test('New person creates and confirms a brand-new profile', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: {
      STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1',
      STENOAI_E2E_CONFIRM_SPEAKER_DELAY_MS: '400',
    },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_2');
  await expect(row).toContainText(uiPart('speakerReviewPanel.unidentifiedSpeaker'));
  await row.getByRole('button', { name: uiPart('speakerReviewPanel.newPerson') }).click();

  await expect(page.getByText(uiPart('speakerReviewPanel.stenoCreatesANumericalBiometric'))).toBeVisible();
  await page.getByTestId('speaker-new-person-input').fill('Person Gamma');
  await expect(page.getByTestId('speaker-profile-authorized')).toHaveCount(0);
  await expect(page.getByTestId('speaker-new-person-submit')).toBeEnabled();
  await page.getByTestId('speaker-new-person-submit').click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: uiPart('models.cancel') })).toBeDisabled();
  await expect(dialog.getByTestId('speaker-new-person-submit')).toHaveText(ui('speakerReviewPanel.creating'));

  await expect(row).toContainText(uiPart('speakerReviewPanel.confirmedAs', { confirmed_by_user: 'Person Gamma' }));
  await expect(dialog).toHaveCount(0);
});

test('New person supports keyboard submission without a second confirmation', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_2');
  await row.getByRole('button', { name: uiPart('speakerReviewPanel.newPerson') }).click();
  await page.getByTestId('speaker-new-person-input').fill('Person Delta');
  await page.getByTestId('speaker-new-person-input').press('Enter');

  await expect(row).toContainText(uiPart('speakerReviewPanel.confirmedAs', { confirmed_by_user: 'Person Delta' }));
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('New person stays open and shows a safe error when creation fails', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: {
      STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1',
      STENOAI_E2E_CONFIRM_SPEAKER_FAIL: '1',
    },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_2');
  await row.getByRole('button', { name: uiPart('speakerReviewPanel.newPerson') }).click();
  await page.getByTestId('speaker-new-person-input').fill('Person Gamma');
  await page.getByTestId('speaker-new-person-submit').click();

  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('speaker-new-person-error')).toHaveText(
    ui('speakerReviewPanel.couldNotCreateThisPerson'),
  );
  await expect(page.getByTestId('speaker-new-person-error')).not.toContainText('private backend');
});

test('a stale New person attempt closes the old row before refreshing', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: {
      STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1',
      STENOAI_E2E_STALE_SPEAKER_RUN: '1',
    },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_2');
  await row.getByRole('button', { name: uiPart('speakerReviewPanel.newPerson') }).click();
  await page.getByTestId('speaker-new-person-input').fill('Person Gamma');
  await page.getByTestId('speaker-new-person-submit').click();

  // The dialog held a row object from the old run. It must disappear before
  // the query adopts the new run id, otherwise a retry can combine that new
  // id with the old cluster id and enroll the wrong voice.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row.getByTestId('speaker-feedback-mic:SPEAKER_2')).toContainText(
    uiText('speakerReviewPanel.theSpeakerAnalysisChangedWhile'),
  );
  await expect(row).toContainText('refreshed after new analysis');

  // A retry starts from a newly selected row with a fresh name.
  await row.getByRole('button', { name: uiPart('speakerReviewPanel.newPerson') }).click();
  await expect(page.getByTestId('speaker-new-person-input')).toHaveValue('');
  await expect(page.getByTestId('speaker-new-person-submit')).toBeDisabled();
});

test('New person blocks creating a duplicate of an existing person', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: {
      STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1',
      STENOAI_E2E_CONFIRM_SPEAKER_DELAY_MS: '400',
    },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_2');
  await row.getByRole('button', { name: uiPart('speakerReviewPanel.newPerson') }).click();

  // "Person Alpha" already exists (seeded). Typing it verbatim -- or any
  // case/whitespace variant -- must surface the collision and block
  // Create, rather than silently splitting Person Alpha's evidence across two
  // person_ids.
  await page.getByTestId('speaker-new-person-input').fill('  person alpha ');
  await expect(page.getByTestId('speaker-new-person-duplicate')).toBeVisible();
  await expect(page.getByTestId('speaker-new-person-submit')).toBeDisabled();
  await page.getByTestId('speaker-new-person-input').press('Enter');
  await expect(page.getByRole('dialog').getByRole('button', { name: uiPart('models.cancel') })).toBeEnabled();
  await expect(page.getByTestId('speaker-new-person-submit')).toHaveText(ui('speakerReviewPanel.create'));
  await expect(row).toContainText(uiPart('speakerReviewPanel.unidentifiedSpeaker'));

  // A genuinely new name clears the warning and re-enables Create.
  await page.getByTestId('speaker-new-person-input').fill('Someone New');
  await expect(page.getByTestId('speaker-new-person-duplicate')).toHaveCount(0);
  await expect(page.getByTestId('speaker-new-person-submit')).toBeEnabled();
});

test('searches a large people library without exposing deletion in the meeting picker', async ({
  launchApp,
}) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: {
      STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1',
      STENOAI_E2E_SEED_MANY_PEOPLE: '1',
    },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_0');
  await row.getByRole('button', { name: uiPart('speakerReviewPanel.change') }).click();

  const search = page.getByTestId('speaker-person-search-mic:SPEAKER_0');
  await expect(search).toBeVisible();
  await expect(page.locator('[data-testid^="speaker-pick-person-"]')).toHaveCount(10);
  await expect(page.locator('[data-testid^="speaker-delete-person-"]')).toHaveCount(0);

  await search.fill('Zora');
  await expect(page.getByRole('button', { name: 'Zora Quinn', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Person Alpha', exact: true })).toHaveCount(0);

  await search.fill('not in this library');
  await expect(page.getByTestId('speaker-person-no-match')).toHaveText(ui('speakerReviewPanel.noMatch'));
});

test('People settings deletion unwinds a confirmed meeting row', async ({
  launchApp,
}) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: {
      STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1',
      STENOAI_E2E_DELETE_PERSON_DELAY_MS: '400',
    },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_0');
  await row.getByRole('button', { name: uiPart('speakerReviewPanel.approve') }).click();
  await expect(row).toContainText(uiPart('speakerReviewPanel.confirmedAs', { confirmed_by_user: 'Person Alpha' }));

  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=people';
  });
  await expect(page.getByTestId('people-tab')).toBeVisible();
  await expect(page.getByText(uiPart('settings.localVoiceProfilesStenoCan'))).toBeVisible();
  await page.getByTestId('people-delete-p-alpha').click();

  const confirmDialog = page.locator('[data-confirm-dialog]');
  await expect(confirmDialog).toContainText(uiPart('settingsPeopleTab.delete3', { display_name: 'Person Alpha' }));
  await expect(confirmDialog).toContainText(uiText('settingsPeopleTab.thisRemovesThemFromEvery'));
  await confirmDialog.getByRole('button', { name: uiPart('models.deleteConfirm') }).click();
  await page.keyboard.press('Escape');
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog).toHaveCount(0);

  await openDetail(page);
  await page.getByTestId('speaker-toggle-filtered').click();
  const revertedRow = page.getByTestId('speaker-row-mic:SPEAKER_0');
  await expect(revertedRow).toBeVisible();
  await expect(revertedRow).toContainText(uiPart('speakerReviewPanel.unidentifiedSpeaker'));
  await expect(revertedRow).not.toContainText('Person Alpha');
});

test('People settings delete buttons identify the affected person', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });

  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=people';
  });
  await expect(page.getByTestId('people-tab')).toBeVisible();

  await expect(page.getByRole('button', { name: ui('settingsPeopleTab.delete', { display_name: 'Person Alpha' }), exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: ui('settingsPeopleTab.delete', { display_name: 'Person Beta' }), exact: true })).toBeVisible();
});

test('People settings plays one representative voice sample', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });

  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=people';
  });
  await expect(page.getByTestId('people-tab')).toBeVisible();

  const play = page.getByRole('button', { name: uiPart('settingsPeopleTab.playVoiceSampleFor', { display_name: 'Person Alpha' }) });
  await expect(play).toBeVisible();
  await expect(
    page.getByRole('button', { name: uiPart('settingsPeopleTab.playVoiceSampleFor', { display_name: 'Person Beta' }) }),
  ).toHaveCount(0);

  await play.click();
  const stop = page.getByRole('button', { name: uiPart('settingsPeopleTab.stopVoiceSampleFor', { display_name: 'Person Alpha' }) });
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(play).toBeVisible();
});

test('People settings returns to Play without an error when a voice sample ends', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });

  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=people';
  });
  await expect(page.getByTestId('people-tab')).toBeVisible();

  const play = page.getByRole('button', { name: uiPart('settingsPeopleTab.playVoiceSampleFor', { display_name: 'Person Alpha' }) });
  await play.click();
  await expect(page.getByRole('button', { name: uiPart('settingsPeopleTab.stopVoiceSampleFor', { display_name: 'Person Alpha' }) })).toBeVisible();
  await expect(play).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId('people-play-error-p-alpha')).toHaveCount(0);
});

test('People settings reports a media error after playback has started', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });

  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=people';
  });
  await expect(page.getByTestId('people-tab')).toBeVisible();
  await page.evaluate(() => {
    HTMLMediaElement.prototype.play = function () {
      window.setTimeout(() => this.dispatchEvent(new Event('error')), 50);
      return Promise.resolve();
    };
  });

  await page.getByRole('button', { name: uiPart('settingsPeopleTab.playVoiceSampleFor', { display_name: 'Person Alpha' }) }).click();
  await expect(page.getByTestId('people-play-error-p-alpha')).toHaveText(
    ui('settingsPeopleTab.couldNotPlayThisVoice'),
  );
});

test('People settings keeps voice sample failures private', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: {
      STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1',
      STENOAI_E2E_PERSON_SAMPLE_FAIL: '1',
    },
  });

  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=people';
  });
  await expect(page.getByTestId('people-tab')).toBeVisible();
  await page.getByTestId('people-play-p-alpha').click();

  await expect(page.getByTestId('people-play-error-p-alpha')).toHaveText(
    ui('settingsPeopleTab.couldNotPlayThisVoice'),
  );
  await expect(page.getByText('simulated private backend detail')).toHaveCount(0);
});

test('People settings deletion failure stays visible and keeps the profile', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: {
      STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1',
      STENOAI_E2E_DELETE_PERSON_FAIL: '1',
    },
  });

  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=people';
  });
  await expect(page.getByTestId('people-tab')).toBeVisible();
  await page.getByTestId('people-delete-p-alpha').click();

  const confirmDialog = page.locator('[data-confirm-dialog]');
  await confirmDialog.getByRole('button', { name: uiPart('models.deleteConfirm') }).click();
  await expect(confirmDialog).toBeVisible();
  await expect(page.getByTestId('people-delete-error')).toHaveText(
    ui('settingsPeopleTab.couldNotDeleteThisPerson'),
  );
  await expect(page.getByTestId('people-tab')).toContainText('Person Alpha');
});

// Replaces 'Keep generic dismisses the row locally, no confirm call needed',
// which asserted the row reached toHaveCount(0). That was true and is now
// deliberately false: the decision is persisted, and a persisted-but-hidden
// row would put its own undo somewhere nobody can reach. Renamed rather than
// edited in place -- quietly flipping the assertion would disguise a product
// decision as test maintenance.
test('Keep generic marks the row and leaves the undo one click away', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_2');
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: uiPart('speakerReviewPanel.keepGenericLabel') }).click();

  await expect(row).toBeVisible();
  await expect(row).toContainText(uiText('speakerReviewPanel.keptGenericYouDecidedNot'));
  // Parked means parked: the naming actions go with the decision, the same
  // way they do on a row marked as several people. Otherwise the row says
  // "you decided not to name this speaker" with three ways to name it
  // beside the sentence, and offers to reopen what was never closed.
  await expect(row.getByRole('button', { name: uiPart('speakerReviewPanel.change') })).toHaveCount(0);
  await expect(row.getByRole('button', { name: uiPart('speakerReviewPanel.newPerson') })).toHaveCount(0);

  const reopen = row.getByRole('button', { name: uiPart('speakerReviewPanel.reopenThisSpeakerForNaming') });
  await expect(reopen).toBeVisible();
  await reopen.click();
  await expect(page.getByTestId('speaker-kept-generic-mic:SPEAKER_2')).toHaveCount(0);
  await expect(row.getByRole('button', { name: uiPart('speakerReviewPanel.keepGenericLabel') })).toBeVisible();
  await expect(row.getByRole('button', { name: uiPart('speakerReviewPanel.change') })).toBeVisible();
});

test('Keep generic failure stays actionable and hides backend detail', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: {
      STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1',
      STENOAI_E2E_SET_REVIEW_FAIL: '1',
    },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_2');
  await row.getByRole('button', { name: uiPart('speakerReviewPanel.keepGenericLabel') }).click();

  await expect(row.getByTestId('speaker-feedback-mic:SPEAKER_2')).toHaveText(
    `${uiText('speakerReviewPanel.couldnTUpdateTheReview')}: ${uiText('speakerReviewPanel.tryAgain')}`,
  );
  await expect(row).not.toContainText('private backend detail');
  await expect(row.getByRole('button', { name: uiPart('speakerReviewPanel.keepGenericLabel') })).toBeEnabled();
});

test('the kept-generic marking survives leaving the meeting and coming back', async ({
  launchApp,
}) => {
  // The defect this whole slice exists for. The decision used to live in a
  // React state set, so it died with the panel, and every row the reviewer
  // had already dealt with came back on the next visit -- the exact work
  // the button was meant to save.
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_2');
  await row.getByRole('button', { name: uiPart('speakerReviewPanel.keepGenericLabel') }).click();
  await expect(row).toContainText(uiText('speakerReviewPanel.keptGenericYouDecidedNot'));

  await page.evaluate(() => {
    window.location.hash = '#/';
  });
  await openDetail(page);

  const rowAfter = page.getByTestId('speaker-row-mic:SPEAKER_2');
  await expect(rowAfter).toContainText(uiText('speakerReviewPanel.keptGenericYouDecidedNot'));
  await expect(rowAfter.getByRole('button', { name: uiPart('speakerReviewPanel.reopenThisSpeakerForNaming') })).toBeVisible();
});

test('Keep generic is not offered on a row that is already decided', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  // Confirmed: naming the row settles it, so parking it would say two
  // contradictory things about the same cluster.
  const confirmed = page.getByTestId('speaker-row-mic:SPEAKER_0');
  await confirmed.getByRole('button', { name: uiPart('speakerReviewPanel.approve') }).click();
  await expect(confirmed).toContainText(uiPart('speakerReviewPanel.confirmedAs', { confirmed_by_user: 'Person Alpha' }));
  await expect(confirmed.getByRole('button', { name: uiPart('speakerReviewPanel.keepGenericLabel') })).toHaveCount(0);

  // Marked as several people: same reasoning from the other direction.
  const marked = page.getByTestId('speaker-row-mic:SPEAKER_2');
  await marked.getByRole('button', { name: uiPart('speakerReviewPanel.thisIsMoreThanOne') }).click();
  await expect(marked).toContainText(uiPart('speakerReviewPanel.moreThanOnePerson'));
  await expect(marked.getByRole('button', { name: uiPart('speakerReviewPanel.keepGenericLabel') })).toHaveCount(0);
});

test('a cluster with no suggestion and no candidates never renders', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  await expect(page.getByTestId('speaker-row-mic:SPEAKER_3')).toHaveCount(0);
});

test('sample_text quotes what the cluster actually said', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_0');
  await expect(row).toContainText('I think we should ship this on Friday');
});

test('play button fetches and plays a real audio clip, toggling to stop', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  const playButton = page.getByTestId('speaker-play-mic:SPEAKER_0');
  await expect(playButton).toBeVisible();
  await expect(playButton).toHaveAttribute('aria-label', ui('speakerReviewPanel.playSample'));

  await playButton.click();
  await expect(playButton).toHaveAttribute('aria-label', ui('speakerReviewPanel.stopSample'));

  await playButton.click();
  await expect(playButton).toHaveAttribute('aria-label', ui('speakerReviewPanel.playSample'));
});

test('speaker row reports a safe error when sample playback fails', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: {
      STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1',
      STENOAI_E2E_SPEAKER_SAMPLE_FAIL: '1',
    },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_0');
  await row.getByTestId('speaker-play-mic:SPEAKER_0').click();
  await expect(row.getByRole('alert')).toHaveText(
    ui('speakerReviewPanel.couldNotPlayThisSample'),
  );
  await expect(row.getByRole('alert')).not.toContainText('private backend');
});

test('confirmation persists after navigating away and back, unlike the transient feedback line', async ({
  launchApp,
}) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_0');
  await row.getByRole('button', { name: uiPart('speakerReviewPanel.approve') }).click();
  await expect(row).toContainText(uiPart('speakerReviewPanel.confirmedAs', { confirmed_by_user: 'Person Alpha' }));

  // Navigate away (unmounts SpeakerReviewPanel, destroying all of its local
  // state -- there is no more "feedback" Map to fall back on) and back --
  // a fresh suggest-speakers fetch is the only source of truth left. The
  // label is derived from confirmed_by_user (real persisted evidence), so
  // it must read exactly the same as it did before navigating away, and
  // Approve must still be hidden.
  await page.evaluate(() => {
    window.location.hash = '#/';
  });
  await openDetail(page);

  const rowAfter = page.getByTestId('speaker-row-mic:SPEAKER_0');
  await expect(rowAfter).toContainText(uiPart('speakerReviewPanel.confirmedAs', { confirmed_by_user: 'Person Alpha' }));
  await expect(rowAfter.getByRole('button', { name: uiPart('speakerReviewPanel.approve') })).toHaveCount(0);
});

test('confirming one row disables every OTHER row\'s actions too, not just the one in flight', async ({
  launchApp,
}) => {
  // Real production incident this guards against: SpeakerReviewPanel shares
  // ONE confirm-speaker mutation across the whole panel. An earlier version
  // only disabled the specific row matching the in-flight mutation's
  // variables, leaving every OTHER row's Approve/Change/New person/Keep
  // generic buttons clickable while a confirm was still resolving --
  // letting two confirm-speaker calls (each reading-then-atomically-
  // rewriting the SAME saved transcript) run concurrently.
  const { page } = await launchApp({
    mockIpc: true,
    env: {
      STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1',
      STENOAI_E2E_CONFIRM_SPEAKER_DELAY_MS: '400',
    },
  });
  await openDetail(page);

  const rowA = page.getByTestId('speaker-row-mic:SPEAKER_0');
  const rowB = page.getByTestId('speaker-row-mic:SPEAKER_1');
  await expect(rowB.getByRole('button', { name: uiPart('speakerReviewPanel.change') })).toBeEnabled();

  await rowA.getByRole('button', { name: uiPart('speakerReviewPanel.approve') }).click();

  // rowA's own confirm is now in flight (mock delayed 400ms) -- rowB's
  // actions must ALSO be disabled during this window, not just rowA's.
  await expect(rowB.getByRole('button', { name: uiPart('speakerReviewPanel.change') })).toBeDisabled();
  await expect(rowB.getByRole('button', { name: uiPart('speakerReviewPanel.newPerson') })).toBeDisabled();
  await expect(rowB.getByRole('button', { name: uiPart('speakerReviewPanel.keepGenericLabel') })).toBeDisabled();

  // And once rowA's confirm resolves, rowB's actions become available again.
  await expect(rowA).toContainText(uiPart('speakerReviewPanel.confirmedAs', { confirmed_by_user: 'Person Alpha' }));
  await expect(rowB.getByRole('button', { name: uiPart('speakerReviewPanel.change') })).toBeEnabled();
});

test('filtered rows remain reachable through the filtered-rows toggle', async ({
  launchApp,
}) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  await expect(page.getByTestId('speaker-row-mic:SPEAKER_3')).toHaveCount(0);
  await expect(page.getByTestId('speaker-row-mic:SPEAKER_4')).toHaveCount(0);

  const toggle = page.getByTestId('speaker-toggle-filtered');
  await expect(toggle).toHaveText(ui('speakerReviewPanel.showFilteredRows.other', { count: '2' }));
  await toggle.click();

  await expect(page.getByTestId('speaker-row-mic:SPEAKER_3')).toBeVisible();
  await expect(page.getByTestId('speaker-row-mic:SPEAKER_4')).toBeVisible();
  await expect(toggle).toHaveText(ui('speakerReviewPanel.hideFilteredRows'));

  await toggle.click();
  await expect(page.getByTestId('speaker-row-mic:SPEAKER_3')).toHaveCount(0);
  await expect(page.getByTestId('speaker-row-mic:SPEAKER_4')).toHaveCount(0);
});

test('marking a row as more than one person removes every naming action and can be undone', async ({
  launchApp,
}) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_0');
  await expect(row).toContainText(uiPart('speakerReviewPanel.likely', { suggested_name: 'Person Alpha' }));

  await row.getByTestId('speaker-mark-multi-mic:SPEAKER_0').click();

  await expect(row).toContainText(uiPart('speakerReviewPanel.moreThanOnePerson'));
  await expect(row).toContainText(uiPart('speakerReviewPanel.leftOutOfNamingAnd'));
  // Every naming control is GONE, not disabled: confirm-speaker refuses a
  // marked cluster outright, so a greyed-out Approve would be a control
  // that can never become available, and a "Change" picker would invite
  // exactly the confirmation this marking exists to prevent.
  await expect(row.getByRole('button', { name: uiPart('speakerReviewPanel.approve') })).toHaveCount(0);
  await expect(row.getByTestId('speaker-change-mic:SPEAKER_0')).toHaveCount(0);
  await expect(row.getByTestId('speaker-new-person-mic:SPEAKER_0')).toHaveCount(0);

  // The row itself must STAY -- a marked cluster is status "none" with zero
  // candidates, which is the panel's "nothing actionable" hidden shape, so
  // without an explicit carve-out it would vanish the moment it was marked,
  // taking the only undo for a misclick with it.
  await expect(row).toBeVisible();

  // The button that clears the marking must not call itself "Undo": by
  // then the prototype, the participants entry and the transcript labels
  // of the withdrawn name are gone, and clearing the flag reopens the row
  // for naming rather than restoring what was there.
  const clearMark = row.getByTestId('speaker-mark-multi-mic:SPEAKER_0');
  await expect(clearMark).toContainText(uiPart('speakerReviewPanel.onePerson'));
  await expect(clearMark).toHaveAttribute(
    'aria-label',
    ui('speakerReviewPanel.thisIsOnePersonAfter'),
  );

  await clearMark.click();
  await expect(row).toContainText(uiPart('speakerReviewPanel.likely', { suggested_name: 'Person Alpha' }));
  await expect(row.getByRole('button', { name: uiPart('speakerReviewPanel.approve') })).toHaveCount(1);
});

test('a row with several excerpts expands into one playable entry per moment', async ({
  launchApp,
}) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_0');
  // Collapsed: one quote, no excerpt list.
  await expect(page.getByTestId('speaker-samples-mic:SPEAKER_0')).toHaveCount(0);

  await row.getByTestId('speaker-expand-mic:SPEAKER_0').click();

  const samples = page.getByTestId('speaker-samples-mic:SPEAKER_0');
  await expect(samples).toBeVisible();
  // Each moment gets its OWN play button. One shared button replaying the
  // same clip is the state this replaces -- several excerpts are what let
  // someone actually place a voice, and hearing two different voices in one
  // list is how a contaminated cluster becomes visible at all.
  await expect(page.getByTestId('speaker-play-mic:SPEAKER_0-0')).toBeVisible();
  await expect(page.getByTestId('speaker-play-mic:SPEAKER_0-1')).toBeVisible();
  await expect(page.getByTestId('speaker-play-mic:SPEAKER_0-2')).toBeVisible();

  await expect(samples).toContainText('02:10');
  await expect(samples).toContainText('the migration is the risky part');
  // A segment no transcript line covers keeps its row rather than being
  // dropped -- the clip is still playable, and dropping it would put every
  // later excerpt's play button out of step with its index.
  await expect(samples).toContainText(uiPart('speakerReviewPanel.noTranscriptForThisMoment'));

  // The fourth moment is one the backend could not place in the audio
  // (start === end). Its text is still this speaker's, so the row stays --
  // but its play button has to be inert: the backend refuses to cut a
  // collapsed range, and padding one into a clip would play whoever else
  // spoke at that second under this speaker's name.
  const unplayable = page.getByTestId('speaker-play-mic:SPEAKER_0-3');
  await expect(unplayable).toBeVisible();
  await expect(unplayable).toBeDisabled();
  await expect(unplayable).toHaveAttribute(
    'aria-label', ui('speakerReviewPanel.noAudioCouldBeMatched'),
  );
  await expect(samples).toContainText('a line with no audio to match it');

  await row.getByTestId('speaker-expand-mic:SPEAKER_0').click();
  await expect(page.getByTestId('speaker-samples-mic:SPEAKER_0')).toHaveCount(0);
});

test('the panel says how many people spoke when a cluster is known to hold more than one', async ({
  launchApp,
}) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  // Nothing marked yet: clusters and people are the same number, so there
  // is nothing to say and the line stays off.
  await expect(page.getByTestId('speaker-minimum-count')).toHaveCount(0);

  await page.getByTestId('speaker-mark-multi-mic:SPEAKER_0').click();

  // Sortformer returns at most four clusters per channel and gives no
  // indication when it ran out of slots, so this line is the only place a
  // fifth person is ever mentioned.
  const note = page.getByTestId('speaker-minimum-count');
  await expect(note).toBeVisible();
  await expect(note).toContainText(uiText('speakerReviewPanel.atLeastPeopleSpokeBut', { minimumSpeakers: 6, clusterCapacity: 5 }).trim());
});

test('rows are ordered by speaking time, so the first decisions cover the most transcript', async ({
  launchApp,
}) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  // The seed's durations are 245 / 80 / 30 s (plus two filtered rows), and
  // the cluster ids run the other way for SPEAKER_2, so channel+id order --
  // what the panel used before -- would be a different sequence. Reviewing
  // is voluntary and abandonable, so whoever stops after one row should
  // have covered the biggest speaker, not the lowest-numbered slot.
  const keys = await page
    .getByTestId('speaker-review-panel')
    .locator('[data-testid^="speaker-row-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));

  expect(keys).toEqual([
    'speaker-row-mic:SPEAKER_0',
    'speaker-row-mic:SPEAKER_1',
    'speaker-row-mic:SPEAKER_2',
  ]);
});

test('the Change picker offers people already assigned in this meeting first', async ({
  launchApp,
}) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  // One person owning several clusters is the normal case once the diarizer
  // splits a voice, and it has to be at least as easy to say as "New
  // person" -- naming the same voice twice makes it a hard negative against
  // itself, which suppresses that speaker's future suggestions for good.
  await page.getByTestId('speaker-approve-mic:SPEAKER_0').click();
  await expect(page.getByTestId('speaker-row-mic:SPEAKER_0')).toContainText(uiText('speakerReviewPanel.confirmedAs', { confirmed_by_user: 'Person Alpha' }).replace(/^✓ /, ''));

  await page.getByTestId('speaker-change-mic:SPEAKER_1').click();
  const names = await page
    .locator('[data-testid^="speaker-pick-person-"]')
    .evaluateAll((els) => els.map((el) => el.textContent?.trim() ?? ''));

  expect(names[0]).toContain('Person Alpha');
  expect(names[0]).toContain(uiText('speakerReviewPanel.here'));
});
