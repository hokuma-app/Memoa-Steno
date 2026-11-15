import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgendaRuntime } from '../AgendaRuntime';
import type { AgendaLive, AgendaLiveActive } from '../contracts';

const state = vi.hoisted(() => ({ enabled: false, liveState: vi.fn(), liveAction: vi.fn(), listener: null as null | ((live: unknown) => void), off: vi.fn() }));
vi.mock('@/hooks/useProductSettings', () => ({ useModuleEnabled: () => state.enabled }));
vi.mock('@/lib/ipc', () => ({ ipc: () => ({
  agenda: state,
  on: { agendaLiveState: (cb: (live: unknown) => void) => { state.listener = cb; return state.off; } },
}) }));

const items = [
  { id: 'p1', title: 'Opening', outcome: 'discussie' as const, minutes: 5, owner: null, required: false },
  { id: 'p2', title: 'Nieuwe roosters', outcome: 'besluit' as const, minutes: 10, owner: 'Noor', required: true },
];
const live = (over: Partial<AgendaLiveActive> = {}): AgendaLiveActive => ({
  active: true, seq: 5, sessionId: 'recording:1', hostNow: 0, ended: false, stateVersion: 0,
  agenda: { title: 'Werkoverleg Kastanje', version: 1, items },
  items: { p1: { status: 'open', spentMs: 0, running: false, recognition: null, startOffset: null }, p2: { status: 'open', spentMs: 0, running: false, recognition: null, startOffset: null } },
  currentItemId: null, suggestion: null, findings: [], signals: [], planned: { totalMinutes: 15, meetingMs: 0 }, phase: 'waiting',
  lastRunAt: null, failure: null, counters: { lines: 2, checks: 0, failures: 0, stale: 0, skipped: 0 }, lastReason: null, ...over,
});
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const push = (next: AgendaLive) => act(async () => { state.listener?.(next); });
beforeEach(() => {
  state.enabled = false; state.listener = null; state.off.mockReset();
  state.liveState.mockReset().mockResolvedValue({ success: true, live: live() });
  state.liveAction.mockReset();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('silent chair during a recording (display of the host state)', () => {
  it('module off: reads nothing and subscribes to nothing', async () => {
    const { container } = render(<AgendaRuntime />);
    await settle();
    expect(container.textContent).toBe('');
    expect(state.liveState).not.toHaveBeenCalled();
    expect(state.listener).toBeNull();
  });

  it('shows the host state: items, status, diagnostics without content, and the AI disclosure', async () => {
    state.enabled = true;
    render(<AgendaRuntime />);
    await settle();
    expect(screen.getByRole('heading', { name: 'Werkoverleg Kastanje' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Status agendacontrole' }).textContent).toBe('AI volgt mee · lokaal · wacht op stabiele tekst');
    expect(screen.getByText('Laat deelnemers weten dat er een AI meeluistert.')).toBeTruthy();
    expect(document.querySelector('[data-agenda-diagnostics]')?.textContent).toBe('tekstregels 2 · controles 0 · laatste reden geen');
    const row = screen.getByRole('listitem', { name: '2. Nieuwe roosters' });
    expect(within(row).getByText('Open')).toBeTruthy();
    expect(within(row).getByText('00:00 van 10:00')).toBeTruthy();
  });

  it('an older snapshot never replaces a newer push', async () => {
    state.enabled = true;
    let resolve: (value: unknown) => void = () => {};
    state.liveState.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<AgendaRuntime />);
    await settle();
    await push(live({ seq: 9, phase: 'busy' }));
    await act(async () => { resolve({ success: true, live: live({ seq: 3, phase: 'noText' }) }); });
    expect(screen.getByRole('status', { name: 'Status agendacontrole' }).textContent).toBe('AI leest mee · lokaal · bezig');
  });

  it('a suggested switch is confirmed with one tap; manual actions go to the host', async () => {
    state.enabled = true;
    state.liveState.mockResolvedValue({ success: true, live: live({ suggestion: { itemId: 'p2', segmentId: 's1', quote: 'de nieuwe roosters', start: 75, speaker: 'self', at: 'x' } }) });
    state.liveAction.mockResolvedValue({ success: true, live: live({ seq: 6, currentItemId: 'p2',
      items: { p1: { status: 'open', spentMs: 0, running: false, recognition: null, startOffset: null }, p2: { status: 'loopt', spentMs: 0, running: true, recognition: 'agent_bevestigd', startOffset: 80 } } }) });
    render(<AgendaRuntime />);
    await settle();
    const suggestion = screen.getByTestId('agenda-suggestion');
    expect(within(suggestion).getByText('Punt 2 lijkt begonnen: Nieuwe roosters')).toBeTruthy();
    expect(within(suggestion).getByText('“de nieuwe roosters” (01:15)')).toBeTruthy();
    fireEvent.click(within(suggestion).getByRole('button', { name: 'Bevestig' }));
    await settle();
    expect(state.liveAction).toHaveBeenCalledWith({ action: 'confirmSuggestion', itemId: 'p2' });
    expect(screen.queryByTestId('agenda-suggestion')).toBeNull();
    const row = screen.getByRole('listitem', { name: '2. Nieuwe roosters' });
    expect(within(row).getByText('Loopt')).toBeTruthy();
    expect(within(row).getByText('voorstel bevestigd')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('listitem', { name: '1. Opening' })).getByRole('button', { name: 'Overslaan' }));
    expect(state.liveAction).toHaveBeenLastCalledWith({ action: 'skip', itemId: 'p1' });
  });

  it('the running clock ticks locally between pushes; signals and the time bar come from the host', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'));
    state.enabled = true;
    state.liveState.mockResolvedValue({ success: true, live: live({ currentItemId: 'p2',
      items: { p1: { status: 'afgerond', spentMs: 240_000, running: false, recognition: 'mens', startOffset: 0 }, p2: { status: 'loopt', spentMs: 480_000, running: true, recognition: 'mens', startOffset: 240 } },
      signals: [{ code: 'tijd_bijna_om', itemId: 'p2' }, { code: 'vereist_punt_open', itemIds: ['p2'] }],
      findings: [{ id: 'f000000000001', kind: 'besluit', itemId: 'p2', text: 'Rooster gaat in mei in.', owner: null, due: null, origin: 'ai',
        evidence: { segmentId: 's2', quote: 'rooster in mei', start: 300, end: 303, speaker: 'other' } }] }) });
    render(<AgendaRuntime />);
    await settle();
    const row = screen.getByRole('listitem', { name: '2. Nieuwe roosters' });
    expect(within(row).getByText('08:00 van 10:00')).toBeTruthy();
    expect(within(row).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('80');
    expect(row.querySelector('[data-signal="tijd_bijna_om"]')?.textContent).toBe('Tijd bijna om');
    expect(screen.getByRole('alert').textContent).toBe('Minder dan 10 minuten over. Vereist punt nog open: Nieuwe roosters');
    expect(within(row).getByText('Besluiten 1 · acties 0 · vragen 0')).toBeTruthy();
    expect(within(row).getByText('Voorstel')).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(5_000); });
    expect(within(row).getByText('08:05 van 10:00')).toBeTruthy();
    expect(row.querySelector('[data-signal="tijd_om"]')).toBeNull();
  });

  it('a failed host action is reported and nothing changes; an error phase shows concrete advice', async () => {
    state.enabled = true;
    state.liveState.mockResolvedValue({ success: true, live: live({ phase: 'error', failure: { reason: 'model_missing', at: '2026-11-15T10:00:00Z' } }) });
    state.liveAction.mockResolvedValue({ success: false, error: 'Er loopt geen opname met een agenda.' });
    render(<AgendaRuntime />);
    await settle();
    expect(screen.getByRole('status', { name: 'Status agendacontrole' }).textContent).toMatch(/Het gekozen lokale model is niet geïnstalleerd/);
    fireEvent.click(within(screen.getByRole('listitem', { name: '1. Opening' })).getByRole('button', { name: 'Start' }));
    await settle();
    expect(screen.getByRole('alert').textContent).toBe('Er loopt geen opname met een agenda.');
  });
});
