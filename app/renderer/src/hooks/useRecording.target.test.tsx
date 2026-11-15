import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  queue: { success: true, hasRecording: false, isProcessing: false, queueSize: 0, currentJob: null } as Record<string, unknown>,
  finishStart: null as null | ((value: unknown) => void),
}));
vi.mock('@/routes/MeetingDetail', () => ({ composeShareBody: vi.fn(), pickTranscriptForShare: vi.fn() }));
vi.mock('@/lib/ipc', () => {
  const anything = (): unknown =>
    new Proxy(() => () => {}, { get: () => anything(), apply: () => () => {} });
  const recording = new Proxy(
    {
      getQueue: async () => bridge.queue,
      start: () => new Promise((resolve) => (bridge.finishStart = resolve)),
    } as Record<string, unknown>,
    { get: (target, key: string) => (key in target ? target[key] : anything()) }
  );
  return { ipc: () => new Proxy({ recording } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : anything()) }) };
});
import { useRecording } from './useRecording';

it('an optimistic continue start exposes the raw append path but marks it unconfirmed until main reports the real path', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useRecording(), { wrapper });
  await waitFor(() => expect(result.current.status).toBe('idle'));
  act(() => {
    void result.current.startRecording('Note', 'manual', '/Users/x/notes/../notes/a_summary.md');
  });
  await waitFor(() => expect(result.current.status).toBe('recording'));
  expect(result.current.recordingSummaryFile).toBe('/Users/x/notes/../notes/a_summary.md');
  expect(result.current.recordingTargetConfirmed).toBe(false);
  bridge.queue = { success: true, hasRecording: true, isPaused: false, isProcessing: false, queueSize: 0,
    currentJob: null, sessionName: 'Note', recordingId: '7007', recordingSummaryFile: '/private/notes/a_summary.md' };
  await act(async () => bridge.finishStart?.({ success: true }));
  await waitFor(() => expect(result.current.recordingSummaryFile).toBe('/private/notes/a_summary.md'));
  expect(result.current.recordingTargetConfirmed).toBe(true);
  client.clear();
});
