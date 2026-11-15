import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProductSettings, ProductSettingsGateway } from '@/lib/productContracts';
import {
  createProductSettingsStore,
  useProductSettings,
  useModuleEnabled,
  useVenetaProfile,
} from './useProductSettings';

vi.mock('@/lib/ipc', () => ({ ipc: () => ({}) }));
afterEach(cleanup);
const initial = (): ProductSettings => ({
  schemaVersion: 1,
  profile: 'veneta',
  modules: { 'conversation-checklist': false },
});
function fixture() {
  let persisted = initial();
  const gateway: ProductSettingsGateway = {
    get: async () => ({ success: true, settings: structuredClone(persisted) }),
    set: async (patch) => {
      persisted = { ...persisted, ...patch, modules: { ...persisted.modules, ...patch.modules } };
      return { success: true, settings: structuredClone(persisted) };
    },
  };
  return gateway;
}

describe('product settings gateway boundary', () => {
  it('keeps build appearance and modules off when the bridge is absent', async () => {
    for (const fallback of ['default', 'veneta'] as const) {
      const store = createProductSettingsStore(() => undefined, fallback);
      const view = renderHook(() => ({
        ...useProductSettings(store),
        enabled: useModuleEnabled('conversation-checklist', store),
        veneta: useVenetaProfile(store),
      }));
      await waitFor(() => expect(view.result.current.error).toBe('product-settings-unavailable'));
      expect(view.result.current.hydrated).toBe(false);
      expect(view.result.current.veneta).toBe(fallback === 'veneta');
      expect(view.result.current.enabled).toBe(false);
      await act(() => view.result.current.setModuleEnabled('conversation-checklist', true));
      expect(view.result.current.enabled).toBe(false);
      view.unmount();
    }
  });
  it('does not enable from build appearance while hydration is pending and never writes before get', async () => {
    let resolve!: (value: Awaited<ReturnType<ProductSettingsGateway['get']>>) => void;
    const gateway: ProductSettingsGateway = {
      get: () =>
        new Promise((r) => {
          resolve = r;
        }),
      set: vi.fn<ProductSettingsGateway['set']>(async () => ({
        success: true,
        settings: initial(),
      })),
    };
    const store = createProductSettingsStore(() => gateway, 'veneta');
    const view = renderHook(() => ({
      ...useProductSettings(store),
      enabled: useModuleEnabled('conversation-checklist', store),
    }));
    await waitFor(() => expect(resolve).toBeDefined());
    let write!: Promise<void>;
    act(() => {
      write = view.result.current.setProfile('default');
    });
    expect(view.result.current.enabled).toBe(false);
    expect(gateway.set).not.toHaveBeenCalled();
    await act(async () => {
      resolve({ success: true, settings: initial() });
      await write;
    });
    expect(gateway.set).toHaveBeenCalledWith({ profile: 'default' });
  });
  it('does not publish failed writes and recovers on the next acknowledged edit', async () => {
    const gateway = fixture();
    const realSet = gateway.set;
    gateway.set = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: 'disk-full' })
      .mockRejectedValueOnce(new Error('transport'))
      .mockImplementation(realSet);
    const store = createProductSettingsStore(() => gateway);
    const view = renderHook(() => ({
      ...useProductSettings(store),
      enabled: useModuleEnabled('conversation-checklist', store),
    }));
    await waitFor(() => expect(view.result.current.hydrated).toBe(true));
    await act(() => view.result.current.setModuleEnabled('conversation-checklist', true));
    expect(view.result.current.enabled).toBe(false);
    expect(view.result.current.error).toBe('disk-full');
    await act(() => view.result.current.setProfile('default'));
    expect(view.result.current.settings.profile).toBe('veneta');
    expect(view.result.current.error).toBe('transport');
    await act(() => view.result.current.setModuleEnabled('conversation-checklist', true));
    expect(view.result.current.enabled).toBe(true);
    expect(view.result.current.error).toBeNull();
  });
  it('hydrates before edits and persists optional module across remounts without deleting its flag in Default', async () => {
    const gateway = fixture();
    const store = createProductSettingsStore(() => gateway, 'default');
    const view = renderHook(() => ({
      ...useProductSettings(store),
      enabled: useModuleEnabled('conversation-checklist', store),
      veneta: useVenetaProfile(store),
    }));
    expect(view.result.current.enabled).toBe(false);
    await waitFor(() => expect(view.result.current.hydrated).toBe(true));
    expect(view.result.current.settings.modules['conversation-checklist']).toBe(false);
    await act(() => view.result.current.setModuleEnabled('conversation-checklist', true));
    expect(view.result.current.enabled).toBe(true);
    await act(() => view.result.current.setProfile('default'));
    expect(view.result.current.enabled).toBe(false);
    expect(view.result.current.veneta).toBe(false);
    expect(view.result.current.settings.modules['conversation-checklist']).toBe(true);
    view.unmount();
    const fresh = createProductSettingsStore(() => gateway, 'veneta');
    const reloaded = renderHook(() => useProductSettings(fresh));
    await waitFor(() => expect(reloaded.result.current.hydrated).toBe(true));
    expect(reloaded.result.current.settings.profile).toBe('default');
    expect(reloaded.result.current.settings.modules['conversation-checklist']).toBe(true);
  });
});
