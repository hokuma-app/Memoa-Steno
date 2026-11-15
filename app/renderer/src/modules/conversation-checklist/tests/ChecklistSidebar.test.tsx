import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChecklistSidebar } from '../ChecklistSidebar';
import type { ChecklistLiveState } from '../contracts';

const criteria = [
  { id: 'a', label: 'Prijs toegelicht', required: true },
  { id: 'b', label: 'Garantie genoemd', required: true },
  { id: 'c', label: 'Vervolgafspraak', required: true },
];
const segments = [
  { id: 's1', text: 'De prijs is tien euro per maand.', speaker: 'seller' as const, start: 192, end: 196 },
  { id: 's2', text: 'Dat is akkoord voor ons.', speaker: 'other' as const, start: 200, end: 203 },
  { id: 's3', text: 'Er zit garantie op.', speaker: 'seller' as const, start: 210, end: 212 },
];
const response = {
  revision: 'r1',
  assessments: [
    { criterionId: 'a', status: 'covered' as const, evidence: [{ segmentId: 's1', quote: 'tien euro per maand' }], explanation: 'Uitgelegd.', kind: 'explained' as const, customerConfirmed: true, customerEvidence: [{ segmentId: 's2', quote: 'akkoord voor ons' }] },
    { criterionId: 'b', status: 'partial' as const, evidence: [{ segmentId: 's3', quote: 'garantie' }], explanation: 'Genoemd.', kind: 'mentioned' as const, customerConfirmed: false, customerEvidence: [] },
    { criterionId: 'c', status: 'unmentioned' as const, evidence: [], explanation: 'Niet besproken.', kind: 'none' as const, customerConfirmed: false, customerEvidence: [] },
  ],
};
const live = (over: Partial<ChecklistLiveState> = {}): ChecklistLiveState => ({
  active: true, seq: 1, sessionId: 'recording:1', title: 'Adviseur Gesprek', criteria, mappingConfirmed: true, phase: 'noText',
  lastRunAt: null, failure: null, counters: { lines: 0, checks: 0, failures: 0, window: null }, lastReason: null, result: null, ...over,
});
const done = (over: Partial<ChecklistLiveState> = {}) => live({
  phase: 'listening', lastRunAt: '2026-10-29T12:38:05', counters: { lines: 3, checks: 1, failures: 0, window: null }, lastReason: 'stil',
  result: { response, segments }, ...over,
});
const status = () => screen.getByRole('status', { name: 'Status AI-controle' });
const diagnostics = () => (document.querySelector('[data-checklist-diagnostics]') as HTMLElement).textContent;
afterEach(() => cleanup());

