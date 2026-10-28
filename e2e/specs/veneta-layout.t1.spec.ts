import { test, expect } from '../fixtures/electron';
import { emitLiveSegments } from '../fixtures/live-transcript';

// Read the painted foreground against the first opaque background, including transparent controls.
function paintedContrast(element: Element) {
  const rgb = (color: string) => {
    const match = /^rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/.exec(color);
    if (!match) throw new Error(`Expected opaque RGB color, got ${color}`);
    const channels = match.slice(1).map(Number);
    if (channels.length !== 3 || !channels.every((value) => Number.isFinite(value) && value >= 0 && value <= 255)) {
      throw new Error(`Invalid RGB channels: ${color}`);
    }
    return channels;
  };
  const luminance = (color: string) => {
    const channels = rgb(color).map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const foreground = getComputedStyle(element).color;
  let backgroundElement: Element | null = element;
  while (backgroundElement && getComputedStyle(backgroundElement).backgroundColor === 'rgba(0, 0, 0, 0)') {
    backgroundElement = backgroundElement.parentElement;
  }
  if (!backgroundElement) throw new Error('No opaque painted background found');
  const background = getComputedStyle(backgroundElement).backgroundColor;
  const fg = luminance(foreground);
  const bg = luminance(background);
  return { foreground, background, ratio: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) };
}

// Run against a renderer built with VITE_VENETA_MEMOAI=1. Legacy builds skip this product-only contract.
// Uses the existing mock IPC state machine and real preload live events, never a microphone or ASR model.
test('Veneta live notes stay uncovered beside the real transcript, collapsing into an accessible sheet', async ({ launchApp }, testInfo) => {
  const { app, page } = await launchApp({
    mockIpc: true, fakeAudio: true, releaseHighlightsSeen: true,
    env: { STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1' },
  });
  test.skip(await page.locator('html').getAttribute('data-product') !== 'veneta-memoai', 'Requires the Veneta renderer build');
  await page.setViewportSize({ width: 1600, height: 1000 });
  const session = 'Veneta layout fixture';
  await page.evaluate(async (name) => {
    await window.stenoai.recording.start(name);
  }, session);
  await page.getByRole('button', { name: 'Open recording in progress' }).click();
  const panel = page.getByTestId('live-transcript-panel');
  const notes = page.getByRole('textbox', { name: 'Mijn notities' });
  const column = page.locator('#veneta-live-transcript-slot');
  await expect(panel).toBeVisible();
  await expect(page.locator('[data-dock-fade]')).toHaveCount(2);
  await expect.poll(() => page.locator('[data-dock-fade]').evaluateAll((nodes: Element[]) =>
    nodes.every((node) => getComputedStyle(node).display === 'none'))).toBe(true);
  await expect(column.getByTestId('live-transcript-panel')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toHaveCount(1);
  await expect(page.getByTestId('transcription-pill')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Live transcriptie' })).toBeVisible();
  await notes.fill('Decisions remain editable while speech arrives.');
  await emitLiveSegments(app, session, [
    { text: 'Approved decision', start: 0, end: 2, isFinal: true, speaker: 'You' },
    { text: 'A developing thought', start: 3, end: 4, isFinal: false, speaker: 'Others' },
  ]);
  await expect(panel.getByText('Approved decision')).toBeVisible();
  await expect(panel.getByText('A developing thought')).toBeVisible();
  await expect.poll(async () => {
    const n = await notes.boundingBox(); const p = await panel.boundingBox();
    return !!n && !!p && n.x + n.width <= p.x;
  }).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('veneta-e2e-wide.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // Fast-forward theme transitions before inspecting their settled colors.
  await page.screenshot({ path: testInfo.outputPath('veneta-e2e-dark.png'), animations: 'disabled' });
  const searchStyle = await panel.getByPlaceholder('Search transcript').evaluate((input: Element) => ({
    background: getComputedStyle(input).backgroundColor,
    foreground: getComputedStyle(input).color,
    rootClass: document.documentElement.className,
    classes: input.className,
  }));
  await testInfo.attach('dark-search-style', { body: JSON.stringify(searchStyle), contentType: 'application/json' });
  expect(searchStyle.background.match(/\d+/g)!.slice(0, 3).map(Number).every((channel: number) => channel < 64)).toBe(true);
  const filledStop = panel.getByRole('button', { name: 'Stop recording', exact: true });
  const filledStopContrast = await filledStop.evaluate(paintedContrast);
  console.log('dark-filled-stop-text', JSON.stringify(filledStopContrast));
  await testInfo.attach('dark-filled-stop-text', { body: JSON.stringify(filledStopContrast), contentType: 'application/json' });
  expect(filledStopContrast.ratio).toBeGreaterThanOrEqual(4.5);

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await panel.getByPlaceholder('Search transcript').fill('Approved');
  await expect(panel.getByText('A developing thought')).toHaveCount(0);
  await panel.getByPlaceholder('Search transcript').clear();
  await panel.getByRole('button', { name: 'Copy transcript' }).click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Approved decision');
  await panel.getByRole('button', { name: /Language:/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: testInfo.outputPath('veneta-e2e-dark-before-collapse.png'), animations: 'disabled' });
  // Keep the actual dark theme while closing: the transparent pill Stop must not inherit filled-button ink.
  await panel.getByRole('button', { name: 'Minimize transcript' }).click();
  await expect(panel).toHaveCount(0);
  const pill = page.getByTestId('transcription-pill');
  const collapsedStop = pill.getByRole('button', { name: 'Stop recording', exact: true });
  await expect(collapsedStop).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: testInfo.outputPath('veneta-e2e-dark-collapsed.png'), animations: 'disabled' });
  const collapsedStopContrast = await collapsedStop.locator('svg').evaluate(paintedContrast);
  console.log('dark-collapsed-stop-icon', JSON.stringify(collapsedStopContrast));
  await testInfo.attach('dark-collapsed-stop-icon', { body: JSON.stringify(collapsedStopContrast), contentType: 'application/json' });
  expect(collapsedStopContrast.ratio).toBeGreaterThanOrEqual(3);
  await pill.getByRole('button', { name: 'Show transcript' }).click();
  await expect(panel).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: testInfo.outputPath('veneta-e2e-dark-reopened.png'), animations: 'disabled' });
  expect((await filledStop.evaluate(paintedContrast)).ratio).toBeGreaterThanOrEqual(4.5);
  await expect(notes).toHaveValue('Decisions remain editable while speech arrives.');

  // The same mounted panel becomes an in-flow sheet below 1100px. Notes never sit behind it.
  await page.setViewportSize({ width: 1050, height: 900 });
  await expect.poll(async () => {
    const n = await page.locator('.veneta-recording-notes').boundingBox(); const p = await panel.boundingBox();
    return !!n && !!p && n.y + n.height <= p.y + 1;
  }).toBe(true);
  await expect(notes).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Stop recording', exact: true })).toBeInViewport();
  await expect(notes).toHaveValue('Decisions remain editable while speech arrives.');
  await page.screenshot({ path: testInfo.outputPath('veneta-e2e-narrow.png') });
  await page.evaluate(() => window.stenoai.recording.pause());
  await panel.getByRole('button', { name: 'Resume recording' }).click();
  await expect(panel.getByRole('button', { name: 'Resume recording' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Minimize transcript' }).click();
  await expect(panel).toHaveCount(0);
  await page.getByTestId('transcription-pill').getByRole('button', { name: 'Show transcript' }).click();
  await expect(panel).toHaveCount(1);
  await expect(notes).toHaveValue('Decisions remain editable while speech arrives.');
  await panel.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('/meetings/processing');
});
