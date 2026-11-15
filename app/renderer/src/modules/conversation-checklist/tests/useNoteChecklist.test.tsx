import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteChecklist } from '../useNoteChecklist';

const state = vi.hoisted(() => ({ enabled: true, noteResult: vi.fn() }));
vi.mock('@/hooks/useProductSettings', () => ({ useModuleEnabled: () => state.enabled }));
vi.mock('@/lib/ipc', () => ({ ipc: () => ({ checklists: state }) }));
const found = (title = 'Adviseur Gesprek', covered = 7) => ({ success: true, found: true, title, markdown: 'm', overview: { score: { covered, total: 8 } } });
beforeEach(() => { state.enabled = true; state.noteResult.mockReset().mockResolvedValue(found()); });
afterEach(cleanup);

describe('useNoteChecklist', () => {
  it('loads the result of this note and exposes title and score for the tab label', async () => {
    const { result } = renderHook(() => useNoteChecklist('/n/a_summary.md'));
    await waitFor(() => expect(result.current.result).not.toBeNull());
    expect(state.noteResult).toHaveBeenCalledWith({ noteFile: '/n/a_summary.md' });
    expect(result.current.label).toBe('Adviseur Gesprek 7/8');
  });
  it('has no tab when the note has no result or the host cannot read it', async () => {
    state.noteResult.mockResolvedValue({ success: true, found: false });
    const { result, rerender } = renderHook(({ file }) => useNoteChecklist(file), { initialProps: { file: '/n/a.md' } });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.result).toBeNull();
    state.noteResult.mockResolvedValue({ success: false, error: 'x' });
    rerender({ file: '/n/b.md' });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.result).toBeNull();
    expect(result.current.label).toBeNull();
  });
  it('reads nothing while the module is off', async () => {
    state.enabled = false;
    const { result } = renderHook(() => useNoteChecklist('/n/a_summary.md'));
    await act(async () => { await Promise.resolve(); });
    expect(state.noteResult).not.toHaveBeenCalled();
    expect(result.current.result).toBeNull();
  });
  it('drops the result of the previous note when another note opens', async () => {
    const { result, rerender } = renderHook(({ file }) => useNoteChecklist(file), { initialProps: { file: '/n/a.md' } });
    await waitFor(() => expect(result.current.result).not.toBeNull());
    state.noteResult.mockResolvedValue({ success: true, found: false });
    rerender({ file: '/n/b.md' });
    expect(result.current.result).toBeNull();
  });
  it('takes a corrected result from the tab', async () => {
    const { result } = renderHook(() => useNoteChecklist('/n/a.md'));
    await waitFor(() => expect(result.current.result).not.toBeNull());
    act(() => result.current.update(found('Adviseur Gesprek', 6) as never));
    expect(result.current.label).toBe('Adviseur Gesprek 6/8');
  });
  it('while the last check of the conversation still runs it asks again and takes the finished result', async () => {
    vi.useFakeTimers();
    try {
      state.noteResult.mockResolvedValueOnce({ ...found('Adviseur Gesprek', 0), finalRunning: true });
      state.noteResult.mockResolvedValue({ ...found('Adviseur Gesprek', 5), finalRunning: false });
      const { result } = renderHook(() => useNoteChecklist('/n/a.md'));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(result.current.result?.finalRunning).toBe(true);
      expect(state.noteResult).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
      expect(result.current.label).toBe('Adviseur Gesprek 5/8');
      expect(result.current.result?.finalRunning).toBe(false);
      const calls = state.noteResult.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
      expect(state.noteResult).toHaveBeenCalledTimes(calls);
    } finally { vi.useRealTimers(); }
  });
  it('keeps asking until the result is there, also when the last check only claims after the wait, and then stops', async () => {
    vi.useFakeTimers();
    try {
      const open = (covered: number, evaluatedAt: string | null, finalRunning: boolean) => ({ ...found('Adviseur Gesprek', covered), overview: { score: { covered, total: 8 }, evaluatedAt }, finalRunning });
      state.noteResult.mockResolvedValueOnce(open(0, null, false));
      state.noteResult.mockResolvedValueOnce(open(0, null, true));
      state.noteResult.mockResolvedValue(open(6, '2026-01-01T00:00:00Z', false));
      const { result } = renderHook(() => useNoteChecklist('/n/a.md'));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(state.noteResult).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
      expect(state.noteResult).toHaveBeenCalledTimes(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
      expect(result.current.label).toBe('Adviseur Gesprek 6/8');
      const calls = state.noteResult.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(state.noteResult).toHaveBeenCalledTimes(calls);
    } finally { vi.useRealTimers(); }
  });
  it('does not poll forever for a note whose conversation never produced a result', async () => {
    vi.useFakeTimers();
    try {
      state.noteResult.mockResolvedValue({ ...found('Adviseur Gesprek', 0), overview: { score: { covered: 0, total: 8 }, evaluatedAt: null }, finalRunning: false });
      renderHook(() => useNoteChecklist('/n/a.md'));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
      const calls = state.noteResult.mock.calls.length;
      expect(calls).toBeGreaterThan(3);
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
      expect(state.noteResult).toHaveBeenCalledTimes(calls);
    } finally { vi.useRealTimers(); }
  });
});
