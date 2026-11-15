import { checklistText, nl, type ChecklistCopyKey } from './locales/nl';
import { runtimeText } from './runtimeCopy';

type RuntimeKey = Parameters<typeof runtimeText>[0];

/** One lookup over both Dutch module catalogues, so overview components use a single `t`. */
export function overviewText(key: ChecklistCopyKey | RuntimeKey, params: Record<string, string | number> = {}): string {
  return Object.hasOwn(nl, key) ? checklistText(key as ChecklistCopyKey, params) : runtimeText(key as RuntimeKey, params);
}
