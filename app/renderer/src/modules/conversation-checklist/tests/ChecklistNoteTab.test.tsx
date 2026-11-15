import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChecklistNoteTab } from '../ChecklistNoteTab';
import type { ChecklistOverview, ChecklistOverviewRow } from '../contracts';

const state = vi.hoisted(() => ({ correctNote: vi.fn() }));
vi.mock('@/lib/ipc', () => ({ ipc: () => ({ checklists: state }) }));
const row = (over: Partial<ChecklistOverviewRow>): ChecklistOverviewRow => ({
  criterionId: 'c', label: 'Punt', required: true, effective: 'unmentioned', aiStatus: 'unmentioned', correction: null, rejected: null,
  ignoredManual: null, level: 'notHeard', kind: 'none', customerConfirmed: false, explanation: '', evidence: [], customerEvidence: [], ...over,
});
const rows: ChecklistOverviewRow[] = [
  row({ criterionId: 'a', label: 'Behoefte uitgevraagd', effective: 'covered', aiStatus: 'covered', level: 'explainedConfirmed', kind: 'explained', customerConfirmed: true,
    evidence: [{ segmentId: 's1', quote: 'Wat is voor u het belangrijkste', speaker: 'seller', start: 192, end: 196 }],
    customerEvidence: [{ segmentId: 's2', quote: 'Dat is helder', speaker: 'other', start: 715, end: 717 }] }),
  row({ criterionId: 'b', label: 'Werkwijze uitgelegd', effective: 'covered', aiStatus: 'covered', level: 'explained', kind: 'explained',
    evidence: [{ segmentId: 's3', quote: 'We starten altijd met een opname', speaker: 'seller', start: 340, end: 345 }] }),
  row({ criterionId: 'c', label: 'USP onderhoudsvrij', effective: 'partial', aiStatus: 'partial', level: 'mentioned', kind: 'mentioned',
    evidence: [{ segmentId: 's4', quote: 'en onderhoudsvrij', speaker: 'seller', start: 441, end: 443 }] }),
  row({ criterionId: 'd', label: 'Klant bevestigd akkoord', explanation: 'Geen uitspraak gevonden.' }),
  row({ criterionId: 'e', label: 'Garantie toegelicht', effective: 'notApplicable', aiStatus: 'unmentioned', level: null,
    correction: { status: 'notApplicable', reason: 'Klant heeft al garantie.' } }),
];
const overview = (over: Partial<ChecklistOverview> = {}): ChecklistOverview => ({ schemaVersion: 1, revision: 'r', evaluatedAt: '2026-10-29T12:00:00Z', checklistVersion: 'abc',
  counts: { covered: 2, partial: 1, unmentioned: 1, uncertain: 0, notApplicable: 1, pending: 0 }, score: { covered: 2, total: 4 }, rows, ...over });
const found = (over: Partial<ChecklistOverview> = {}) => ({ found: true as const, title: 'Adviseur Gesprek', overview: overview(over), markdown: '# Checklist Adviseur Gesprek' });
beforeEach(() => { state.correctNote.mockReset(); });
afterEach(cleanup);
const renderTab = (result = found(), onChanged = vi.fn()) => ({ onChanged, ...render(<ChecklistNoteTab noteFile="/n/a_summary.md" result={result} onChanged={onChanged} />) });
const rowOf = (label: string) => screen.getByText(label).closest('li') as HTMLElement;

