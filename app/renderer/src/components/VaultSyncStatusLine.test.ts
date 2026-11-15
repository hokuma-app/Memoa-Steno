import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const brand = vi.hoisted(() => ({ veneta: false }));
vi.mock('@/lib/productBrand', () => ({
  get IS_VENETA_MEMOAI() {
    return brand.veneta;
  },
}));

import { vaultWaitingReasonText } from './VaultSyncStatusLine';

// The reasons the Obsidian sync writes, read from its source so a new reason
// cannot appear in the UI untranslated without this test noticing.
function backendReasons(): string[] {
  const source = readFileSync('../custom/obsidian_sync.py', 'utf8');
  const body = source.slice(source.indexOf('def incomplete_reason('), source.indexOf('\ndef ', source.indexOf('def incomplete_reason(') + 1));
  return [...body.matchAll(/return "([^"]+)"/g)].map((match) => match[1]);
}

describe('vault waiting reasons from the Python sync', () => {
  it('covers every reason the backend can report', () => {
    const reasons = backendReasons();
    expect(reasons).toHaveLength(4);
    brand.veneta = true;
    for (const reason of reasons) expect(vaultWaitingReasonText(reason)).not.toBe(reason);
    brand.veneta = false;
  });

  it('keeps the backend text in the default build and translates it in the Veneta build', () => {
    brand.veneta = false;
    for (const reason of backendReasons()) expect(vaultWaitingReasonText(reason)).toBe(reason);
    brand.veneta = true;
    expect(vaultWaitingReasonText('still processing')).toBe('wordt nog verwerkt');
    expect(vaultWaitingReasonText('something new')).toBe('something new');
    brand.veneta = false;
  });
});
