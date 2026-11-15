/**
 * Speaker labels in a note become the name the app has linked to them.
 *
 * The host reads which label is now which name from what the app already stores (`speaker_label_names` on the
 * meeting: `{ "Speaker 2": "Anna" }`, see app/speaker-label-names.js). A saved summary keeps writing "Speaker 2";
 * this module replaces it only when the note is shown or copied, so linking a name afterwards (or taking it back)
 * changes what is shown at once and the file on disk stays as it was.
 *
 * "Speaker 2" is recognised as the app writes it and as small models write it: Speaker 2, speaker 2, Spreker 2,
 * SPEAKER_02, Speaker_2. The number must be the whole number: "Speaker 2" never touches "Speaker 20". Generic labels
 * (You, Others) are never replaced as words, and nothing changes inside code, URLs or file paths.
 */
import type { FoldDocument, FoldLadder, FoldToken, FoldUnit, FoldSection } from './summaryFoldingContracts';

export type SpeakerLabelNames = Record<string, string>;

const LABEL_NUMBER = /^(?:speaker|spreker)[ _]?(\d+)$/i;

// Only numbered labels are replaced. A generic label (You, Others, Jij, Anderen) is an ordinary word in running text
// ("Do you agree?"), so it never becomes a name here, wherever the mapping comes from.
// A "/" before the label only keeps it from being a path when it does not follow another label ("Speaker 2/Speaker 3").
// A number followed by "-digit" ("Speaker 2-3", a range) is not a label.
const LABEL = /(?<![\p{L}\p{N}\\@])(?<!(?<!(?:speaker|spreker)[ _]?\d+)\/)(?:speaker|spreker)[ _]?(\d+)(?![\p{L}\p{N}])(?!\.[\p{L}\p{N}])(?!-\p{N})/u;
// Text that is not prose and stays as it is: code blocks, inline code, URLs and file paths (also file names).
const PROTECTED = [
  /\x60{3}[\s\S]*?(?:\x60{3}|$)/u,
  /\x60{2}[^\n]*?\x60{2}/u,
  /\x60[^\x60\n]*\x60/u,
  /(?:https?|ftp|file):\/\/[^\s<>]+/u,
  /www\.[^\s<>]+/u,
  /[A-Za-z]:\\[^\s]+/u,
  /(?<![\p{L}\p{N}_])(?:~|\.{1,2})?(?:\/[\p{L}\p{N}_.@%+~-]+)+\/?/u,
];
const SCAN_SOURCE = '(' + PROTECTED.map((re) => re.source).join('|') + ')|' + LABEL.source;

