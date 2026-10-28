import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { useLiveTranscriptOpen } from '@/hooks/liveTranscriptOpenStore';

const state = vi.hoisted(() => ({ mounts: 0, active: 0, veneta: true, route: '/recording', engine: 'parakeet' as string | undefined,
  recording: { status: 'recording', sessionName: 'session-a' } }));
vi.mock('@/lib/productBrand', () => ({ get IS_VENETA_MEMOAI() { return state.veneta; } }));
vi.mock('@/lib/router', () => ({ useRoute: () => state.route }));
vi.mock('@/hooks/useRecording', () => ({ useRecording: () => state.recording }));
vi.mock('@/hooks/useModels', () => ({ useLiveTranscriptAvailable: () => state.engine === 'parakeet', useTranscriptionEngine: () => ({ data: state.engine }) }));
vi.mock('@/components/AskBar', () => ({ AskBar: () => <div>Ask</div>, TranscriptToggle: () => <button>Transcript</button> }));
vi.mock('@/components/LiveDock', () => ({ LiveDock: () => <div data-testid="pill">Pill controls</div> }));
vi.mock('@/components/LiveTranscriptBar', () => ({ LiveTranscriptBar: () => {
  useEffect(() => {
    state.mounts++;
    state.active++;
    expect(state.active).toBe(1);
    return () => { state.active--; };
  }, []);
  return <div data-testid="panel">Real panel slot</div>;
} }));
import { PrimaryDock, useSessionTranscriptDefault } from './PrimaryDock';

afterEach(cleanup);
beforeEach(() => {
  state.veneta = true; state.route = '/recording'; state.engine = 'parakeet';
  state.recording = { status: 'recording', sessionName: 'session-a' };
  useLiveTranscriptOpen.setState({ open: true });
});

describe('Veneta live recording layout', () => {
  it('moves the one live panel into the recording column without mounting duplicate pill controls', () => {
    state.mounts = 0;
    render(<><aside id="veneta-live-transcript-slot" /><PrimaryDock showAskBar /></>);
    expect(state.mounts).toBe(1);
    expect(screen.getByTestId('panel').parentElement?.id).toBe('veneta-live-transcript-slot');
    expect(screen.queryByTestId('pill')).toBeNull();
    act(() => useLiveTranscriptOpen.getState().setOpen(false));
    expect(screen.queryByTestId('panel')).toBeNull();
    expect(screen.getByTestId('pill')).toBeTruthy();
    act(() => useLiveTranscriptOpen.getState().setOpen(true));
    expect(screen.getAllByTestId('panel')).toHaveLength(1);
  });
  it('finds a slot inserted after the first commit and releases it on removal and navigation', async () => {
    state.mounts = 0;
    const { rerender, unmount } = render(<PrimaryDock showAskBar />);
    expect(screen.queryByTestId('panel')).toBeNull();
    const slot = document.createElement('aside');
    slot.id = 'veneta-live-transcript-slot';
    await act(async () => { document.body.append(slot); });
    expect(screen.getByTestId('panel').parentElement).toBe(slot);
    expect(state.mounts).toBe(1);
    await act(async () => { slot.append(document.createElement('span')); });
    expect(state.mounts).toBe(1);
    await act(async () => { slot.remove(); });
    expect(screen.queryByTestId('panel')).toBeNull();
    await act(async () => { document.body.append(slot); });
    expect(screen.getAllByTestId('panel')).toHaveLength(1);
    state.route = '/meetings';
    rerender(<PrimaryDock showAskBar />);
    expect(slot.querySelector('[data-testid="panel"]')).toBeNull();
    expect(screen.getAllByTestId('panel')).toHaveLength(1);
    unmount();
    await act(async () => { slot.remove(); document.body.append(slot); });
    expect(screen.queryByTestId('panel')).toBeNull();
    slot.remove();
  });
  it('disconnects slot observation on close, navigation and unmount', () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const { rerender, unmount } = render(<PrimaryDock showAskBar />);
    act(() => useLiveTranscriptOpen.getState().setOpen(false));
    expect(disconnect).toHaveBeenCalledTimes(1);
    act(() => useLiveTranscriptOpen.getState().setOpen(true));
    state.route = '/meetings';
    rerender(<PrimaryDock showAskBar />);
    expect(disconnect).toHaveBeenCalledTimes(2);
    state.route = '/recording';
    rerender(<PrimaryDock showAskBar />);
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(3);
    expect(state.active).toBe(0);
    disconnect.mockRestore();
  });
  it('leaves the legacy dock unchanged with the flag off or on another route', () => {
    state.veneta = false;
    const { rerender } = render(<PrimaryDock showAskBar />);
    expect(screen.getByTestId('panel').parentElement?.id).not.toBe('veneta-live-transcript-slot');
    state.veneta = true; state.route = '/meetings';
    rerender(<PrimaryDock showAskBar />);
    expect(screen.getByTestId('panel').parentElement?.id).not.toBe('veneta-live-transcript-slot');
  });
  it('keeps nonlive engines on the pill even if stored open', () => {
    state.engine = 'whisper';
    render(<PrimaryDock showAskBar />);
    expect(screen.queryByTestId('panel')).toBeNull();
    expect(screen.getByTestId('pill')).toBeTruthy();
  });
});

describe('session open default', () => {
  it('does not consume the new-session default before recording becomes active', () => {
    state.recording.status = 'idle';
    useLiveTranscriptOpen.setState({ open: false });
    const { rerender } = renderHook(() => useSessionTranscriptDefault(state.recording));
    expect(useLiveTranscriptOpen.getState().open).toBe(false);
    state.recording.status = 'recording'; rerender();
    expect(useLiveTranscriptOpen.getState().open).toBe(true);
  });
  it('opens a new active Parakeet session once, preserving close and pause choices', () => {
    useLiveTranscriptOpen.setState({ open: false });
    const { rerender } = renderHook(() => useSessionTranscriptDefault(state.recording));
    expect(useLiveTranscriptOpen.getState().open).toBe(true);
    act(() => useLiveTranscriptOpen.getState().setOpen(false));
    state.recording.status = 'paused'; rerender();
    expect(useLiveTranscriptOpen.getState().open).toBe(false);
    state.recording.sessionName = 'session-b'; rerender();
    expect(useLiveTranscriptOpen.getState().open).toBe(true);
  });
  it('waits for engine hydration and never opens Whisper or legacy sessions', () => {
    state.engine = undefined; useLiveTranscriptOpen.setState({ open: true });
    const { rerender } = renderHook(() => useSessionTranscriptDefault(state.recording));
    expect(useLiveTranscriptOpen.getState().open).toBe(false);
    state.engine = 'whisper'; rerender();
    expect(useLiveTranscriptOpen.getState().open).toBe(false);
    state.veneta = false; state.engine = 'parakeet'; state.recording.sessionName = 'legacy'; rerender();
    expect(useLiveTranscriptOpen.getState().open).toBe(false);
  });
});
