import { describe, expect, it } from 'vitest';
import {
  applySpeakerNames,
  applySpeakerNamesMarkdown,
  applySpeakerNamesToList,
  applySpeakerNamesToDocument,
  applySpeakerNamesToTokens,
  speakerNamesKey,
} from './speakerNames';
import type { FoldDocument, FoldToken } from './summaryFoldingContracts';

const NAMES = { 'Speaker 2': 'Anna de Vries' };

describe('applySpeakerNames', () => {
  it('replaces the labels the app and small models write, in Dutch and English', () => {
    for (const label of ['Speaker 2', 'speaker 2', 'SPEAKER 2', 'Spreker 2', 'spreker 2', 'SPEAKER_02', 'Speaker_2', 'SPEAKER_2']) {
      expect(applySpeakerNames(`${label}: stuur de offerte`, NAMES), label).toBe('Anna de Vries: stuur de offerte');
    }
  });

  it('never touches another number: Speaker 2 is not Speaker 20 or Speaker 12', () => {
    expect(applySpeakerNames('Speaker 20 en Speaker 12 en Speaker 2', NAMES)).toBe('Speaker 20 en Speaker 12 en Anna de Vries');
    expect(applySpeakerNames('SPEAKER_20', NAMES)).toBe('SPEAKER_20');
  });

  it('keeps words that only contain the label, and labels that are not linked', () => {
    expect(applySpeakerNames('Loudspeaker 2 en Speakers 2 en Speaker 3', NAMES)).toBe('Loudspeaker 2 en Speakers 2 en Speaker 3');
  });

  it('replaces inside quotes, bold, brackets and possessives', () => {
    expect(applySpeakerNames('"Speaker 2 zei: ja" en **Speaker 2** en [Speaker 2] en Speaker 2\'s plan', NAMES)).toBe(
      '"Anna de Vries zei: ja" en **Anna de Vries** en [Anna de Vries] en Anna de Vries\'s plan',
    );
  });

  it('replaces several labels in one pass and does not re-read an inserted name', () => {
    const names = { 'Speaker 2': 'Speaker 3', 'Speaker 3': 'Bob' };
    expect(applySpeakerNames('Speaker 2 en Speaker 3', names)).toBe('Speaker 3 en Bob');
  });

  it('keeps dollar signs in a name literal', () => {
    expect(applySpeakerNames('Speaker 2', { 'Speaker 2': '$& $1' })).toBe('$& $1');
  });

  it('does nothing without a mapping, and after the name is taken back', () => {
    expect(applySpeakerNames('Speaker 2: ja', {})).toBe('Speaker 2: ja');
    expect(applySpeakerNames('Speaker 2: ja', null)).toBe('Speaker 2: ja');
    expect(applySpeakerNames('', NAMES)).toBe('');
  });

  it('never treats a generic label (You, Others, Jij, Anderen) as a free word', () => {
    for (const label of ['You', 'Others', 'Jij', 'Anderen']) {
      expect(applySpeakerNames('Do you agree? Others zei ja, you too. Jij en anderen', { [label]: 'Martin' })).toBe(
        'Do you agree? Others zei ja, you too. Jij en anderen',
      );
    }
    expect(applySpeakerNames('Do you agree? Speaker 2 wel', { You: 'Martin', Others: 'Bob', 'Speaker 2': 'Anna' })).toBe('Do you agree? Anna wel');
  });

  it('leaves a label inside inline code, code blocks, URLs and file paths alone', () => {
    const text = [
      '`Speaker 2` en ``Speaker 2``',
      '```\nSpeaker 2 zegt\n```',
      'zie https://example.com/Speaker_2/notes?speaker=Speaker_2 en www.example.com/speaker-2',
      'bestand /Users/x/Speaker_2.md en ./SPEAKER_02.wav en ~/Notes/Speaker_2/a.md en C:\\Opnames\\Speaker_2.wav',
      'Speaker_2.wav',
    ].join('\n');
    const out = applySpeakerNames(text, NAMES);
    expect(out).toBe(text);
    expect(applySpeakerNames('Speaker 2 in `code` en Speaker 2', NAMES)).toBe('Anna de Vries in `code` en Anna de Vries');
    expect(applySpeakerNames('Speaker 2. Daarna Speaker 2.', NAMES)).toBe('Anna de Vries. Daarna Anna de Vries.');
  });

  it('shows a name with markdown characters literally (no link, bold or code from a name)', () => {
    expect(applySpeakerNamesMarkdown('Speaker 2 belt', { 'Speaker 2': '[x](https://e)' })).toBe('\\[x\\](https://e) belt');
    expect(applySpeakerNamesMarkdown('Speaker 2', { 'Speaker 2': '**Bob** `c` <b>' })).toBe('\\*\\*Bob\\*\\* \\`c\\` \\<b\\>');
  });

  it('is one pass: a name that looks like a label is not replaced again, and not re-read as a label', () => {
    const names = { 'Speaker 2': 'Speaker 3', 'Speaker 3': 'Bob' };
    expect(applySpeakerNames('Speaker 2 Speaker 3 Speaker 2', names)).toBe('Speaker 3 Bob Speaker 3');
  });

  it('gives a stable key', () => {
    expect(speakerNamesKey({ b: '2', a: '1' })).toBe(speakerNamesKey({ a: '1', b: '2' }));
    expect(speakerNamesKey({})).toBe('');
  });
});

