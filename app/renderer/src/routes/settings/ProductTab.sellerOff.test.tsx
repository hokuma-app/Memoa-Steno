import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProductTab } from './ProductTab';

const checklists = vi.hoisted(() => ({ getSettings: vi.fn() }));
vi.mock('@/lib/ipc', () => ({ ipc: () => ({ checklists, productSettings: {
  get: async () => ({ success: true, settings: { schemaVersion: 1, profile: 'veneta', modules: { 'conversation-checklist': false } } }),
  set: async () => ({ success: false, error: 'x' }),
} }) }));
afterEach(cleanup);

it('shows no seller channel setting and reads nothing while the checklist module is off', async () => {
  render(<ProductTab />);
  await waitFor(() => expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(false));
  expect(screen.queryByRole('switch', { name: 'Mijn microfoon is de verkoper' })).toBeNull();
  expect(checklists.getSettings).not.toHaveBeenCalled();
});
