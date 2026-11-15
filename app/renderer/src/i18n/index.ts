import en from './locales/en.json';
import { IS_VENETA_MEMOAI } from '@/lib/productBrand';
import { venetaCopy } from './veneta';

export type TranslationKey = keyof typeof en;
// Values are stringified like a template literal would, so moving
// `${value}` behind t() keeps the rendered text identical.
export type TranslationParams = Readonly<Record<string, string | number | boolean | null | undefined>>;

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

const english = createTranslator(en);
const dutch = createTranslator({ ...en, ...venetaCopy });

/**
 * Resolve renderer copy from the canonical English catalogue.
 *
 * English remains the default build's interface language. The explicitly
 * selected Veneta build shows the Dutch catalogue, which translates every
 * English key (enforced by veneta-nl.test.ts). The build flag is read per call
 * so a test that switches the product boundary sees the matching language.
 */
export function t(key: TranslationKey, params?: TranslationParams): string {
  return (IS_VENETA_MEMOAI ? dutch : english)(key, params);
}