const tok = (t: string, s?: 1, extra: Partial<FoldToken> = {}): FoldToken => ({ t, ...(s ? { s } : {}), ...extra });

describe('applySpeakerNamesToTokens', () => {
  it('keeps the token count and the spacing: the name sits on the first token', () => {
    const toks = [tok('Speaker', 1), tok('2', 1), tok('belt', 1), tok('Speaker', 1), tok('20')];
    const out = applySpeakerNamesToTokens(toks, NAMES);
    expect(out).toHaveLength(toks.length);
    expect(out.map((t) => t.t + (t.s ? ' ' : '')).join('').replace(/ {2,}/g, ' ')).toBe('Anna de Vries belt Speaker 20');
    expect(toks[0].t).toBe('Speaker');
  });

  it('reads SPEAKER_02 split over three tokens and keeps m and k', () => {
    const toks = [tok('SPEAKER'), tok('_'), tok('02', 1, { m: 4 }), tok('zegt')];
    const out = applySpeakerNamesToTokens(toks, NAMES);
    expect(out.map((t) => t.t)).toEqual(['Anna de Vries', '', '', 'zegt']);
    expect(out[2]).toMatchObject({ s: 1, m: 4 });
  });
});

describe('applySpeakerNamesToTokens follows the same rule as applySpeakerNames', () => {
  const shown = (toks: FoldToken[]) => toks.map((t) => t.t + (t.s ? ' ' : '')).join('').replace(/ +/g, ' ').trim();
  const fromText = (text: string): FoldToken[] =>
    (text.match(/\S+/g) ?? []).map((word, i, all) => (i < all.length - 1 ? { t: word, s: 1 as const } : { t: word }));
  const cases: [string, Record<string, string>][] = [
    ['Do you agree Speaker 2 ?', { You: 'Martin', 'Speaker 2': 'Anna' }],
    ['zie `Speaker 2` en Speaker 2 nu', NAMES],
    ['link https://example.com/Speaker_2/x en /Users/x/Speaker_2.md en Speaker 2 klaar', NAMES],
    ['Speaker 2 belt', { 'Speaker 2': '[x](https://e)' }],
    ['Speaker 2 Speaker 3 Speaker 2', { 'Speaker 2': 'Speaker 3', 'Speaker 3': 'Bob' }],
    ['Others zei ja', { Others: 'Bob' }],
  ];
  for (const [text, names] of cases) {
    it(`gives the displayed text for: ${text}`, () => {
      const toks = fromText(text);
      const out = applySpeakerNamesToTokens(toks, names);
      expect(out).toHaveLength(toks.length);
      expect(shown(out)).toBe(applySpeakerNames(text, names).replace(/ +/g, ' ').trim());
    });
  }
});

