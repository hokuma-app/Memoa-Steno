import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FoldDocument, FoldToken } from '../../lib/summaryFoldingContracts';
import { toPaperData } from './paperData';

const toks = (text: string): FoldToken[] =>
  text.split(' ').map((t, i, all) => (i < all.length - 1 ? { t, s: 1 } : { t }));
const unit = (kind: 'paragraph' | 'item' | 'heading', full: string, marker?: string) => ({
  kind,
  marker,
  src: full,
  full,
  toks: toks(full),
  ...(kind === 'heading'
    ? {}
    : {
        sents: [[0, full.split(' ').length]] as [number, number][],
        lad: { role: 'context', ev: [0], brief: toks(full).map((t, m) => ({ ...t, m })), tn: 1, topic: [{ t: 'Een', k: 0 }], model: 'local' as const },
      }),
});
const doc: FoldDocument = {
  schemaVersion: 2,
  sourceHash: 'a'.repeat(64),
  provenance: 'local',
  sections: [
    { id: 'overview', title: 'Samenvatting', full: '', lad: null, units: [unit('paragraph', 'Een korte alinea')] },
    {
      id: 'discussion-0',
      title: 'Prijs',
      full: '',
      lad: { take: toks('Prijs staat open'), topic: [0] },
      units: [unit('paragraph', 'Intro tekst'), unit('heading', 'Kop'), unit('item', 'Punt een', '-'), unit('item', 'Punt twee', '-')],
    },
  ],
};

describe('toPaperData', () => {
  it('turns sections into chunks, headings into sub-chunks and items into one list run', () => {
    const d = toPaperData(doc);
    expect(d.chunks.map((c) => [c.id, c.level, c.units])).toEqual([
      ['overview', 2, ['overview.0']],
      ['discussion-0', 2, ['discussion-0.0']],
      ['discussion-0~1', 3, ['discussion-0.2', 'discussion-0.3']],
    ]);
    expect(d.chunks[2].title).toBe('Kop');
    expect(d.chunks[1].lad).toEqual({ take: toks('Prijs staat open'), topic: [0] });
    expect(d.blocks.map((b) => (b.k === 'h' ? 'h:' + b.chunk : 'u:' + b.u))).toEqual([
      'h:overview', 'u:overview.0', 'h:discussion-0', 'u:discussion-0.0', 'h:discussion-0~1', 'u:discussion-0.2', 'u:discussion-0.3',
    ]);
    const items = d.units['discussion-0.2'] as { role: string; list: string; marker: string };
    expect(items.role).toBe('item');
    expect(items.list).toBe((d.units['discussion-0.3'] as { list: string }).list);
    expect((d.units['overview.0'] as { role: string }).role).toBe('para');
  });
  it('escapes titles because the reader writes them as HTML', () => {
    const d = toPaperData({ ...doc, sections: [{ ...doc.sections[0], title: '<img src=x onerror=1>' }] });
    expect(d.chunks[0].html).toBe('&lt;img src=x onerror=1&gt;');
  });
  it('only passes list markers of the known shape on, because the reader writes them as HTML', () => {
    const items = (marker: string) => toPaperData({ ...doc, sections: [{ ...doc.sections[1], units: [unit('item', 'Punt', marker)] }] }).units['discussion-0.0'] as { marker: string };
    for (const safe of ['-', '*', '+', '1.', '12)', '999.']) expect(items(safe).marker).toBe(safe);
    for (const unsafe of ['<img src=x onerror=1>', '1.<b>', '- ', '', '1234.', '&amp;']) expect(items(unsafe).marker).toBe('-');
  });
  it('the reader escapes the marker when it writes it (defense in depth)', () => {
    // reader.js is a verbatim port that needs a browser layout engine; its source line is pinned here and the
    // browser spec (reader.spec.ts) covers the rendering.
    const source = readFileSync(resolve(process.cwd(), 'renderer/src/modules/summary-folding/textfold/reader.js'), 'utf8');
    expect(source).toContain("h('span', labeled ? 'mk mk-labeled' : 'mk', esc(u.marker))");
    expect(source).not.toContain("'mk', u.marker)");
  });
});
