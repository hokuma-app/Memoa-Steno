import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ProductSettingsGateway } from '@/lib/productContracts';
import { ProductTab } from './ProductTab';

const fake = vi.hoisted(() => ({ gateway: undefined as ProductSettingsGateway | undefined, micIsSeller: true, fail: false }));
vi.mock('@/lib/ipc', () => ({ ipc: () => ({ productSettings: fake.gateway, checklists: {
  getSettings: async () => ({ success: true, settings: { micIsSeller: fake.micIsSeller } }),
  setSettings: async (request: { micIsSeller: boolean }) => {
    if (fake.fail) return { success: false, error: 'x' };
    fake.micIsSeller = request.micIsSeller;
    return { success: true, settings: { micIsSeller: fake.micIsSeller } };
  },
} }) }));
afterEach(cleanup);
const gateway = (enabled: boolean): ProductSettingsGateway => ({
  get: async () => ({ success: true, settings: { schemaVersion: 1, profile: 'veneta', modules: { 'conversation-checklist': enabled } } }),
  set: async () => ({ success: true, settings: { schemaVersion: 1, profile: 'veneta', modules: { 'conversation-checklist': enabled } } }),
});

it('offers the seller channel setting while the checklist module is on, default on, and keeps it reversible', async () => {
  fake.micIsSeller = true; fake.fail = false; fake.gateway = gateway(true);
  render(<ProductTab />);
  const mic = await screen.findByRole('switch', { name: 'Mijn microfoon is de verkoper' });
  await waitFor(() => expect(mic.getAttribute('aria-checked')).toBe('true'));
  fireEvent.click(mic);
  await waitFor(() => expect(fake.micIsSeller).toBe(false));
  await waitFor(() => expect(mic.getAttribute('aria-checked')).toBe('false'));
  fireEvent.click(mic);
  await waitFor(() => expect(fake.micIsSeller).toBe(true));
});

it('keeps the seller channel setting and says so when it cannot be saved', async () => {
  fake.micIsSeller = true; fake.fail = true; fake.gateway = gateway(true);
  render(<ProductTab />);
  const mic = await screen.findByRole('switch', { name: 'Mijn microfoon is de verkoper' });
  await waitFor(() => expect(mic.getAttribute('aria-checked')).toBe('true'));
  fireEvent.click(mic);
  expect((await screen.findByRole('alert')).textContent).toContain('Verkoperskanaal');
  expect(mic.getAttribute('aria-checked')).toBe('true');
});