describe('applySpeakerNamesToDocument', () => {
  const doc: FoldDocument = {
    schemaVersion: 2,
    sourceHash: 'h',
    provenance: 'ai',
    sections: [
      {
        id: 's1',
        title: 'Acties van Speaker 2',
        full: '- Speaker 2 belt',
        lad: { take: [tok('Speaker', 1), tok('2')], topic: [0] },
        units: [
          {
            kind: 'item',
            marker: '-',
            src: '- Speaker 2 belt',
            full: 'Speaker 2 belt',
            toks: [tok('Speaker', 1), tok('2', 1), tok('belt')],
            sents: [[0, 3]],
            lad: {
              role: 'claim', ev: [0], tn: 2, model: 'ai',
              brief: [tok('Speaker', 1, { m: 0 }), tok('2', 1, { m: 1 }), tok('belt')],
              topic: [tok('Speaker', 1, { k: 0 }), tok('2', undefined, { k: 1 })],
            },
          },
        ],
      },
    ],
  };

  it('names the units, the AI levels, the section line and the title, and leaves the stored document alone', () => {
    const before = JSON.stringify(doc);
    const shown = applySpeakerNamesToDocument(doc, NAMES);
    expect(JSON.stringify(doc)).toBe(before);
    expect(shown.sections[0].title).toBe('Acties van Anna de Vries');
    expect(shown.sections[0].units[0].toks[0].t).toBe('Anna de Vries');
    expect(shown.sections[0].units[0].lad?.brief[0].t).toBe('Anna de Vries');
    expect(shown.sections[0].units[0].lad?.topic[0].t).toBe('Anna de Vries');
    expect(shown.sections[0].lad?.take[0].t).toBe('Anna de Vries');
    expect(shown.sections[0].units[0].full).toBe('Anna de Vries belt');
    expect(shown.sections[0].units[0].toks).toHaveLength(3);
    expect(shown.sourceHash).toBe('h');
  });

  it('returns the same document without a mapping', () => {
    expect(applySpeakerNamesToDocument(doc, {})).toBe(doc);
  });
});

const SPECIAL = { 'Speaker 2': 'Jan_de_Vries', 'Speaker 3': 'A*b [x] c' };
const join = (toks: FoldToken[]) => toks.map((t) => t.t + (t.s ? ' ' : '')).join('');
const fromWords = (text: string): FoldToken[] =>
  (text.match(/\S+/g) ?? []).map((word, i, all) => (i < all.length - 1 ? { t: word, s: 1 as const } : { t: word }));

describe('plain text and tokens get the name as typed; only markdown strings are escaped', () => {
  it('plain text, lists and tokens keep _ * [ ] literally', () => {
    expect(applySpeakerNames('Speaker 2 en Speaker 3', SPECIAL)).toBe('Jan_de_Vries en A*b [x] c');
    expect(applySpeakerNamesToList(['Speaker 2', 'Speaker 3'], SPECIAL)).toEqual(['Jan_de_Vries', 'A*b [x] c']);
    const out = applySpeakerNamesToTokens(fromWords('Speaker 2 belt Speaker 3'), SPECIAL);
    expect(out[0].t).toBe('Jan_de_Vries');
    expect(join(out)).not.toContain('\\');
  });

  it('the markdown variant escapes the same name', () => {
    expect(applySpeakerNamesMarkdown('Speaker 2 en Speaker 3', SPECIAL)).toBe('Jan\\_de\\_Vries en A\\*b \\[x\\] c');
  });

  it('plain text for a participants chip, a section title and a plain-text copy has no backslash', async () => {
    const { buildNotesCopyText } = await import('./notesCopy');
    const sections = {
      name: 'n',
      discussionAreas: [{ title: applySpeakerNames('Acties van Speaker 2', SPECIAL), analysis: applySpeakerNames('Speaker 3 belt', SPECIAL) }],
      keyPoints: applySpeakerNamesToList(['Speaker 2 stuurt'], SPECIAL),
      actionItems: applySpeakerNamesToList(['Speaker 3 plant'], SPECIAL),
      participants: applySpeakerNamesToList(['Speaker 2', 'Speaker 3'], SPECIAL),
    };
    const copy = buildNotesCopyText(sections as never, null);
    expect(sections.participants).toEqual(['Jan_de_Vries', 'A*b [x] c']);
    expect(copy).toContain('Jan_de_Vries, A*b [x] c');
    expect(copy).not.toContain('\\');
  });

  it('the document gives the reader plain names in tokens, ladders, titles and full text', () => {
    const doc = {
      schemaVersion: 2, sourceHash: 'h', provenance: 'ai',
      sections: [{
        id: 's', title: 'Speaker 2', full: 'Speaker 2 belt',
        lad: { take: fromWords('Speaker 2:'), topic: [0] },
        units: [{ kind: 'p', src: 'Speaker 2 belt', full: 'Speaker 2 belt', toks: fromWords('Speaker 2: belt'), sents: [[0, 3]],
          lad: { role: 'claim', ev: [0], tn: 2, model: 'ai', brief: fromWords('Speaker 2: belt'), topic: fromWords('Speaker 2') } }],
      }],
    } as unknown as FoldDocument;
    const shown = applySpeakerNamesToDocument(doc, SPECIAL);
    expect(JSON.stringify(shown)).not.toContain('\\\\');
    expect(shown.sections[0].title).toBe('Jan_de_Vries');
    expect(shown.sections[0].units[0].toks.map((t) => t.t)).toEqual(['Jan_de_Vries', ':', 'belt']);
  });
});

