export type ProductProfileId = 'default' | 'veneta';
export type ProductModuleId = 'conversation-checklist';

export interface ProductSettings {
  schemaVersion: 1;
  profile: ProductProfileId;
  modules: Record<ProductModuleId, boolean>;
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
