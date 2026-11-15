import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ProductSettings, ProductSettingsGateway } from '@/lib/productContracts';
import { ProductTab } from './ProductTab';

const fake = vi.hoisted(() => ({ gateway: undefined as ProductSettingsGateway | undefined }));
vi.mock('@/lib/ipc', () => ({ ipc: () => ({ productSettings: fake.gateway }) }));
afterEach(cleanup);

it('Agenda en voorzitter is a separate module switch: off by default (absent key), only in Veneta, independent of the checklist', async () => {
  // A settings file from before this module: no agenda key at all.
  let persisted: ProductSettings = { schemaVersion: 1, profile: 'veneta', modules: { 'conversation-checklist': true } };
  const patches: unknown[] = [];
  fake.gateway = {
    get: async () => ({ success: true, settings: structuredClone(persisted) }),
    set: async (patch) => {
      patches.push(patch);
      persisted = { ...persisted, ...patch, modules: { ...persisted.modules, ...patch.modules } };
      return { success: true, settings: structuredClone(persisted) };
    },
  };
  render(<ProductTab />);
  const agenda = screen.getByRole('switch', { name: 'Agenda en voorzitter' }) as HTMLButtonElement;
  await waitFor(() => expect(agenda.disabled).toBe(false));
  expect(agenda.getAttribute('aria-checked')).toBe('false');
  expect(screen.getByText(/Standaard uit\. Laad een agenda/)).toBeTruthy();
  fireEvent.click(agenda);
  await waitFor(() => expect(agenda.getAttribute('aria-checked')).toBe('true'));
  expect(patches).toEqual([{ modules: { 'agenda-chair': true } }]);
  expect(persisted.modules).toEqual({ 'conversation-checklist': true, 'agenda-chair': true });
  fireEvent.change(screen.getByRole('combobox', { name: 'Productprofiel' }), { target: { value: 'default' } });
  await waitFor(() => expect(agenda.getAttribute('aria-checked')).toBe('false'));
  expect(agenda.disabled).toBe(true);
});
