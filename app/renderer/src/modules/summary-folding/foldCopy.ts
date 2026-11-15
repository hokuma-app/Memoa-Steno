import type { FoldDocument, FoldLevel, FoldToken, FoldUnit } from '../../lib/summaryFoldingContracts';

/**
 * What the reader shows at a detail level, as Markdown: the text of the chosen level, from the document the reader
 * was given (local or AI levels, speaker names already applied). Nothing here is read from the DOM, so no morph
 * frame, ghost or hidden in-between text can reach the clipboard.
 *
 * Volledig: every unit as written. Beknopt: the evidence sentences (verbatim from the full text). Kern: the written
 * line. Kernzin: its first words. Onderwerpen: the topic of each unit, under the section's own line.
 */
const words = (tokens: readonly FoldToken[]) =>
  tokens
    .map((token) => token.t + (token.s ? ' ' : ''))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

function unitText(unit: FoldUnit, level: FoldLevel): string {
  if (level === 'full' || !unit.lad) return words(unit.toks) || unit.full.trim();
  const { lad } = unit;
  switch (level) {
    case 'brief': {
      const sentences = unit.sents ?? [];
      const chosen = lad.ev.map((index) => sentences[index]).filter((range): range is [number, number] => Boolean(range));
      return chosen.length ? chosen.map(([from, to]) => words(unit.toks.slice(from, to))).join(' ').trim() : words(unit.toks);
    }
    case 'key':
      return words(lad.brief);
    case 'takeaway':
      return words(lad.brief.slice(0, lad.tn));
    case 'topic':
      return words(lad.topic);
  }
}

export function foldMarkdown(document: FoldDocument, level: FoldLevel): string {
  const blocks: string[] = [];
  for (const section of document.sections) {
    if (section.title.trim()) blocks.push(`## ${section.title.trim()}`);
    if (level === 'topic') {
      const take = section.lad ? words(section.lad.take) : '';
      if (take) blocks.push(take);
      const topics = section.units
        .filter((unit) => unit.kind !== 'heading')
        .map((unit) => unitText(unit, 'topic'))
        .filter(Boolean)
        .map((topic) => `- ${topic}`);
      if (topics.length) blocks.push(topics.join('\n'));
      continue;
    }
    let items: string[] = [];
    const flush = () => {
      if (items.length) blocks.push(items.join('\n'));
      items = [];
    };
    for (const unit of section.units) {
      if (unit.kind === 'heading') {
        flush();
        const heading = words(unit.toks) || unit.full.trim();
        if (heading) blocks.push(`### ${heading}`);
        continue;
      }
      const text = unitText(unit, level);
      if (!text) continue;
      if (unit.kind === 'item') {
        items.push(`${unit.marker ?? '-'} ${text}`);
      } else {
        flush();
        blocks.push(text);
      }
    }
    flush();
  }
  return blocks.join('\n\n');
}