describe('live sidebar beside the notes (display of the host-planned state)', () => {
  it('shows the checklist name, an x / N counter, a progress bar and open points', () => {
    render(<ChecklistSidebar live={live()} fallbackName="Gesprekschecklist" />);
    expect(screen.getByRole('heading', { name: 'Adviseur Gesprek' })).toBeTruthy();
    expect(screen.getByText('0 / 3')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Voortgang checklist' });
    expect([bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemax')]).toEqual(['0', '3']);
    expect(screen.getAllByRole('listitem').map((li) => li.getAttribute('data-state'))).toEqual(['open', 'open', 'open']);
    expect(status().textContent).toBe('AI luistert mee · lokaal · wacht op gesproken tekst');
  });

  it('falls back to the generic name when the host sent none', () => {
    render(<ChecklistSidebar live={live({ title: null })} fallbackName="Gesprekschecklist" />);
    expect(screen.getByRole('heading', { name: 'Gesprekschecklist' })).toBeTruthy();
  });

  it('offers nothing to tick, edit, opt into or save during the conversation', () => {
    render(<ChecklistSidebar live={live()} fallbackName="x" />);
    for (const role of ['checkbox', 'textbox', 'combobox', 'switch', 'button']) expect(screen.queryAllByRole(role), role).toEqual([]);
  });

  it.each([
    ['waiting', {}, 'AI luistert mee · lokaal · wacht op stabiele tekst'],
    ['busy', {}, 'AI controleert mee · lokaal · bezig'],
    ['finalBusy', {}, 'AI maakt de laatste controle · lokaal · bezig'],
    ['listening', { lastRunAt: '2026-10-29T12:38:05' }, 'AI luistert mee · lokaal · laatst 12:38'],
    ['ended', { lastRunAt: '2026-10-29T12:41:05' }, 'AI luistert mee · lokaal · laatst 12:41'],
    ['ended', { lastRunAt: null }, 'AI-controle afgerond'],
  ] as const)('shows the %s phase honestly', (phase, extra, text) => {
    render(<ChecklistSidebar live={live({ phase, ...extra })} fallbackName="x" />);
    expect(status().textContent).toBe(text);
    expect(status().getAttribute('data-checklist-status')).toBe(phase);
  });

  it('says too much text for one check when the host reports it', () => {
    render(<ChecklistSidebar live={live({ phase: 'tooLarge' })} fallbackName="x" />);
    expect(status().textContent).toContain('te veel tekst');
  });

  it('names a failure with its content-free reason and advice, from the code alone', () => {
    render(<ChecklistSidebar live={live({ phase: 'error', failure: { reason: 'model_missing', at: '2026-10-29T14:32:10' }, lastReason: 'model_missing' })} fallbackName="x" />);
    expect(status().textContent).toContain('AI-controle mislukt om 14:32.');
    expect(status().textContent).toContain('niet geïnstalleerd');
    expect(status().textContent).toContain('downloadt zelf nooit iets');
  });

  it('shows open, half and done points with a short quote, time and speaker, and counts only what was explained', () => {
    render(<ChecklistSidebar live={done()} fallbackName="x" />);
    const [a, b, c] = screen.getAllByRole('listitem');
    expect([a, b, c].map((li) => li.getAttribute('data-state'))).toEqual(['done', 'half', 'open']);
    expect(a.textContent).toContain('tien euro per maand');
    expect(a.textContent).toContain('03:12');
    expect(a.textContent).toContain('Jij');
    expect(b.textContent).toContain('Genoemd, nog niet uitgelegd');
    expect(a.textContent).toContain('Klant bevestigd');
    expect(a.textContent).toContain('akkoord voor ons');
    expect(b.textContent).not.toContain('Klant bevestigd');
    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
  });

  it('keeps not heard distinct from a model judgment that could not be assessed', () => {
    const uncertain = {
      ...response,
      assessments: [
        response.assessments[0],
        { criterionId: 'b', status: 'uncertain' as const, evidence: [], explanation: 'Oordeel afgewezen: citaat was niet bruikbaar.', kind: 'none' as const, customerConfirmed: false, customerEvidence: [] },
        response.assessments[2],
      ],
    };
    render(<ChecklistSidebar live={done({ result: { response: uncertain, segments } })} fallbackName="x" />);
    const [, rejected, absent] = screen.getAllByRole('listitem');
    expect(rejected.textContent).toContain('model kon niet beoordelen');
    expect(rejected.textContent).toContain('Oordeel afgewezen: citaat was niet bruikbaar.');
    expect(absent.textContent).toContain('Nog niet gehoord');
    expect(absent.textContent).not.toContain('model kon niet beoordelen');
  });

  it('shows the content-free diagnostic line: counters and a reason code, never text', () => {
    render(<ChecklistSidebar live={done({ counters: { lines: 12, checks: 3, failures: 0, window: null }, lastReason: 'maxwacht' })} fallbackName="x" />);
    expect(diagnostics()).toBe('tekstregels 12 · controles 3 · laatste reden maxwacht');
    expect(diagnostics()).not.toContain('tien euro');
  });

  it('shows "geen" before any reason and the window size once text outgrew one check', () => {
    const { rerender } = render(<ChecklistSidebar live={live()} fallbackName="x" />);
    expect(diagnostics()).toBe('tekstregels 0 · controles 0 · laatste reden geen');
    rerender(<ChecklistSidebar live={done({ counters: { lines: 400, checks: 5, failures: 1, window: 190 }, lastReason: 'te_veel_tekst' })} fallbackName="x" />);
    expect(diagnostics()).toBe('tekstregels 400 · controles 5 · laatste reden te_veel_tekst · venster laatste 190 regels');
  });

  it('never renders the same point twice, whatever the saved list holds', () => {
    const twice = [...criteria, { id: 'd', label: ' prijs   TOEGELICHT ', required: true }, { id: 'e', label: 'Prijs toegelicht', required: false }];
    render(<ChecklistSidebar live={done({ criteria: twice })} fallbackName="x" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('1 / 3')).toBeTruthy();
  });

  it('a fresh mount from the same host state looks identical: nothing lives in the component', () => {
    const state = done();
    const first = render(<ChecklistSidebar live={state} fallbackName="x" />);
    const before = first.container.innerHTML;
    first.unmount();
    const second = render(<ChecklistSidebar live={state} fallbackName="x" />);
    expect(second.container.innerHTML).toBe(before);
  });

  it('without a confirmed seller channel it says why', () => {
    render(<ChecklistSidebar live={done({ mappingConfirmed: false })} fallbackName="x" />);
    expect(screen.getByText(/Verkoperskanaal staat uit/)).toBeTruthy();
  });

  it('scrolls to the quote on click when the transcript can show it, and otherwise only says so', () => {
    const onJump = vi.fn(() => false);
    render(<ChecklistSidebar live={done()} fallbackName="x" onJump={onJump} />);
    const [first] = screen.getAllByRole('listitem');
    fireEvent.click(within(first).getByRole('button', { name: /Prijs toegelicht/ }));
    expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', start: 192 }));
    expect(screen.getByText('Open het transcript om het citaat te zien.')).toBeTruthy();
    onJump.mockReturnValue(true);
    fireEvent.click(within(first).getByRole('button', { name: /Prijs toegelicht/ }));
    expect(screen.queryByText('Open het transcript om het citaat te zien.')).toBeNull();
    expect(within(screen.getAllByRole('listitem')[2]).queryByRole('button')).toBeNull();
  });

  it('lets the transcript-closed hint go away by itself', async () => {
    vi.useFakeTimers();
    try {
      render(<ChecklistSidebar live={done()} fallbackName="x" onJump={() => false} />);
      fireEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button'));
      expect(screen.getByText('Open het transcript om het citaat te zien.')).toBeTruthy();
      await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
      expect(screen.queryByText('Open het transcript om het citaat te zien.')).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});
