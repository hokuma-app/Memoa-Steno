import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Interface copy for specs that run against both renderer builds: the default
// build shows en.json, the Veneta build veneta-nl.json on top of it. The spec
// names a catalogue key; the helpers return the text of the build under test,
// so an English text in the Veneta build (or a Dutch one in the default build)
// still fails.
const appDir = join(__dirname, '..', '..', 'app');
const locales = join(appDir, 'renderer', 'src', 'i18n', 'locales');
const en: Record<string, string> = JSON.parse(readFileSync(join(locales, 'en.json'), 'utf8'));
const nl: Record<string, string> = JSON.parse(readFileSync(join(locales, 'veneta-nl.json'), 'utf8'));

/**
 * Which renderer build the suite runs against. `E2E_RENDERER_BUILD=veneta|default`
 * overrides; otherwise read from app/renderer/dist: only the Veneta build keeps
 * the branch of main.tsx that marks the document as Veneta MemoAi.
 */
function detectVenetaBuild(): boolean {
  const forced = process.env.E2E_RENDERER_BUILD;
  if (forced === 'veneta') return true;
  if (forced === 'default') return false;
  const assets = join(appDir, 'renderer', 'dist', 'assets');
  if (!existsSync(assets)) throw new Error('app/renderer/dist is missing: run build:renderer first');
  const marker = /dataset\.product="veneta-memoai",document\.title=/;
  return readdirSync(assets)
    .filter((file) => file.endsWith('.js'))
    .some((file) => marker.test(readFileSync(join(assets, file), 'utf8')));
}

export const VENETA_BUILD = detectVenetaBuild();

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function fill(template: string, params: Record<string, string | number>) {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, name: string) => String(params[name] ?? ''));
}

/** The English and the Dutch text for a catalogue key. */
export function uiTexts(key: string, params: Record<string, string | number> = {}): [string, string] {
  const english = en[key];
  if (english === undefined) throw new Error(`Unknown interface copy key: ${key}`);
  return [fill(english, params), fill(nl[key] ?? english, params)];
}

/** The text of `key` in the build under test. */
export function uiText(key: string, params: Record<string, string | number> = {}): string {
  return uiTexts(key, params)[VENETA_BUILD ? 1 : 0];
}

/** Matches the text of `key` in the build under test exactly. */
export function ui(key: string, params: Record<string, string | number> = {}): RegExp {
  return new RegExp(`^${escape(uiText(key, params))}$`);
}

/**
 * Matches the text of `key` anywhere, ignoring case: the same rule Playwright
 * applies to a plain string without `exact: true`.
 */
export function uiPart(key: string, params: Record<string, string | number> = {}): RegExp {
  return new RegExp(escape(uiText(key, params)), 'i');
}

/**
 * The text of `key` in the build under test as regex source, with each
 * `{{placeholder}}` replaced by the given regex source (`.*?` when not given).
 * For texts where the spec only pins part of a value, such as a duration.
 */
export function uiSource(key: string, patterns: Record<string, string> = {}): string {
  if (en[key] === undefined) throw new Error(`Unknown interface copy key: ${key}`);
  const template = VENETA_BUILD ? (nl[key] ?? en[key]) : en[key];
  return template
    .split(/(\{\{\s*[\w.-]+\s*\}\})/)
    .map((piece) => {
      const name = /^\{\{\s*([\w.-]+)\s*\}\}$/.exec(piece)?.[1];
      return name ? (patterns[name] ?? '.*?') : escape(piece);
    })
    .join('');
}
