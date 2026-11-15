import type { FoldDocument } from '../../lib/summaryFoldingContracts';
import type { TextFoldPaper } from './textfold/reader';

const esc = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** The reader writes markers as HTML: only the shapes the Markdown parser can produce get through. */
const safeMarker = (marker: string | undefined) => (typeof marker === 'string' && /^(?:[-*+]|\d{1,3}[.)])$/.test(marker) ? marker : '-');

/**
 * The fold document in TextFold's own paper-data shape (docs/format.md, build.py): a section is a chunk, a Markdown
 * heading inside it starts a sub-chunk, a list item is a unit of role 'item' and consecutive items share one list.
 */
export function toPaperData(document: FoldDocument): TextFoldPaper {
  const units: Record<string, unknown> = {};
  const chunks: TextFoldPaper['chunks'] = [];
  const blocks: TextFoldPaper['blocks'] = [];
  for (const section of document.sections) {
    let chunk = { id: section.id, num: '', title: section.title, level: 2, html: esc(section.title), units: [] as string[], lad: section.lad };
    chunks.push(chunk);
    blocks.push({ k: 'h', chunk: chunk.id });
    let run = 0;
    let previousItem = false;
    section.units.forEach((unit, n) => {
      if (unit.kind === 'heading') {
        chunk = { id: `${section.id}~${n}`, num: '', title: unit.full, level: 3, html: esc(unit.full), units: [], lad: null };
        chunks.push(chunk);
        blocks.push({ k: 'h', chunk: chunk.id });
        previousItem = false;
        return;
      }
      if (unit.kind === 'item' && !previousItem) run += 1;
      previousItem = unit.kind === 'item';
      const uid = `${section.id}.${n}`;
      units[uid] = {
        toks: unit.toks,
        sents: unit.sents,
        role: unit.kind === 'item' ? 'item' : 'para',
        marker: unit.kind === 'item' ? safeMarker(unit.marker) : unit.marker,
        list: `${section.id}:${run}`,
        lad: unit.lad,
      };
      chunk.units.push(uid);
      blocks.push({ k: 'u', u: uid, chunk: chunk.id });
    });
  }
  return { units, chunks, blocks };
}
