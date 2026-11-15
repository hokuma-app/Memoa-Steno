import { test, expect } from '../fixtures/electron';
import { ui, uiPart, uiText } from '../fixtures/ui-copy';

for (const unavailable of [false, true]) {
  test(`a local meeting with ${unavailable ? 'unavailable' : 'silent'} system audio`, async ({ launchApp }) => {
    const { page } = await launchApp({ mockIpc: true, fakeAudio: true, env: {
      STENOAI_E2E_RENDERER_PLATFORM: 'darwin',
      STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1',
    } });
    await page.getByRole('button', { name: ui('sidebar.home'), exact: true }).click();
    // Keep the real capture graph and timers, with deterministic device input.
    // Hidden Chromium windows may suspend Web Audio, so sample values are supplied
    // at the browser analyser boundary rather than relying on a playing oscillator.
    await page.evaluate((fail) => {
      const ctx = new AudioContext();
      const mic = ctx.createMediaStreamDestination();
      const system = ctx.createMediaStreamDestination();
      Object.assign(window, { __captureTestAudio: { ctx, mic, system } });
      navigator.mediaDevices.getUserMedia = async () => mic.stream;
      navigator.mediaDevices.getDisplayMedia = async () => {
        if (fail) throw new DOMException('Permission denied', 'NotAllowedError');
        return system.stream;
      };
      const createSource = AudioContext.prototype.createMediaStreamSource;
      AudioContext.prototype.createMediaStreamSource = function (stream) {
        const source = createSource.call(this, stream);
        const connect = source.connect.bind(source);
        Object.defineProperty(source, 'connect', {
          value(destination: AudioNode, output = 0, input = 0) {
            if (destination instanceof AnalyserNode) {
              destination.getFloatTimeDomainData = (buffer) => buffer.fill(stream === mic.stream ? 0.1 : 0);
            }
            return connect(destination, output, input);
          },
        });
        return source;
      };
    }, unavailable);
    await page.evaluate(() => window.stenoai.recording.start('In-person meeting'));
    await page.getByRole('button', { name: uiPart('mainToolbar.openRecording') }).click();
    await expect(page.getByTestId('capture-check')).toBeVisible();
    if (!unavailable) {
      await expect(page.getByRole('meter', { name: uiPart('recording.label_level', { label: uiText('recording.microphone') }) }))
        .toHaveAttribute('aria-valuenow', /[1-9][0-9]*/);
    }
    // Advance just Date, leaving media and sampling timers running normally.
    await page.evaluate(() => {
      const now = Date.now.bind(Date);
      Date.now = () => now() + 21_000;
    });
    if (unavailable) {
      await expect(page.getByTestId('capture-check-warning'))
        .toContainText(uiPart('recording.systemAudioIsNotBeing'));
    } else {
      await expect(page.getByTestId('capture-check')).toBeHidden();
      await expect(page.getByTestId('capture-check-warning')).toHaveCount(0);
    }
    const queue = await page.evaluate(() => window.stenoai.recording.getQueue());
    expect(queue.hasRecording).toBe(true);
  });
}