/** Markdown characters in a name are escaped, so a name can never become a link, emphasis, code or HTML. */
const escapeMarkdown = (text: string) => text.replace(/[\\`*_~[\]<>#|]/g, '\\$&');

interface Replacer {
  plain: Map<number, string>;
  markdown: Map<number, string>;
}

const cache = new WeakMap<object, Replacer>();

function replacerFor(names: SpeakerLabelNames): Replacer {
  const hit = cache.get(names);
  if (hit) return hit;
  const plain = new Map<number, string>();
  const markdown = new Map<number, string>();
  for (const [label, name] of Object.entries(names)) {
    if (typeof name !== 'string' || !name.trim()) continue;
    const m = LABEL_NUMBER.exec(label.trim());
    if (m) {
      plain.set(parseInt(m[1], 10), name);
      markdown.set(parseInt(m[1], 10), escapeMarkdown(name));
    }
  }
  const made = { plain, markdown };
  cache.set(names, made);
  return made;
}

export const hasSpeakerNames = (names: SpeakerLabelNames | null | undefined): names is SpeakerLabelNames =>
  Boolean(names) && Object.values(names as object).some((name) => typeof name === 'string' && name.trim());

interface Span { start: number; end: number; name: string }

/** The one rule for text and tokens: where a linked numbered label stands outside protected text, in a single pass. */
function labelSpans(text: string, named: Map<number, string>): Span[] {
  const spans: Span[] = [];
  for (const m of text.matchAll(new RegExp(SCAN_SOURCE, 'giu'))) {
    if (m[1] !== undefined) continue;
    const name = named.get(parseInt(m[2], 10));
    if (name !== undefined) spans.push({ start: m.index, end: m.index + m[0].length, name });
  }
  return spans;
}

function replaceLabels(text: string, names: SpeakerLabelNames | null | undefined, escaped: boolean): string {
  if (!text || !hasSpeakerNames(names)) return text;
  const spans = labelSpans(text, (escaped ? replacerFor(names).markdown : replacerFor(names).plain));
  if (!spans.length) return text;
  let out = '';
  let at = 0;
  for (const span of spans) {
    out += text.slice(at, span.start) + span.name;
    at = span.end;
  }
  return out + text.slice(at);
}

/**
 * The text with every linked speaker label replaced by its name, as typed; unlinked labels stay. For everything that
 * is shown or copied as plain text: chips, titles, the reader's tokens, plain-text copies and the PDF's own escaping.
 */
export const applySpeakerNames = (text: string, names: SpeakerLabelNames | null | undefined): string =>
  replaceLabels(text, names, false);

/** The same for a string that is rendered as Markdown: the name's Markdown characters are escaped. */
export const applySpeakerNamesMarkdown = (text: string, names: SpeakerLabelNames | null | undefined): string =>
  replaceLabels(text, names, true);

export const applySpeakerNamesToList = (items: readonly string[], names: SpeakerLabelNames | null | undefined): string[] =>
  items.map((item) => applySpeakerNames(item, names));

/** A stable key for a mapping, so a view only rebuilds when a name really changed. */
export const speakerNamesKey = (names: SpeakerLabelNames | null | undefined): string =>
  hasSpeakerNames(names) ? JSON.stringify(Object.entries(names).sort(([a], [b]) => a.localeCompare(b))) : '';

/**
 * Replaces a label inside a token stream without changing its length (the fold reader and the ladders refer to tokens
 * by index). Tokens are whitespace tokens with punctuation attached ("Speaker 4: belt" = Speaker, 4:, belt), so a
 * label can end (or start) inside a token. The matched part is replaced inside its token and the punctuation stays:
 * the first token of the label carries the name, the rest of the label becomes empty text. The labels are found by
 * the same rule as in `applySpeakerNames` (same regex over the joined tokens), so the joined result equals the text.
 * Names are plain: the reader renders text, not Markdown.
 */
export function applySpeakerNamesToTokens(tokens: readonly FoldToken[], names: SpeakerLabelNames | null | undefined): FoldToken[] {
  if (!hasSpeakerNames(names)) return tokens as FoldToken[];
  const out = tokens.map((token) => ({ ...token }));
  const starts: number[] = [];
  let text = '';
  for (const token of out) {
    starts.push(text.length);
    text += token.t + (token.s ? ' ' : '');
  }
  const spans = labelSpans(text, replacerFor(names).plain);
  if (!spans.length) return out;
  let from = 0;
  for (let i = 0; i < out.length; i += 1) {
    const begin = starts[i];
    const end = begin + tokens[i].t.length;
    while (from < spans.length && spans[from].end <= begin) from += 1;
    let t = '';
    let cursor = begin;
    let continues = false;
    let touched = false;
    for (let k = from; k < spans.length && spans[k].start < end; k += 1) {
      const span = spans[k];
      touched = true;
      t += text.slice(cursor, Math.max(span.start, begin));
      if (span.start >= begin) t += span.name;
      cursor = Math.min(span.end, end);
      if (span.end > end) continues = true;
    }
    if (!touched) continue;
    out[i].t = t + text.slice(cursor, end);
    if (continues) delete out[i].s; // the label goes on in the next token: no space inside the name
  }
  return out;
}

function ladder(lad: FoldLadder | undefined, names: SpeakerLabelNames): FoldLadder | undefined {
  if (!lad) return lad;
  return { ...lad, brief: applySpeakerNamesToTokens(lad.brief, names), topic: applySpeakerNamesToTokens(lad.topic, names) };
}

/** A fold document as shown: names in every unit, level and title; the stored document is not touched. */
export function applySpeakerNamesToDocument(doc: FoldDocument, names: SpeakerLabelNames | null | undefined): FoldDocument {
  if (!hasSpeakerNames(names)) return doc;
  const sections: FoldSection[] = doc.sections.map((section) => ({
    ...section,
    title: applySpeakerNames(section.title, names),
    full: applySpeakerNames(section.full, names),
    lad: section.lad
      ? { ...section.lad, take: applySpeakerNamesToTokens(section.lad.take, names) }
      : section.lad,
    units: section.units.map((unit): FoldUnit => ({
      ...unit,
      src: applySpeakerNames(unit.src, names),
      full: applySpeakerNames(unit.full, names),
      toks: applySpeakerNamesToTokens(unit.toks, names),
      lad: ladder(unit.lad, names),
    })),
  }));
  return { ...doc, sections };
}
