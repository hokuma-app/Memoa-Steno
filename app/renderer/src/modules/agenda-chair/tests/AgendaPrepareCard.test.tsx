import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgendaPrepareCard } from '../AgendaPrepareCard';
import type { Agenda } from '../contracts';

const state = vi.hoisted(() => ({ enabled: true, parse: vi.fn(), getPreparation: vi.fn(), prepare: vi.fn(), clearPreparation: vi.fn() }));
vi.mock('@/hooks/useProductSettings', () => ({ useModuleEnabled: () => state.enabled }));
vi.mock('@/lib/ipc', () => ({ ipc: () => ({ agenda: state }) }));

const agenda = (over: Partial<Agenda> = {}): Agenda => ({
  schemaVersion: 1, agendaId: 'a-1', title: 'Werkoverleg Kastanje', source: { kind: 'text', name: null, text: '1. Opening' }, version: 1, createdAt: '2026-11-15T10:00:00Z',
  items: [
    { id: 'p1', title: 'Opening', outcome: 'discussie', minutes: 5, owner: null, required: false },
    { id: 'p2', title: 'Nieuwe roosters', outcome: 'besluit', minutes: 15, owner: 'Noor', required: true },
  ], ...over,
});
beforeEach(() => {
  state.enabled = true;
  state.getPreparation.mockReset().mockResolvedValue({ success: true, preparation: null });
  state.parse.mockReset().mockResolvedValue({ success: true, agenda: agenda(), dropped: 0, merged: 0 });
  state.prepare.mockReset().mockImplementation(async ({ agenda: value }: { agenda: Agenda }) => ({ success: true, preparation: value }));
  state.clearPreparation.mockReset().mockResolvedValue({ success: true });
});
afterEach(cleanup);
const card = () => screen.getByTestId('agenda-prepare');

describe('agenda for the next recording (Home)', () => {
  it('module off: renders nothing and reads nothing', async () => {
    state.enabled = false;
    const { container } = render(<AgendaPrepareCard />);
    await Promise.resolve();
    expect(container.textContent).toBe('');
    expect(state.getPreparation).not.toHaveBeenCalled();
  });

  it('paste, read (host parses, no model), edit title, outcome, minutes, owner and required, then prepare', async () => {
    render(<AgendaPrepareCard />);
    expect(await within(card()).findByText('Geen agenda klaargezet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Agenda inladen' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Plak de agenda (één punt per regel)' }), { target: { value: '1. Opening (5 min)\n2. Nieuwe roosters' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agenda lezen' }));
    await waitFor(() => expect(state.parse).toHaveBeenCalledWith({ text: '1. Opening (5 min)\n2. Nieuwe roosters', sourceName: null }));
    expect(await screen.findAllByTestId('agenda-edit-row')).toHaveLength(2);
    fireEvent.change(screen.getByRole('textbox', { name: 'Titel van punt 1' }), { target: { value: 'Opening en mededelingen' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Uitkomst van punt 1' }), { target: { value: 'informatie' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Minuten voor punt 1' }), { target: { value: '10' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Eigenaar van punt 1' }), { target: { value: 'Sanne' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Punt 1 is vereist' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Punt toevoegen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Verwijder punt 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Klaarzetten voor de volgende opname' }));
    await waitFor(() => expect(state.prepare).toHaveBeenCalledTimes(1));
    expect(state.prepare.mock.calls[0][0].agenda.items[0]).toEqual({ id: 'p1', title: 'Opening en mededelingen', outcome: 'informatie', minutes: 10, owner: 'Sanne', required: true });
    expect(state.prepare.mock.calls[0][0].agenda.items).toHaveLength(2);
    expect(await within(card()).findByText('Staat klaar · 2 punten · AI volgt stil mee')).toBeTruthy();
  });

  it('a chosen .md file is read as text and sent with its name; the host refusal is shown in Dutch', async () => {
    state.parse.mockResolvedValueOnce({ success: false, error: 'Er zijn geen agendapunten gevonden.', code: 'empty' });
    render(<AgendaPrepareCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Agenda inladen' }));
    const file = new File(['# Overleg\n1. Opening'], 'overleg.md', { type: 'text/markdown' });
    fireEvent.change(screen.getByTestId('agenda-file'), { target: { files: [file] } });
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Plak de agenda (één punt per regel)' }) as HTMLTextAreaElement).value).toBe('# Overleg\n1. Opening'));
    fireEvent.click(screen.getByRole('button', { name: 'Agenda lezen' }));
    await waitFor(() => expect(state.parse).toHaveBeenCalledWith({ text: '# Overleg\n1. Opening', sourceName: 'overleg.md' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Er zijn geen agendapunten gevonden.');
  });

  it('a file over the bound is refused before anything is sent', async () => {
    render(<AgendaPrepareCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Agenda inladen' }));
    const file = new File(['x'.repeat(24_001)], 'lang.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByTestId('agenda-file'), { target: { files: [file] } });
    expect((await screen.findByRole('alert')).textContent).toBe('Dit bestand is te groot. Een agenda is maximaal 24.000 tekens.');
    expect(state.parse).not.toHaveBeenCalled();
  });

  it('two items with the same title block saving; an empty title is refused', async () => {
    render(<AgendaPrepareCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Agenda inladen' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Plak de agenda (één punt per regel)' }), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agenda lezen' }));
    await screen.findAllByTestId('agenda-edit-row');
    fireEvent.change(screen.getByRole('textbox', { name: 'Titel van punt 2' }), { target: { value: ' opening ' } });
    expect(screen.getByRole('alert').textContent).toBe('Twee punten hebben dezelfde titel. Pas er een aan of verwijder er een.');
    expect((screen.getByRole('button', { name: 'Klaarzetten voor de volgende opname' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Titel van punt 2' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Klaarzetten voor de volgende opname' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Elk punt heeft een titel nodig.');
    expect(state.prepare).not.toHaveBeenCalled();
  });

  it('a prepared agenda can be edited or cleared', async () => {
    state.getPreparation.mockResolvedValue({ success: true, preparation: agenda() });
    render(<AgendaPrepareCard />);
    expect(await screen.findByText('Werkoverleg Kastanje')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bewerken' }));
    expect((screen.getByRole('textbox', { name: 'Eigenaar van punt 2' }) as HTMLInputElement).value).toBe('Noor');
    fireEvent.click(screen.getByRole('button', { name: 'Annuleer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Geen agenda' }));
    expect(await screen.findByText('Geen agenda klaargezet.')).toBeTruthy();
    expect(state.clearPreparation).toHaveBeenCalledTimes(1);
  });
});