describe('labels that end inside a whitespace token (attached punctuation)', () => {
  const NM = { 'Speaker 2': 'Anna', 'Speaker 3': 'Bob' };
  const texts = [
    'Speaker 2: belt', 'Speaker 2. Daarna', 'Speaker 2, ja', "Speaker 2's plan", '**Speaker 2**: zegt', '[Speaker 2](https://e.com/x) hier',
    '"Speaker 2" zei', '(Speaker 2) en (Speaker 3)', 'Speaker 2; Speaker 3!', 'Speaker 2/Speaker 3', '_Speaker 2_ ja', 'SPEAKER_02: ja', 'Speaker 2?',
  ];
  for (const text of texts) {
    it(`reader and text agree for: ${text}`, () => {
      const toks = fromWords(text);
      const out = applySpeakerNamesToTokens(toks, NM);
      expect(out).toHaveLength(toks.length);
      expect(join(out)).toBe(applySpeakerNames(text, NM));
      expect(join(out)).not.toMatch(/speaker/i);
    });
  }

  it('keeps the punctuation as its own text and the name on the first token', () => {
    const out = applySpeakerNamesToTokens(fromWords('Speaker 4: belt'), { 'Speaker 4': 'Jan' });
    expect(out.map((t) => t.t)).toEqual(['Jan', ':', 'belt']);
    expect(join(out)).toBe('Jan: belt');
  });

  it('keeps m and k of tokens that only lose their label text', () => {
    const out = applySpeakerNamesToTokens([tok('Speaker', 1, { m: 3 }), tok('2:', 1, { m: 4 }), tok('ja')], NM);
    expect(out[0]).toMatchObject({ t: 'Anna', m: 3 });
    expect(out[1]).toMatchObject({ t: ':', s: 1, m: 4 });
  });

  it('does not change tokens that merely look similar', () => {
    const toks = fromWords('Speaker 20: belt en Loudspeaker 2: ja');
    expect(join(applySpeakerNamesToTokens(toks, NM))).toBe('Speaker 20: belt en Loudspeaker 2: ja');
  });
});

describe('separators and numbers', () => {
  const NM = { 'Speaker 2': 'Anna', 'Speaker 3': 'Bob' };
  it('replaces both labels in Speaker 2/Speaker 3', () => {
    expect(applySpeakerNames('Speaker 2/Speaker 3', NM)).toBe('Anna/Bob');
    expect(applySpeakerNames('met Speaker 2/Speaker 3 samen', NM)).toBe('met Anna/Bob samen');
  });
  it('still protects URLs and paths after the slash rule', () => {
    const text = 'https://e.com/Speaker_2 en /Users/x/Speaker_2.md en input/Speaker_2.md en dir2/Speaker 3.md';
    expect(applySpeakerNames(text, NM)).toBe(text);
  });
  it('does not read Speaker 2-3 as the label Speaker 2', () => {
    expect(applySpeakerNames('Speaker 2-3', NM)).toBe('Speaker 2-3');
    expect(applySpeakerNames('Speakers 2-3 en Speaker 2-3 en Speaker 2 - Speaker 3', NM)).toBe('Speakers 2-3 en Speaker 2-3 en Anna - Bob');
    expect(join(applySpeakerNamesToTokens(fromWords('Speaker 2-3 belt'), NM))).toBe('Speaker 2-3 belt');
  });
});
