import { useEffect, useSyncExternalStore } from 'react';
import { ipc } from '@/lib/ipc';
import {
  BUILD_PRODUCT_PROFILE,
  initialProductSettings,
  isProductModuleEnabled,
} from '@/lib/productProfiles';
import type {
  ProductModuleId,
  ProductProfileId,
  ProductSettings,
  ProductSettingsGateway,
  ProductSettingsPatch,
} from '@/lib/productContracts';

export interface ProductSettingsSnapshot {
  settings: ProductSettings;
  hydrated: boolean;
  error: string | null;
}
export interface ProductSettingsStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ProductSettingsSnapshot;
  hydrate(): Promise<void>;
  setProfile(id: ProductProfileId): Promise<void>;
  setModuleEnabled(id: ProductModuleId, enabled: boolean): Promise<void>;
}

// Optional until the parent bridge is wired; older IPC mocks fail closed.
function defaultGateway(): ProductSettingsGateway | undefined {
  const bridge: ReturnType<typeof ipc> & { productSettings?: ProductSettingsGateway } = ipc();
  return bridge.productSettings;
}
export function createProductSettingsStore(
  resolveGateway: () => ProductSettingsGateway | undefined = defaultGateway,
  fallback: ProductProfileId = BUILD_PRODUCT_PROFILE
): ProductSettingsStore {
  let snapshot: ProductSettingsSnapshot = {
    settings: initialProductSettings(fallback),
    hydrated: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  let hydration: Promise<void> | undefined;
  let gateway: ProductSettingsGateway | undefined;
  let writes = Promise.resolve();
  const publish = (next: ProductSettingsSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const fail = (error: unknown) =>
    publish({ ...snapshot, error: error instanceof Error ? error.message : String(error) });
  const hydrate = (): Promise<void> => {
    hydration ??= Promise.resolve().then(async () => {
      try {
        gateway = resolveGateway();
        if (!gateway) throw new Error('product-settings-unavailable');
        const result = await gateway.get();
        if (!result.success) throw new Error(result.error);
        publish({ settings: result.settings, hydrated: true, error: null });
      } catch (error) {
        fail(error);
      }
    });
    return hydration;
  };
  const set = (patch: ProductSettingsPatch): Promise<void> => {
    const operation = writes.then(async () => {
      await hydrate();
      if (!snapshot.hydrated || !gateway) return;
      try {
        const result = await gateway.set(patch);
        if (!result.success) throw new Error(result.error);
        // Only acknowledged canonical settings become effective. Failed writes
        // leave the previous profile/module flags intact.
        publish({ settings: result.settings, hydrated: true, error: null });
      } catch (error) {
        fail(error);
      }
    });
    writes = operation;
    return operation;
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    hydrate,
    setProfile: (profile) => set({ profile }),
    setModuleEnabled: (id, enabled) => set({ modules: { [id]: enabled } }),
  };
}
export const productSettingsStore = createProductSettingsStore();
export function useProductSettings(store: ProductSettingsStore = productSettingsStore) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    void store.hydrate();
  }, [store]);
  return { ...snapshot, setProfile: store.setProfile, setModuleEnabled: store.setModuleEnabled };
}
export function useVenetaProfile(store: ProductSettingsStore = productSettingsStore): boolean {
  return useProductSettings(store).settings.profile === 'veneta';
}
export function useModuleEnabled(
  id: ProductModuleId,
  store: ProductSettingsStore = productSettingsStore
): boolean {
  const { settings, hydrated } = useProductSettings(store);
  return isProductModuleEnabled(settings, hydrated, id);
}
