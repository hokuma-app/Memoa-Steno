export type ProductProfileId = 'default' | 'veneta';
export type ProductModuleId = 'conversation-checklist' | 'agenda-chair';

export interface ProductSettings {
  schemaVersion: 1;
  profile: ProductProfileId;
  /** The checklist key is always present; a newer module key is optional (absent = off). */
  modules: { 'conversation-checklist': boolean } & Partial<Record<ProductModuleId, boolean>>;
}

export interface ProductSettingsPatch {
  profile?: ProductProfileId;
  modules?: Partial<Record<ProductModuleId, boolean>>;
}

export type ProductSettingsResult =
  | { success: true; settings: ProductSettings }
  | { success: false; error: string };

export interface ProductSettingsGateway {
  get(): Promise<ProductSettingsResult>;
  set(patch: ProductSettingsPatch): Promise<ProductSettingsResult>;
}
