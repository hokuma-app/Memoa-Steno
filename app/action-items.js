'use strict';
// JavaScript twin of src/action_items.py (parse_action_entries): the same rules, checked against the same cases
// (tests/fixtures/action_item_cases.json). An action item the model split over lines (owner and date, then the task on
// an indented line) is read as one item; an item with only an owner and a date is left out. Display only: nothing here
// writes a note.

const BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+(\S.*)$/;
const CHECKBOX = /^\[([ xX])\]\s*([\s\S]*)$/;
// A deadline marker holds a date or the words as spoken ("(due vrijdag)"); "(due to the delay)" is ordinary text.
const DUE_G = /\(\s*(?:(?:due|deadline)\b\s*:?\s*(?!to\b|diligence\b|date\b)|by\s*:?\s*(?=\d{4}-\d{2}-\d{2}))([^()\n]{0,60}?)\s*\)/gi;
const DUE_EMPTY = new Set(['', 'yyyy-mm-dd', 'unknown', 'n/a', 'na', 'none', 'null', 'tbd', 'tba', 'not stated', 'not specified', '-', '\u2014']);
const SPEAKER_LABEL = /^(?:speaker|spreker)s?[ _]?\d+$/i;
const GROUPS = new Set([
  'team', 'team members', 'the team', 'het team', 'teamleden', 'teamlid', 'management', 'het management',
  'everyone', 'everybody', 'all', 'iedereen', 'allen', 'directie', 'de directie', 'mt', 'staff',
  'medewerkers', 'attendees', 'participants', 'deelnemers', 'aanwezigen', 'both', 'beiden',
]);
const PARTICLES = new Set(['de', 'den', 'der', 'van', 'von', 'ten', 'ter', 'te', 'het', "'t", 'la', 'le', 'du', 'da', 'di', 'al', 'el']);
const OWN_OWNER = /^(?:\*\*[^*\n]{1,60}?(?::\*\*|\*\*:)|\[[^[\]\n]{1,60}\]:|[^:\n(]{1,40}:)\s+\S/;

const expand = indent => indent.replace(/\t/g, '  ').length;
const isUpper = ch => ch !== ch.toLowerCase() && ch === ch.toUpperCase();

function splitDue(text) {
  const found = [...text.matchAll(DUE_G)].map(m => m[1].trim()).filter(f => !DUE_EMPTY.has(f.toLowerCase().replace(/^[ .]+|[ .]+$/g, '')));
  const stripped = text.replace(DUE_G, '').replace(/\s{2,}/g, ' ').trim();
  return [stripped, found.length ? found[found.length - 1] : null];
}

function ownerOf(rest) {
  let s = rest.trim();
  let marked = false;
  let m;
  if ((m = /^\*\*(.+?):\*\*$/.exec(s)) || (m = /^\*\*(.+?)\*\*:?$/.exec(s)) || (m = /^\[(.+?)\]:?$/.exec(s))) {
    s = m[1].trim(); marked = true;
  } else if (s.endsWith(':')) {
    s = s.slice(0, -1).trim(); marked = true;
  }
  if (!s) return ['', 'strong'];
  const words = s.split(/\s+/);
  if (s.length > 60 || s.includes(':') || words.length > 6) return [null, null];
  if (marked || SPEAKER_LABEL.test(s) || GROUPS.has(s.toLowerCase())) return [s, 'strong'];
  if (words.length <= 3 && isUpper(words[0][0]) && words.every(w => isUpper(w[0]) || PARTICLES.has(w.toLowerCase()))) return [s, 'weak'];
  return [null, null];
}

function plain(text) {
  text = text.trim();
  const b = BULLET.exec(text);
  if (b) text = b[2].trim();
  const c = CHECKBOX.exec(text);
  return c ? c[2].trim() : text;
}

const assemble = (owner, task, due) => {
  const out = owner ? `${owner}: ${task}` : task;
  return due ? `${out} (due ${due})` : out;
};

function parseActionEntries(lines) {
  const rows = [...lines].map(l => String(l).replace(/[\r\n]+$/, ''));
  let base = null;
  for (const row of rows) {
    const m = BULLET.exec(row);
    if (m) { base = expand(m[1]); break; }
  }
  if (base === null) return { entries: [], dropped: 0 };

  const heads = [];
  let i = 0;
  while (i < rows.length) {
    const m = BULLET.exec(rows[i]);
    if (!m || expand(m[1]) > base) { i += 1; continue; }
    let text = m[2].trim();
    let checked = false;
    const c = CHECKBOX.exec(text);
    if (c) { checked = c[1] === 'x' || c[1] === 'X'; text = c[2].trim(); }
    const cont = [];
    const nested = [];
    let j = i + 1;
    while (j < rows.length && rows[j].trim()) {
      const row = rows[j];
      const nb = BULLET.exec(row);
      if (nb && expand(nb[1]) <= base) break;
      if (!nb && row.length - row.trimStart().length <= base) break;
      (nb ? nested : cont).push(row);
      j += 1;
    }
    heads.push({ checked, text, cont, nested });
    i = j;
  }

  const resolved = [];
  for (const { checked, text, cont, nested } of heads) {
    const [headRest, headDue] = splitDue(text);
    const [owner, strength] = ownerOf(headRest);
    const hasChildren = cont.length > 0 || nested.length > 0;
    const ownerOnly = owner !== null && (strength === 'strong' || (hasChildren && (strength === 'weak' || Boolean(headDue))));
    if (ownerOnly && hasChildren) {
      const parts = [...cont.map(p => p.trim()), ...nested.map(plain)];
      const [task, due] = splitDue(parts.filter(Boolean).join(' '));
      if (task) { resolved.push({ entry: { checked, text: assemble(owner, task, headDue || due), nested: [], merged: true } }); continue; }
    }
    if (ownerOnly) { resolved.push({ pending: { checked, owner, due: headDue } }); continue; }
    let entryText = text;
    let merged = false;
    if (cont.length) {
      const [body, due] = splitDue([text, ...cont.map(p => p.trim())].join(' '));
      entryText = due ? `${body} (due ${due})` : body;
      merged = true;
    }
    resolved.push({ entry: { checked, text: entryText, nested: nested.map(plain), merged } });
  }

  const entries = [];
  let dropped = 0;
  resolved.forEach((item, index) => {
    if (item.entry) { entries.push(item.entry); return; }
    const { checked, owner, due } = item.pending;
    const following = resolved[index + 1] && resolved[index + 1].entry;
    if (following && !following.merged && !OWN_OWNER.test(following.text)) {
      const [body, ownDue] = splitDue(following.text);
      following.text = assemble(owner, body, ownDue || due);
      following.checked = following.checked || checked;
      following.merged = true;
      return;
    }
    dropped += 1;
  });
  return { entries, dropped };
}

// The display strings of a note's action items: whole items, then any nested bullets of an item with its own task.
function actionItemTexts(lines) {
  const out = [];
  for (const entry of parseActionEntries(lines).entries) {
    out.push(entry.text, ...entry.nested);
  }
  return out;
}

module.exports = { parseActionEntries, actionItemTexts };
