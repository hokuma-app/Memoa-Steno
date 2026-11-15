import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChecklistChoiceCard } from '../ChecklistChoiceCard';

const state = vi.hoisted(() => ({ enabled: true, listTemplates: vi.fn(), prepare: vi.fn(), clearPreparation: vi.fn(), saveNamedTemplate: vi.fn(), deleteNamedTemplate: vi.fn() }));
vi.mock('@/hooks/useProductSettings', () => ({ useModuleEnabled: () => state.enabled }));
vi.mock('@/lib/ipc', () => ({ ipc: () => ({ checklists: state }) }));
const own = { id: 'eigen-1', name: 'Eigen leidraad', criteria: [{ id: 'p1', label: 'Eerste punt', required: true }, { id: 'p2', label: 'Tweede punt', required: true }] };
const standard = (over = {}) => ({ id: 'veneta-adviseur-gesprek', name: 'Adviseur Gesprek', version: 1, locked: true as const, criteriaCount: 8, available: true, ...over });
const listing = (over = {}) => ({ success: true, templates: [own], standards: [standard()], preparation: null, ...over });
beforeEach(() => {
  state.enabled = true;
  state.listTemplates.mockReset().mockResolvedValue(listing());
  state.prepare.mockReset().mockResolvedValue({ success: true });
  state.clearPreparation.mockReset().mockResolvedValue({ success: true });
  state.saveNamedTemplate.mockReset().mockImplementation(async (request: { id?: string; name: string; criteria: unknown[] }) => ({ success: true, template: { id: request.id ?? 'nieuw-1', name: request.name, criteria: request.criteria } }));
  state.deleteNamedTemplate.mockReset().mockResolvedValue({ success: true });
});
afterEach(cleanup);
const open = async () => {
  const button = await screen.findByRole('combobox', { name: /Gesprekschecklist voor de volgende opname/ });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  return screen.getByRole('listbox');
};

