import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LevelMeter } from './Recording';

afterEach(cleanup);

describe('capture check meter', () => {
  // The test id used to come from comparing the label with 'Microphone', so in
  // the Dutch interface ('Microfoon') both meters were tagged as system audio.
  it('names the channel by its id, not by the translated label', () => {
    render(
      <>
        <LevelMeter id="mic" icon={null} label="Microfoon" channel={{ status: 'ok', level: 0.4 }} />
        <LevelMeter id="system" icon={null} label="Systeemgeluid" channel={{ status: 'listening', level: 0 }} />
      </>,
    );
    expect(screen.getByTestId('capture-meter-mic').textContent).toContain('Microfoon');
    expect(screen.getByTestId('capture-meter-system').textContent).toContain('Systeemgeluid');
  });
});
