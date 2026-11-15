import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { AgendaNoteTab } from '../AgendaNoteTab';
import { useNoteAgenda } from '../useNoteAgenda';
import type { AgendaMinutes, AgendaMinutesFinding, AgendaNoteFound } from '../contracts';

const state = vi.hoisted(() => ({ enabled: true, correctNote: vi.fn(), noteResult: vi.fn() }));
vi.mock('@/hooks/useProductSettings', () => ({ useModuleEnabled: () => state.enabled }));
vi.mock('@/lib/ipc', () => ({ ipc: () => ({ agenda: state }) }));

const finding = (over: Partial<AgendaMinutesFinding>): AgendaMinutesFinding => ({
  id: 'f000000000001', kind: 'besluit', text: 'Rooster gaat in mei in.', owner: null, due: null, ai: { text: 'Rooster gaat in mei in.', owner: null, due: null },
  evidence: { segmentId: 's2', quote: 'We besluiten het rooster in mei', start: 75, end: 78, speaker: 'other' }, review: 'voorstel', reason: null, answer: null, ...over,
});
const minutes = (over: Partial<AgendaMinutes> = {}): AgendaMinutes => ({
  schemaVersion: 1, title: 'Werkoverleg Kastanje',
  items: [
    { id: 'p1', title: 'Opening', outcome: 'discussie', minutes: 5, owner: null, required: false, number: 1, status: 'afgerond', spentSec: 240, recognition: 'mens',
      startOffset: 0, overTime: false, missingOutcome: false, decisions: [], actions: [], questions: [] },
    { id: 'p2', title: 'Nieuwe roosters', outcome: 'besluit', minutes: 10, owner: 'Noor', required: true, number: 2, status: 'afgerond', spentSec: 750, recognition: 'agent_bevestigd',
      startOffset: 240, overTime: true, missingOutcome: false,
      decisions: [finding({})],
      actions: [finding({ id: 'f000000000002', kind: 'actie', text: 'Noor stuurt het rooster.', owner: 'Noor', due: 'vrijdag', ai: { text: 'Noor stuurt het rooster.', owner: 'Noor', due: 'vrijdag' },
        evidence: { segmentId: 's3', quote: 'Noor stuurt het rooster', start: 90, end: 93, speaker: 'self' }, review: 'bevestigd' })],
      questions: [] },
  ],
  other: { decisions: [], actions: [], questions: [finding({ id: 'f000000000003', kind: 'vraag', text: 'Wie boekt de zaal?', evidence: { segmentId: 's4', quote: 'boekt de zaal', start: 3700, end: 3702, speaker: 'unknown' } })] },
  counts: { decisions: 1, actions: 1, questions: 1, answered: 0, proposals: 2, confirmed: 1 }, totals: { plannedMinutes: 15, spentSec: 990 }, ownerMissing: ['f000000000001'],
  questionsReview: null, ...over,
});
const found = (over: Partial<AgendaNoteFound> = {}): AgendaNoteFound => ({ found: true, title: 'Werkoverleg Kastanje', minutes: minutes(), markdown: '# Notulen Werkoverleg Kastanje\n', finalRunning: false, ...over });
beforeEach(() => { state.enabled = true; state.correctNote.mockReset(); state.noteResult.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const renderTab = (result = found(), onChanged = vi.fn()) => ({ onChanged, ...render(<AgendaNoteTab noteFile="/n/kastanje_summary.md" result={result} onChanged={onChanged} />) });

describe('minutes per agenda item inside the note', () => {
  it('after stopping: answered questions are listed apart with their answer, and the check says what it read (0.11.0)', () => {
    const answered = finding({ id: 'f000000000004', kind: 'vraag', text: 'Wie maakt de notulen?',
      evidence: { segmentId: 's5', quote: 'Wie maakt de notulen', start: 100, end: 102, speaker: 'other' },
      answer: { segmentId: 's6', quote: 'Sanne maakt de notulen', start: 130, end: 133, speaker: 'self' } });
    const base = minutes();
    renderTab(found({ minutes: minutes({ other: { ...base.other, questions: [...base.other.questions, answered] },
      counts: { ...base.counts, answered: 1 },
      questionsReview: { status: 'done', checked: 2, answered: 1, tail: true, from: 1800, reason: null, at: 'x' } }) }));
    expect(screen.getByTestId('agenda-pills').textContent).toBe('1 besluiten1 acties1 open vragen1 beantwoord2 voorstellen');
    expect(screen.getByTestId('agenda-questions-review').textContent).toBe(
      'Na het stoppen zijn de open vragen nog eens nagegaan, alleen in het laatste deel van het gesprek (vanaf 30:00): het hele gesprek past niet in één controle. 1 van 2 beantwoord.');
    const row = document.querySelector('[data-finding="f000000000004"]') as HTMLElement;
    expect(within(row).getByText('Beantwoord')).toBeTruthy();
    expect(within(row).getByTestId('agenda-answer').textContent).toBe('Antwoord: “Sanne maakt de notulen” · 02:10 · Jij');
    expect(screen.getByRole('heading', { name: 'Beantwoorde vragen' })).toBeTruthy();
    cleanup();
    renderTab(found({ minutes: minutes({ questionsReview: { status: 'failed', checked: 1, answered: 0, tail: false, from: null, reason: 'timeout', at: 'x' } }) }));
    expect(screen.getByTestId('agenda-questions-review').textContent).toBe('Na het stoppen konden de open vragen niet opnieuw worden nagegaan.');
    expect(screen.queryByRole('heading', { name: 'Beantwoorde vragen' })).toBeNull();
  });

  it('pills, status and time per item, citations with time and speaker, proposals marked, Kopieer als markdown', async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
    renderTab();
    expect(screen.getByTestId('agenda-pills').textContent).toBe('1 besluiten1 acties1 open vragen2 voorstellen');
    const item = screen.getByRole('listitem', { name: '2. Nieuwe roosters' });
    expect(within(item).getByText('Besluit · 10 min · eigenaar Noor · vereist')).toBeTruthy();
    expect(within(item).getByText('Besteed 12:30 van 10:00')).toBeTruthy();
    expect(within(item).getByText('over tijd')).toBeTruthy();
    const decision = item.querySelector('[data-finding="f000000000001"]') as HTMLElement;
    expect(within(decision).getByText('Voorstel')).toBeTruthy();
    expect(within(decision).getByText('Eigenaar ontbreekt')).toBeTruthy();
    expect(within(decision).getByText('Eigenaar: niet genoemd · Termijn: niet genoemd')).toBeTruthy();
    expect(within(decision).getByText('01:15 · Anderen')).toBeTruthy();
    expect(within(decision).getByText(/We besluiten het rooster in mei/)).toBeTruthy();
    const action = item.querySelector('[data-finding="f000000000002"]') as HTMLElement;
    expect(within(action).getByText('Bevestigd')).toBeTruthy();
    expect(within(action).getByText('Eigenaar: Noor · Termijn: vrijdag')).toBeTruthy();
    expect(screen.getByText('1:01:40 · Onbekend')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Overig (geen agendapunt)' })).toBeTruthy();
    expect(within(screen.getByRole('listitem', { name: '1. Opening' })).getByText('Geen besluiten, acties of open vragen herkend.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Kopieer als markdown' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith('# Notulen Werkoverleg Kastanje\n'));
    expect(await screen.findByText('Notulen gekopieerd.')).toBeTruthy();
  });

  it('confirm, correct (text, owner, deadline) and reject with a reason go to the host; the answer replaces the view', async () => {
    const corrected = found({ minutes: minutes({ items: [minutes().items[0], { ...minutes().items[1],
      decisions: [finding({ text: 'Nieuw rooster vanaf 1 mei.', owner: 'Noor', due: '1 mei', review: 'gecorrigeerd' })] }] }) });
    state.correctNote.mockResolvedValue({ success: true, ...corrected });
    const { onChanged } = renderTab();
    const decision = () => document.querySelector('[data-finding="f000000000001"]') as HTMLElement;
    fireEvent.click(within(decision()).getByRole('button', { name: 'Corrigeer' }));
    fireEvent.change(within(decision()).getByRole('textbox', { name: 'Tekst' }), { target: { value: 'Nieuw rooster vanaf 1 mei.' } });
    fireEvent.change(within(decision()).getByRole('textbox', { name: 'Eigenaar' }), { target: { value: 'Noor' } });
    fireEvent.change(within(decision()).getByRole('textbox', { name: 'Termijn' }), { target: { value: '1 mei' } });
    fireEvent.click(within(decision()).getByRole('button', { name: 'Bewaar' }));
    await waitFor(() => expect(state.correctNote).toHaveBeenCalledWith({ noteFile: '/n/kastanje_summary.md', findingId: 'f000000000001', action: 'correct', text: 'Nieuw rooster vanaf 1 mei.', owner: 'Noor', due: '1 mei' }));
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ found: true }));
    cleanup();
    state.correctNote.mockReset().mockResolvedValue({ success: true, ...found() });
    renderTab();
    fireEvent.click(within(decision()).getByRole('button', { name: 'Bevestig' }));
    await waitFor(() => expect(state.correctNote).toHaveBeenLastCalledWith({ noteFile: '/n/kastanje_summary.md', findingId: 'f000000000001', action: 'confirm' }));
    fireEvent.click(within(decision()).getByRole('button', { name: 'Afwijzen' }));
    fireEvent.change(within(decision()).getByRole('textbox', { name: 'Reden (optioneel)' }), { target: { value: 'Nog geen besluit.' } });
    fireEvent.click(within(decision()).getByRole('button', { name: 'Afwijzen' }));
    await waitFor(() => expect(state.correctNote).toHaveBeenLastCalledWith({ noteFile: '/n/kastanje_summary.md', findingId: 'f000000000001', action: 'reject', reason: 'Nog geen besluit.' }));
    const action = document.querySelector('[data-finding="f000000000002"]') as HTMLElement;
    fireEvent.click(within(action).getByRole('button', { name: 'Ongedaan maken' }));
    await waitFor(() => expect(state.correctNote).toHaveBeenLastCalledWith({ noteFile: '/n/kastanje_summary.md', findingId: 'f000000000002', action: 'clear' }));
  });

  it('a correction shows what the AI proposed; a rejected finding is struck through with its reason; failures are reported', async () => {
    state.correctNote.mockResolvedValue({ success: false, error: 'x' });
    renderTab(found({ minutes: minutes({ items: [minutes().items[0], { ...minutes().items[1],
      decisions: [finding({ text: 'Nieuw rooster vanaf 1 mei.', review: 'gecorrigeerd' })],
      actions: [finding({ id: 'f000000000002', kind: 'actie', review: 'afgewezen', reason: 'Geen actie.' })] }] }) }));
    expect(screen.getByText('AI-voorstel: Rooster gaat in mei in.')).toBeTruthy();
    const rejected = document.querySelector('[data-finding="f000000000002"]') as HTMLElement;
    expect(rejected.getAttribute('data-review')).toBe('afgewezen');
    expect(within(rejected).getByText('Reden: Geen actie.')).toBeTruthy();
    fireEvent.click(within(rejected).getByRole('button', { name: 'Ongedaan maken' }));
    expect((await screen.findByRole('alert')).textContent).toBe('De correctie kon niet worden bewaard.');
  });

  it('useNoteAgenda: module off reads nothing; on, it shows the tab only when the note has minutes and polls while the last check runs', async () => {
    state.enabled = false;
    const off = renderHook(() => useNoteAgenda('/n/a.md'));
    await act(async () => { await Promise.resolve(); });
    expect(off.result.current.label).toBeNull();
    expect(state.noteResult).not.toHaveBeenCalled();
    off.unmount();
    state.enabled = true;
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    state.noteResult.mockResolvedValueOnce({ success: true, ...found({ finalRunning: true }) }).mockResolvedValue({ success: true, ...found() });
    const on = renderHook(() => useNoteAgenda('/n/a.md'));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(on.result.current.label).toBe('Notulen');
    expect(on.result.current.result?.finalRunning).toBe(true);
    await act(async () => { vi.advanceTimersByTime(2_500); await Promise.resolve(); await Promise.resolve(); });
    expect(on.result.current.result?.finalRunning).toBe(false);
    const calls = state.noteResult.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(state.noteResult.mock.calls.length).toBe(calls);
    state.noteResult.mockResolvedValue({ success: true, found: false });
    const none = renderHook(() => useNoteAgenda('/n/b.md'));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(none.result.current.label).toBeNull();
  });
});
