import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChecklistScoreBadge } from '../ChecklistScoreBadge';
import { resetNoteScores, refreshNoteScore } from '../noteScores';

const state = vi.hoisted(() => ({ enabled: true, noteScores: vi.fn() }));
vi.mock('@/hooks/useProductSettings', () => ({ useModuleEnabled: () => state.enabled }));
vi.mock('@/lib/ipc', () => ({ ipc: () => ({ checklists: state }) }));
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
beforeEach(() => {
  resetNoteScores(); state.enabled = true;
  state.noteScores.mockReset().mockImplementation(async ({ noteFiles }: { noteFiles: string[] }) => ({ success: true,
    scores: Object.fromEntries(noteFiles.filter((file) => file.includes('met')).map((file) => [file, { title: 'Adviseur Gesprek', covered: 7, total: 8 }])) }));
});
afterEach(cleanup);

describe('score badge on a recent note', () => {
  it('shows Checklist besproken/totaal for a note with a result and nothing for one without', async () => {
    render(<><ChecklistScoreBadge summaryFile="/n/met_summary.md" /><span data-testid="x"><ChecklistScoreBadge summaryFile="/n/zonder_summary.md" /></span></>);
    await settle();
    expect(screen.getByText('Checklist 7/8')).toBeTruthy();
    expect(screen.getByTestId('x').textContent).toBe('');
  });

  it('asks for all rows of one render in a single request', async () => {
    render(<>{['/n/met_1.md', '/n/met_2.md', '/n/zonder_3.md'].map((file) => <ChecklistScoreBadge key={file} summaryFile={file} />)}</>);
    await settle();
    expect(state.noteScores).toHaveBeenCalledTimes(1);
    expect(state.noteScores.mock.calls[0][0].noteFiles.sort()).toEqual(['/n/met_1.md', '/n/met_2.md', '/n/zonder_3.md']);
  });

  it('keeps a result in memory and does not ask again on remount', async () => {
    const view = render(<ChecklistScoreBadge summaryFile="/n/met_summary.md" />);
    await settle(); view.unmount();
    render(<ChecklistScoreBadge summaryFile="/n/met_summary.md" />);
    await settle();
    expect(state.noteScores).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Checklist 7/8')).toBeTruthy();
  });

  it('does not read anything while the module is off', async () => {
    state.enabled = false;
    const { container } = render(<ChecklistScoreBadge summaryFile="/n/met_summary.md" />);
    await settle();
    expect(state.noteScores).not.toHaveBeenCalled();
    expect(container.textContent).toBe('');
  });

  it('shows no badge when the host cannot read the result', async () => {
    state.noteScores.mockResolvedValue({ success: false, error: 'x' });
    const { container } = render(<ChecklistScoreBadge summaryFile="/n/met_summary.md" />);
    await settle();
    expect(container.textContent).toBe('');
  });

  it('updates after a correction on the note refreshes the score', async () => {
    render(<ChecklistScoreBadge summaryFile="/n/met_summary.md" />);
    await settle();
    state.noteScores.mockResolvedValue({ success: true, scores: { '/n/met_summary.md': { title: 'Adviseur Gesprek', covered: 6, total: 8 } } });
    refreshNoteScore('/n/met_summary.md');
    await settle();
    expect(screen.getByText('Checklist 6/8')).toBeTruthy();
  });
});
