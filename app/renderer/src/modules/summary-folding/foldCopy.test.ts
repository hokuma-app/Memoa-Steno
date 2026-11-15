import { describe, expect, it } from 'vitest';
import type { FoldDocument, FoldToken, FoldUnit } from '../../lib/summaryFoldingContracts';
import { buildLevelCopyText } from '../../lib/notesCopy';
import { foldMarkdown } from './foldCopy';

const toks = (text: string): FoldToken[] =>
  text.split(' ').map((t, i, all) => ({ t, ...(i < all.length - 1 ? { s: 1 as const } : {}) }));
const plain = (text: string): FoldToken[] => toks(text);

function unit(kind: FoldUnit['kind'], full: string, lad?: Partial<NonNullable<FoldUnit['lad']>>, marker?: string): FoldUnit {
  const tokens = toks(full);
  const base: FoldUnit = { kind, src: full, full, toks: tokens, ...(marker ? { marker } : {}) };
  if (kind === 'heading') return base;
  const cut = tokens.findIndex((token) => token.t.endsWith('.')) + 1;
  const sents: [number, number][] = [[0, cut], [cut, tokens.length]];
  return {
    ...base,
    sents,
    lad: {
      role: 'claim', ev: [0], tn: 2, model: 'ai',
      brief: plain('Kernregel met reden erbij'),
      topic: plain('Onderwerp'),
      ...lad,
    },
  };
}

const DOC: FoldDocument = {
  schemaVersion: 2,
  sourceHash: 'x',
  provenance: 'ai',
  sections: [
    {
      id: 'a',
      title: 'Samenvatting',
      full: 'x',
      lad: null,
      units: [unit('paragraph', 'Eerste zin van de alinea. Tweede zin met meer detail.', { brief: plain('Kern van de alinea omdat dat zo is'), topic: plain('Alinea') })],
    },
    {
      id: 'b',
      title: 'Kernpunten',
      full: 'x',
      lad: { take: plain('De kernpunten in een regel'), topic: [0, 1] },
      units: [
        unit('item', 'Punt een is belangrijk. Daar komt uitleg bij.', { brief: plain('Punt een kort omdat ja'), topic: plain('Punt een') }, '-'),
        unit('item', 'Punt twee is ook belangrijk. Nog meer uitleg.', { brief: plain('Punt twee kort omdat nee'), topic: plain('Punt twee') }, '-'),
      ],
    },
  ],
};

describe('foldMarkdown: the text of the chosen level, as shown', () => {
  it('Volledig is every unit as written, with headings and bullets', () => {
    expect(foldMarkdown(DOC, 'full')).toBe(
      '## Samenvatting\n\nEerste zin van de alinea. Tweede zin met meer detail.\n\n## Kernpunten\n\n' +
        '- Punt een is belangrijk. Daar komt uitleg bij.\n- Punt twee is ook belangrijk. Nog meer uitleg.',
    );
  });

  it('Beknopt is the evidence sentences only, verbatim', () => {
    const text = foldMarkdown(DOC, 'brief');
    expect(text).toContain('Eerste zin van de alinea.');
    expect(text).not.toContain('Tweede zin met meer detail');
    expect(text).toContain('- Punt een is belangrijk.');
    expect(text).not.toContain('Daar komt uitleg bij');
  });

  it('Kern is the written line, Kernzin its first words, Onderwerpen the topics under the section line', () => {
    expect(foldMarkdown(DOC, 'key')).toContain('- Punt een kort omdat ja');
    expect(foldMarkdown(DOC, 'takeaway')).toBe('## Samenvatting\n\nKern van\n\n## Kernpunten\n\n- Punt een\n- Punt twee');
    expect(foldMarkdown(DOC, 'topic')).toBe(
      '## Samenvatting\n\n- Alinea\n\n## Kernpunten\n\nDe kernpunten in een regel\n\n- Punt een\n- Punt twee',
    );
  });

  it('is shorter at every step down and never carries other levels', () => {
    const sizes = (['full', 'brief', 'key', 'takeaway', 'topic'] as const).map((level) => foldMarkdown(DOC, level).length);
    expect(sizes[0]).toBeGreaterThan(sizes[1]);
    expect(sizes[1]).toBeGreaterThan(sizes[3]);
    expect(foldMarkdown(DOC, 'topic')).not.toContain('Tweede zin');
  });

  it('empty text tokens of a linked speaker name do not leave double spaces', () => {
    const doc: FoldDocument = {
      ...DOC,
      sections: [{ ...DOC.sections[0], units: [{ ...DOC.sections[0].units[0], toks: [{ t: 'Anna', s: 1 }, { t: '' }, { t: 'belt', s: 1 }, { t: 'op.' }] }] }],
    };
    expect(foldMarkdown(doc, 'full')).toContain('Anna belt op.');
  });
});

describe('buildLevelCopyText', () => {
  const sections = { name: 'Notitie', meta: '1 mei', discussionAreas: [], keyPoints: [], summary: 'x', actionItems: ['Anna: bel'], participants: ['Anna', 'Bob'] };

  it('adds what the note shows below the folded text, only for the standard note', () => {
    const body = foldMarkdown(DOC, 'topic');
    const standard = buildLevelCopyText(sections, body, true);
    expect(standard).toBe(`Notitie\n1 mei\n\n${body}\n\n## Action items\n- Anna: bel\n\n## Participants\nAnna, Bob`);
    expect(buildLevelCopyText(sections, body, false)).toBe(`Notitie\n1 mei\n\n${body}`);
  });
});
