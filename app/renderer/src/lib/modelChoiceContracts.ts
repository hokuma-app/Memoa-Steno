/** Settings > AI > "Model per functie" (0.10.0): wire types between the pickers and the host. */
export type ModelFunction = 'summary' | 'summary_fold' | 'checklist' | 'agenda';
/** 0.11.0: the agenda chair has its own choice; empty means "same as the checklist" (the others: the summary). */
export const MODEL_FUNCTIONS: readonly ModelFunction[] = ['summary', 'summary_fold', 'checklist', 'agenda'];

export interface InstalledModel {
  name: string;
  size_bytes: number;
  format: string;
  quantization: string;
  parameter_size: string;
  /** Functions that currently run on this model (it cannot be deleted while this is non-empty). */
  functions: ModelFunction[];
}
export type CatalogStatus = 'aanbevolen' | 'kandidaat';
export type DeviceClass = 'klein' | 'mac';
export interface CatalogModel {
  id: string;
  name: string;
  publisher: string;
  size_bytes: number | null;
  license: string;
  source_url: string;
  hf_repo: string;
  functions: ModelFunction[];
  device_class: DeviceClass;
  status: CatalogStatus;
  note: string;
  /** Name stored when this entry is chosen; '' when it has no Ollama tag. */
  choice_name: string;
  /** The tag a download fetches on this machine; '' = not downloadable in the app. */
  pull_tag: string;
  pull_size_bytes: number | null;
  installed: boolean;
}
export interface ModelChoices {
  provider: string;
  functions: Record<ModelFunction, { choice: string; effective: string }>;
  server_running: boolean;
  installed: InstalledModel[];
  catalog: CatalogModel[];
  catalog_error: string | null;
  total_ram_gb?: number;
}
export type ModelRefusalReason =
  | 'cloud' | 'invalid' | 'empty' | 'too_long' | 'disk_full' | 'in_use' | 'not_installed'
  | 'invalid_function' | 'save_failed' | 'busy' | 'failed';
export interface ModelRefusal {
  success: false;
  reason?: ModelRefusalReason | string;
  functions?: ModelFunction[];
  error?: string;
}
export type ModelChoicesResponse = ({ success: true } & ModelChoices) | ModelRefusal;
export type SetModelChoiceResponse =
  | { success: true; function: ModelFunction; choice: string; effective: string }
  | ModelRefusal;
export type AddPreviewResponse =
  | {
      success: true;
      name: string;
      kind: 'ollama' | 'hf';
      size_bytes: number | null;
      installed: boolean;
      disk: { ok: boolean; free_bytes: number; needed_bytes: number };
    }
  | ModelRefusal;
export type ModelTestResponse =
  | { success: true; function: ModelFunction; model: string; valid: boolean; ms: number; reason: string | null }
  | ModelRefusal;