describe('one card to choose the checklist of the next recording', () => {
  it('lists the locked Veneta standard, own checklists and Geen checklist with their meta line', async () => {
    render(<ChecklistChoiceCard />);
    const list = await open();
    const options = within(list).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Adviseur GesprekVeneta-standaard · vast · 8 punten', 'Eigen leidraadEigen checklist · 2 punten', 'Geen checklist']);
    expect(screen.queryByText('Gesprekschecklist voorbereiden')).toBeNull();
    expect(screen.queryByText('Overzicht van eerdere gesprekken')).toBeNull();
  });

  it('shows the standard without content as not selectable, saying that the content follows from Veneta', async () => {
    state.listTemplates.mockResolvedValue(listing({ standards: [standard({ criteriaCount: 0, available: false })] }));
    render(<ChecklistChoiceCard />);
    const list = await open();
    const option = within(list).getByRole('option', { name: /Adviseur Gesprek/ });
    expect(option.getAttribute('aria-disabled')).toBe('true');
    expect(option.textContent).toContain('Inhoud volgt van Veneta');
    fireEvent.click(option);
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.clearPreparation).not.toHaveBeenCalled();
  });

  it('prepares the chosen checklist, says it stands ready and remembers it after a restart', async () => {
    const view = render(<ChecklistChoiceCard />);
    fireEvent.click(within(await open()).getByRole('option', { name: /Adviseur Gesprek/ }));
    await waitFor(() => expect(state.prepare).toHaveBeenCalledWith({ templateId: 'veneta-adviseur-gesprek' }));
    expect(await screen.findByText('Staat klaar · AI controleert automatisch mee')).toBeTruthy();
    view.unmount();
    state.listTemplates.mockResolvedValue(listing({ preparation: { templateId: 'veneta-adviseur-gesprek', name: 'Adviseur Gesprek', locked: true, criteria: [] } }));
    render(<ChecklistChoiceCard />);
    expect((await screen.findByRole('combobox')).textContent).toContain('Adviseur Gesprek');
    expect(screen.getByText('Staat klaar · AI controleert automatisch mee')).toBeTruthy();
  });

  it('clears the preparation on Geen checklist', async () => {
    state.listTemplates.mockResolvedValue(listing({ preparation: { templateId: 'eigen-1', name: 'Eigen leidraad', locked: false, criteria: own.criteria } }));
    render(<ChecklistChoiceCard />);
    fireEvent.click(within(await open()).getByRole('option', { name: 'Geen checklist' }));
    await waitFor(() => expect(state.clearPreparation).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Staat klaar · AI controleert automatisch mee')).toBeNull());
    expect(screen.getByRole('combobox').textContent).toContain('Geen checklist');
  });

  it('offers no edit or delete for the standard and says it is fixed', async () => {
    state.listTemplates.mockResolvedValue(listing({ preparation: { templateId: 'veneta-adviseur-gesprek', name: 'Adviseur Gesprek', locked: true, criteria: [] } }));
    render(<ChecklistChoiceCard />);
    expect(await screen.findByText('Vaste Veneta-checklist: niet te bewerken of te verwijderen.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Bewerken' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Verwijderen' })).toBeNull();
  });

  it('creates an own checklist from lines, then stands it ready', async () => {
    render(<ChecklistChoiceCard />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Eigen checklist maken' }));
    const save = screen.getByRole('button', { name: 'Bewaar checklist' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Naam van je checklist' }), { target: { value: 'Mijn lijst' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Checklistpunten (één per regel)' }), { target: { value: 'Punt A\n\n Punt B ' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(state.saveNamedTemplate).toHaveBeenCalledTimes(1));
    const request = state.saveNamedTemplate.mock.calls[0][0];
    expect(request.name).toBe('Mijn lijst');
    expect(request.criteria.map((c: { label: string }) => c.label)).toEqual(['Punt A', 'Punt B']);
    await waitFor(() => expect(state.prepare).toHaveBeenCalledWith({ templateId: 'nieuw-1' }));
    expect(await screen.findByText('Staat klaar · AI controleert automatisch mee')).toBeTruthy();
  });

  it('blocks a name that equals the standard or another own checklist before asking the host', async () => {
    render(<ChecklistChoiceCard />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Eigen checklist maken' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Checklistpunten (één per regel)' }), { target: { value: 'Punt' } });
    for (const name of ['adviseur  GESPREK', 'Eigen leidraad']) {
      fireEvent.change(screen.getByRole('textbox', { name: 'Naam van je checklist' }), { target: { value: name } });
      expect(screen.getByText('Deze naam is al in gebruik. Kies een andere naam.')).toBeTruthy();
      expect((screen.getByRole('button', { name: 'Bewaar checklist' }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(state.saveNamedTemplate).not.toHaveBeenCalled();
  });

  it('shows the host refusal of a name without leaving the editor', async () => {
    state.saveNamedTemplate.mockResolvedValue({ success: false, error: 'x', code: 'name_taken' });
    render(<ChecklistChoiceCard />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Eigen checklist maken' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Naam van je checklist' }), { target: { value: 'Nieuwe naam' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Checklistpunten (één per regel)' }), { target: { value: 'Punt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bewaar checklist' }));
    expect(await screen.findByText('Deze naam is al in gebruik. Kies een andere naam.')).toBeTruthy();
    expect(state.prepare).not.toHaveBeenCalled();
  });

  it('edits an own checklist keeping the identity of unchanged points', async () => {
    state.listTemplates.mockResolvedValue(listing({ preparation: { templateId: 'eigen-1', name: 'Eigen leidraad', locked: false, criteria: own.criteria } }));
    render(<ChecklistChoiceCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Bewerken' }));
    expect((screen.getByRole('textbox', { name: 'Naam van je checklist' }) as HTMLInputElement).value).toBe('Eigen leidraad');
    fireEvent.change(screen.getByRole('textbox', { name: 'Checklistpunten (één per regel)' }), { target: { value: 'Eerste punt\nNieuw punt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bewaar checklist' }));
    await waitFor(() => expect(state.saveNamedTemplate).toHaveBeenCalledTimes(1));
    const request = state.saveNamedTemplate.mock.calls[0][0];
    expect(request.id).toBe('eigen-1');
    expect(request.criteria[0]).toEqual({ id: 'p1', label: 'Eerste punt', required: true });
    expect(request.criteria[1].id).not.toBe('p2');
    await waitFor(() => expect(state.prepare).toHaveBeenCalledWith({ templateId: 'eigen-1' }));
  });

  it('deletes an own checklist only after confirmation and falls back to Geen checklist', async () => {
    state.listTemplates.mockResolvedValue(listing({ preparation: { templateId: 'eigen-1', name: 'Eigen leidraad', locked: false, criteria: own.criteria } }));
    render(<ChecklistChoiceCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verwijderen' }));
    expect(state.deleteNamedTemplate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ja, verwijderen' }));
    await waitFor(() => expect(state.deleteNamedTemplate).toHaveBeenCalledWith({ id: 'eigen-1' }));
    await waitFor(() => expect(screen.getByRole('combobox').textContent).toContain('Geen checklist'));
    expect(screen.queryByText('Staat klaar · AI controleert automatisch mee')).toBeNull();
  });

  it('renders nothing and reads nothing while the module is off', () => {
    state.enabled = false;
    const { container } = render(<ChecklistChoiceCard />);
    expect(container.textContent).toBe('');
    expect(state.listTemplates).not.toHaveBeenCalled();
  });

  it('reports a failed read without content and offers no choices', async () => {
    state.listTemplates.mockResolvedValue({ success: false, error: 'x' });
    render(<ChecklistChoiceCard />);
    expect((await screen.findByRole('alert')).textContent).toContain('De checklist kon niet worden geladen of opgeslagen');
  });

  it('supports the keyboard: arrows move, Enter chooses, Escape closes', async () => {
    render(<ChecklistChoiceCard />);
    const button = await screen.findByRole('combobox');
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    // Opening lands on the current choice (Geen checklist); one step up is the own checklist.
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    fireEvent.keyDown(button, { key: 'ArrowUp' });
    fireEvent.keyDown(button, { key: 'Enter' });
    await waitFor(() => expect(state.prepare).toHaveBeenCalledWith({ templateId: 'eigen-1' }));
  });
  it('merges the same point typed more than once, says so, and sends each point once', async () => {
    render(<ChecklistChoiceCard />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Eigen checklist maken' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Naam van je checklist' }), { target: { value: 'Drie keer punt 1' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Checklistpunten (één per regel)' }), { target: { value: 'punt 1\nPunt   1\n PUNT 1 \npunt 2\npunt 3\npunt 4' } });
    expect(screen.getByTestId('checklist-duplicates').textContent).toBe('2 dubbele punten worden samengevoegd.');
    fireEvent.click(screen.getByRole('button', { name: 'Bewaar checklist' }));
    await waitFor(() => expect(state.saveNamedTemplate).toHaveBeenCalledTimes(1));
    expect(state.saveNamedTemplate.mock.calls[0][0].criteria.map((item: { label: string }) => item.label)).toEqual(['punt 1', 'punt 2', 'punt 3', 'punt 4']);
  });

  it('says "1 dubbel punt" in the singular and nothing when every point is different', async () => {
    render(<ChecklistChoiceCard />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Eigen checklist maken' }));
    const points = screen.getByRole('textbox', { name: 'Checklistpunten (één per regel)' });
    fireEvent.change(points, { target: { value: 'a\nb' } });
    expect(screen.queryByTestId('checklist-duplicates')).toBeNull();
    fireEvent.change(points, { target: { value: 'a\nA' } });
    expect(screen.getByTestId('checklist-duplicates').textContent).toBe('1 dubbel punt wordt samengevoegd.');
  });
});
