import { IS_VENETA_MEMOAI } from './productBrand';
import type { ProductModuleId, ProductProfileId, ProductSettings } from './productContracts';

export type { ProductModuleId, ProductProfileId, ProductSettings } from './productContracts';
export const PRODUCT_PROFILE_IDS: readonly ProductProfileId[] = ['default', 'veneta'];
export const PRODUCT_MODULE_IDS: readonly ProductModuleId[] = ['conversation-checklist'];
export const BUILD_PRODUCT_PROFILE: ProductProfileId = IS_VENETA_MEMOAI ? 'veneta' : 'default';
export function initialProductSettings(
  profile: ProductProfileId = BUILD_PRODUCT_PROFILE
): ProductSettings {
  return { schemaVersion: 1, profile, modules: { 'conversation-checklist': false } };
}
export function isProductModuleEnabled(
  settings: ProductSettings,
  hydrated: boolean,
  id: ProductModuleId
): boolean {
  return hydrated && settings.profile === 'veneta' && settings.modules[id] === true;
}