describe('result tab inside the note', () => {
  it('shows summary pills (besproken, deels, gemist) and a Kopieer button that copies the markdown', async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
    renderTab();
    const pills = screen.getByTestId('checklist-pills');
    expect(pills.textContent).toBe('2 besproken1 deels1 gemist1 niet van toepassing');
    fireEvent.click(screen.getByRole('button', { name: 'Kopieer' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith('# Checklist Adviseur Gesprek'));
    expect(await screen.findByText('Gekopieerd')).toBeTruthy();
  });

  it('says when copying fails', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('x')) } });
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Kopieer' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Kopiëren is niet gelukt');
  });

  it('names the level per point and quotes with time and speaker', () => {
    renderTab();
    expect(within(rowOf('Behoefte uitgevraagd')).getByText('uitgelegd + klant bevestigd')).toBeTruthy();
    expect(rowOf('Behoefte uitgevraagd').textContent).toContain('03:12');
    expect(rowOf('Behoefte uitgevraagd').textContent).toContain('Jij');
    expect(rowOf('Behoefte uitgevraagd').textContent).toContain('Wat is voor u het belangrijkste');
    expect(rowOf('Behoefte uitgevraagd').textContent).toContain('11:55 · Klant');
    expect(within(rowOf('Werkwijze uitgelegd')).getByText('uitgelegd')).toBeTruthy();
    expect(within(rowOf('USP onderhoudsvrij')).getByText('genoemd')).toBeTruthy();
    expect(within(rowOf('Klant bevestigd akkoord')).getByText('niet gehoord')).toBeTruthy();
    expect(rowOf('Klant bevestigd akkoord').textContent).toContain('Geen uitspraak gevonden.');
    expect(within(rowOf('Garantie toegelicht')).getByText('niet van toepassing')).toBeTruthy();
    expect(rowOf('Garantie toegelicht').textContent).toContain('Klant heeft al garantie.');
  });

  it('labels a rejected or partially unusable model judgment as unassessable, not as not heard', () => {
    renderTab(found({ rows: rows.map((item) => item.criterionId === 'd' ? {
      ...item, effective: 'uncertain', aiStatus: 'uncertain', level: 'notHeard', kind: 'none',
      explanation: 'Model kon dit criterium niet beoordelen: citaat is afgewezen.',
    } : item), counts: { covered: 2, partial: 1, unmentioned: 0, uncertain: 1, notApplicable: 1, pending: 0 } }));
    const item = rowOf('Klant bevestigd akkoord');
    expect(within(item).getByText('model kon niet beoordelen')).toBeTruthy();
    expect(item.textContent).toContain('citaat is afgewezen');
    expect(item.textContent).not.toContain('niet gehoord');
  });

  it('has no way to tick, mark discussed or edit anything by hand', () => {
    renderTab();
    for (const role of ['checkbox', 'combobox', 'switch', 'radio']) expect(screen.queryAllByRole(role), role).toEqual([]);
    expect(screen.queryByRole('button', { name: /afvinken|besproken maken/i })).toBeNull();
  });

  it('offers Onterecht? Afwijzen only on an AI tick, and needs a short reason', async () => {
    const next = found({ rows: rows.map((r) => r.criterionId === 'a' ? { ...r, effective: 'unmentioned', level: 'notHeard', rejected: { reason: 'Niet over de behoefte.' },
      correction: { status: 'unmentioned', reason: 'Niet over de behoefte.', rejected: true } } : r), score: { covered: 1, total: 4 }, counts: { covered: 1, partial: 1, unmentioned: 2, uncertain: 0, notApplicable: 1, pending: 0 } });
    state.correctNote.mockResolvedValue({ success: true, ...next });
    const { onChanged } = renderTab();
    expect(within(rowOf('Klant bevestigd akkoord')).queryByRole('button', { name: 'Onterecht? Afwijzen' })).toBeNull();
    fireEvent.click(within(rowOf('Behoefte uitgevraagd')).getByRole('button', { name: 'Onterecht? Afwijzen' }));
    const confirm = screen.getByRole('button', { name: 'Afwijzen' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Korte reden (verplicht)' }), { target: { value: '  Niet over de behoefte.  ' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(state.correctNote).toHaveBeenCalledWith({ noteFile: '/n/a_summary.md', criterionId: 'a', action: 'reject', reason: 'Niet over de behoefte.' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ overview: expect.objectContaining({ score: { covered: 1, total: 4 } }) })));
  });

  it('shows a rejected tick as rejected by a human, keeps the AI evidence traceable and can undo it', async () => {
    const rejected = found({ rows: rows.map((r) => r.criterionId === 'a' ? { ...r, effective: 'unmentioned', level: 'notHeard', rejected: { reason: 'Niet over de behoefte.' },
      correction: { status: 'unmentioned', reason: 'Niet over de behoefte.', rejected: true } } : r) });
    state.correctNote.mockResolvedValue({ success: true, ...found() });
    renderTab(rejected);
    const item = rowOf('Behoefte uitgevraagd');
    expect(within(item).getByText('niet gehoord')).toBeTruthy();
    expect(item.textContent).toContain('Afgewezen door mens: Niet over de behoefte.');
    expect(item.textContent).toContain('AI had dit als uitgelegd gemarkeerd');
    expect(item.textContent).toContain('Wat is voor u het belangrijkste');
    expect(within(item).queryByRole('button', { name: 'Onterecht? Afwijzen' })).toBeNull();
    fireEvent.click(within(item).getByRole('button', { name: 'Afwijzing ongedaan maken' }));
    await waitFor(() => expect(state.correctNote).toHaveBeenCalledWith({ noteFile: '/n/a_summary.md', criterionId: 'a', action: 'clear' }));
  });

  it('keeps Niet van toepassing as a human choice with a reason, only here', async () => {
    state.correctNote.mockResolvedValue({ success: true, ...found() });
    renderTab();
    fireEvent.click(within(rowOf('Klant bevestigd akkoord')).getByRole('button', { name: 'Niet van toepassing' }));
    const confirm = screen.getByRole('button', { name: 'Bewaar' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Korte reden (verplicht)' }), { target: { value: 'Er was geen klant aanwezig.' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(state.correctNote).toHaveBeenCalledWith({ noteFile: '/n/a_summary.md', criterionId: 'd', action: 'notApplicable', reason: 'Er was geen klant aanwezig.' }));
  });

  it('keeps the view and says so when the host refuses a correction', async () => {
    state.correctNote.mockResolvedValue({ success: false, error: 'x' });
    const { onChanged } = renderTab();
    fireEvent.click(within(rowOf('Behoefte uitgevraagd')).getByRole('button', { name: 'Onterecht? Afwijzen' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Korte reden (verplicht)' }), { target: { value: 'Reden' } });
    fireEvent.click(screen.getByRole('button', { name: 'Afwijzen' }));
    expect((await screen.findByRole('alert')).textContent).toContain('De correctie kon niet worden bewaard');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('shows an ignored 0.9.2 manual mark as ignored, never as discussed', () => {
    renderTab(found({ rows: [row({ criterionId: 'x', label: 'Oud punt', ignoredManual: 'covered' })] }));
    expect(rowOf('Oud punt').textContent).toContain('Handmatige markering genegeerd');
    expect(within(rowOf('Oud punt')).getByText('niet gehoord')).toBeTruthy();
  });
  it('says that the last check of the conversation is still running, and nothing once it is done', () => {
    const { rerender } = renderTab({ ...found(), finalRunning: true } as never);
    expect(screen.getByTestId('checklist-final-running').textContent).toContain('laatste controle');
    rerender(<ChecklistNoteTab noteFile="/n/a_summary.md" result={{ ...found(), finalRunning: false } as never} onChanged={vi.fn()} />);
    expect(screen.queryByTestId('checklist-final-running')).toBeNull();
  });
});
