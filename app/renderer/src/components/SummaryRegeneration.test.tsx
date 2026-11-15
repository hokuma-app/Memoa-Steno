import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SummaryRegeneration } from './SummaryRegeneration';
const settings = vi.hoisted(() => ({ getSettings: vi.fn().mockResolvedValue({ success: true, summary_detail: 'detailed' }), setSettings: vi.fn() }));
vi.mock('@/lib/ipc', () => ({ ipc: () => ({ summaryFolding: settings }) }));
afterEach(cleanup);
it('offers regeneration with length and template before starting and never changes global preference', async () => {
  const generate = vi.fn();
  render(<SummaryRegeneration templates={[{ id: 'standard', name: 'Standaard' }, { id: 'eigen', name: 'Eigen sjabloon' }]} onGenerate={generate} />);
  fireEvent.click(screen.getByRole('button', { name: 'Opnieuw samenvatten' }));
  await waitFor(() => expect(settings.getSettings).toHaveBeenCalled());
  fireEvent.change(screen.getByRole('combobox', { name: 'Lengte voor deze versie' }), { target: { value: 'brief' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Samenvattingssjabloon' }), { target: { value: 'eigen' } });
  expect(generate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Maak nieuwe versie' }));
  expect(generate).toHaveBeenCalledExactlyOnceWith('brief', 'eigen');
  expect(settings.setSettings).not.toHaveBeenCalled();
});
