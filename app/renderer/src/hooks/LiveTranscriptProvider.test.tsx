import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LiveTranscriptProvider, useLiveTranscript } from './LiveTranscriptProvider';
const source = vi.hoisted(() => vi.fn(() => ({ status: 'streaming', finals: [{ text: 'Gedeelde bron' }], priorSegments: [], partials: [], segments: [], error: null, slow: false })));
vi.mock('./useLiveTranscript', () => ({ useLiveTranscript: source }));
vi.mock('./useRecording', () => ({ useRecording: () => ({ sessionName: 'owned-session' }) }));
afterEach(cleanup);
function Consumer() { const data = useLiveTranscript(); return <span>{data.finals[0]?.text}</span>; }
it('shares a single source owner between independently mounted checklist and transcript consumers', () => {
  const { rerender } = render(<LiveTranscriptProvider><Consumer /><Consumer /></LiveTranscriptProvider>);
  expect(source).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText('Gedeelde bron')).toHaveLength(2);
  rerender(<LiveTranscriptProvider><Consumer /></LiveTranscriptProvider>);
  expect(screen.getAllByText('Gedeelde bron')).toHaveLength(1);
  expect(source).toHaveBeenCalledTimes(2);
});
