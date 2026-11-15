import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ProductSettings, ProductSettingsGateway } from '@/lib/productContracts';
import { ProductTab } from './ProductTab';

const fake = vi.hoisted(() => ({ gateway: undefined as ProductSettingsGateway | undefined }));
vi.mock('@/lib/ipc', () => ({ ipc: () => ({ productSettings: fake.gateway }) }));
afterEach(cleanup);
it('has real profile and module controls, preserves configuration, and allows disabling while busy', async () => {
  let persisted: ProductSettings = {
    schemaVersion: 1,
    profile: 'veneta',
    modules: { 'conversation-checklist': false },
  };
  let hydrate!: () => void;
  fake.gateway = {
    get: () =>
      new Promise((resolve) => {
        hydrate = () => resolve({ success: true, settings: structuredClone(persisted) });
      }),
    set: async (patch) => {
      persisted = { ...persisted, ...patch, modules: { ...persisted.modules, ...patch.modules } };
      return { success: true, settings: structuredClone(persisted) };
    },
  };
  const view = render(<ProductTab />);
  const profile = screen.getByRole('combobox', { name: 'Productprofiel' }) as HTMLSelectElement;
  const moduleSwitch = screen.getByRole('switch', {
    name: 'Gesprekschecklist',
  }) as HTMLButtonElement;
  expect(profile.disabled).toBe(true);
  expect(moduleSwitch.disabled).toBe(true);
  await waitFor(() => expect(hydrate).toBeDefined());
  await act(async () => hydrate());
  fireEvent.click(moduleSwitch);
  await waitFor(() => expect(moduleSwitch.getAttribute('aria-checked')).toBe('true'));
  view.rerender(<ProductTab busy />);
  expect(profile.disabled).toBe(true);
  expect(moduleSwitch.disabled).toBe(false);
  fireEvent.click(moduleSwitch);
  await waitFor(() => expect(persisted.modules['conversation-checklist']).toBe(false));
  expect(moduleSwitch.disabled).toBe(true);
  view.rerender(<ProductTab />);
  fireEvent.click(moduleSwitch);
  await waitFor(() => expect(persisted.modules['conversation-checklist']).toBe(true));
  fireEvent.change(profile, { target: { value: 'default' } });
  await waitFor(() => expect(profile.value).toBe('default'));
  expect(moduleSwitch.getAttribute('aria-checked')).toBe('false');
  expect(moduleSwitch.disabled).toBe(true);
  expect(persisted.modules['conversation-checklist']).toBe(true);
  expect(screen.getByText(/geen toestemming.*cloud/i)).toBeTruthy();
  view.unmount();
  render(<ProductTab />);
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('default');
});
