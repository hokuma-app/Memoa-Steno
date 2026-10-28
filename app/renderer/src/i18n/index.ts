import en from './locales/en.json';
import { IS_VENETA_MEMOAI } from '@/lib/productBrand';
import { venetaCopy } from './veneta';

export type TranslationKey = keyof typeof en;
export type TranslationParams = Readonly<Record<string, string | number>>;

const INTERPOLATION = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;

export function createTranslator<const Catalogue extends Record<string, string>>(
  catalogue: Catalogue,
) {
  return function translate<Key extends keyof Catalogue & string>(
    key: Key,
    params: TranslationParams = {},
  ): string {
    return catalogue[key].replace(INTERPOLATION, (token, parameter: string) =>
      Object.hasOwn(params, parameter) ? String(params[parameter]) : token,
    );
  };
}

/**
 * Resolve renderer copy from the canonical English catalogue.
 *
 * English remains the default. The explicitly selected Veneta build overrides
 * only its product-owned copy; existing copy keeps its English fallback.
 */
export const t: (key: TranslationKey, params?: TranslationParams) => string =
  createTranslator(IS_VENETA_MEMOAI ? { ...en, ...venetaCopy } : en);
