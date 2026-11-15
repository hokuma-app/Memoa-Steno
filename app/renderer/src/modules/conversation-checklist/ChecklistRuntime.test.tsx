import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChecklistRuntime } from './ChecklistRuntime';
import { jumpToTranscriptSegment } from './transcriptJump';
import type { ChecklistLive, ChecklistLiveState } from './contracts';

const state = vi.hoisted(() => ({
  enabled: false, liveState: vi.fn(), listener: null as null | ((live: unknown) => void), off: vi.fn(),
  attachPrepared: vi.fn(), getSettings: vi.fn(), evaluate: vi.fn(),
}));
vi.mock('@/hooks/useProductSettings', () => ({ useModuleEnabled: () => state.enabled }));
vi.mock('@/lib/ipc', () => ({ ipc: () => ({
  checklists: state,
  on: { checklistLiveState: (cb: (live: unknown) => void) => { state.listener = cb; return state.off; } },
}) }));

const criteria = [{ id: 'usp', label: 'Gratis meten', required: true }];
const live = (over: Partial<ChecklistLiveState> = {}): ChecklistLiveState => ({
  active: true, seq: 1, sessionId: 'recording:1', title: 'Eigen gesprek', criteria, mappingConfirmed: true, phase: 'waiting',
  lastRunAt: null, failure: null, counters: { lines: 2, checks: 0, failures: 0, window: null }, lastReason: null, result: null, ...over,
});
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const push = (next: ChecklistLive) => act(async () => { state.listener?.(next); });
beforeEach(() => {
  state.enabled = false; state.listener = null;
  state.off.mockReset(); state.attachPrepared.mockReset(); state.getSettings.mockReset(); state.evaluate.mockReset();
  state.liveState.mockReset().mockResolvedValue({ success: true, live: live() });
});
afterEach(() => cleanup());

describe('live checklist runtime (display of the host state)', () => {
  it('reads nothing and subscribes to nothing when the product module is disabled', async () => {
    const { container } = render(<ChecklistRuntime />);
    await settle();
    expect(container.textContent).toBe('');
    expect(state.liveState).not.toHaveBeenCalled();
    expect(state.listener).toBeNull();
  });

  it('shows the host state at mount, never plans or evaluates by itself, and never attaches or reads settings', async () => {
    state.enabled = true;
    render(<ChecklistRuntime />);
    expect(screen.getByRole('status').textContent).toContain('Checklist laden');
    await settle();
    expect(screen.getByRole('heading', { name: 'Eigen gesprek' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Status AI-controle' }).textContent).toBe('AI luistert mee · lokaal · wacht op stabiele tekst');
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(state.evaluate).not.toHaveBeenCalled();
    expect(state.attachPrepared).not.toHaveBeenCalled();
    expect(state.getSettings).not.toHaveBeenCalled();
  });

  it('follows pushed states and ignores an older snapshot that arrives after a newer push', async () => {
    state.enabled = true;
    let resolveSnapshot!: (value: unknown) => void;
    state.liveState.mockReturnValue(new Promise((resolve) => { resolveSnapshot = resolve; }));
    render(<ChecklistRuntime />);
    await push(live({ seq: 5, phase: 'busy' }));
    expect(screen.getByRole('status', { name: 'Status AI-controle' }).textContent).toContain('bezig');
    await act(async () => { resolveSnapshot({ success: true, live: live({ seq: 2, phase: 'waiting' }) }); });
    expect(screen.getByRole('status', { name: 'Status AI-controle' }).textContent).toContain('bezig');
    await push(live({ seq: 6, phase: 'listening', lastRunAt: '2026-10-29T12:38:05' }));
    expect(screen.getByRole('status', { name: 'Status AI-controle' }).textContent).toBe('AI luistert mee · lokaal · laatst 12:38');
  });

  it('a remount loses nothing: the new mount shows the same host counters and result immediately', async () => {
    state.enabled = true;
    const host = live({ seq: 9, phase: 'listening', lastRunAt: '2026-10-29T12:38:05', counters: { lines: 30, checks: 4, failures: 0, window: null }, lastReason: 'maxwacht' });
    state.liveState.mockResolvedValue({ success: true, live: host });
    for (let mount = 0; mount < 5; mount++) {
      const view = render(<ChecklistRuntime />);
      await settle();
      expect((document.querySelector('[data-checklist-diagnostics]') as HTMLElement).textContent).toBe('tekstregels 30 · controles 4 · laatste reden maxwacht');
      view.unmount();
    }
    expect(state.evaluate).not.toHaveBeenCalled();
    expect(state.off).toHaveBeenCalledTimes(5);
  });

  it('shows nothing when the host has no live checklist for this recording', async () => {
    state.enabled = true;
    state.liveState.mockResolvedValue({ success: true, live: { active: false, seq: 3 } });
    const { container } = render(<ChecklistRuntime />);
    await settle();
    expect(container.textContent).toBe('');
  });

  it('says so, without content, when the state cannot be read', async () => {
    state.enabled = true;
    state.liveState.mockResolvedValue({ success: false, error: 'x' });
    render(<ChecklistRuntime />);
    await settle();
    expect(screen.getByRole('alert').textContent).toContain('De checklist kon niet worden geladen');
  });
});

describe('jumping to the quote in the transcript', () => {
  const panel = () => {
    document.body.innerHTML = '<div data-testid="live-transcript-panel"><ul><li data-live-start="192"></li><li data-live-start="192.5"></li></ul></div>';
    const items = [...document.querySelectorAll<HTMLElement>('li')];
    items.forEach((li) => { li.scrollIntoView = vi.fn(); });
    return items;
  };
  it('scrolls the matching row into view and reports success', () => {
    const [first] = panel();
    expect(jumpToTranscriptSegment({ id: 's', text: 'x', speaker: 'seller', start: 192, end: 195 })).toBe(true);
    expect(first.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }));
  });
  it('reports false when the transcript is closed or the row is not there, and never throws on odd input', () => {
    document.body.innerHTML = '';
    expect(jumpToTranscriptSegment({ id: 's', text: 'x', speaker: 'seller', start: 192, end: 195 })).toBe(false);
    panel();
    expect(jumpToTranscriptSegment({ id: 's', text: 'x', speaker: 'seller', start: 5, end: 6 })).toBe(false);
    expect(jumpToTranscriptSegment({ id: 's', text: 'x', speaker: 'seller', start: Number.NaN, end: 6 })).toBe(false);
  });
});
