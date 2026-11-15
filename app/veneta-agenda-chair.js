'use strict';
/**
 * Agenda en voorzitter, stand 1 (Stille voorzitter): the pure host side.
 *
 * - parseAgenda: deterministic, model-free parsing of pasted text or a .md/.txt file into agenda items.
 * - validateAgenda: the strict shape of an agenda the host stores and prepares.
 * - signalsOf / timing: what the silent chair shows (time against the time block, missing outcome, ...).
 * - createAgendaPlanner: per recording, in the main process, like the live checklist planner (0.9.4). It plans the
 *   local-model check on final live segments only, single flight, bounded input (newest contiguous tail), and keeps
 *   the meeting state (running item, time per item, findings). The renderer only shows what this planner pushes.
 *   After stopping it checks the open questions once more over the whole conversation (0.11.0): which were answered
 *   later. Within the same bounds; a longer conversation is read as its newest tail, and the minutes say so.
 *
 * The agenda and everything participants say are source data, never instructions: nothing here executes, mails,
 * calls Hermes or any tool. The chair has no utterances of its own in stand 1.
 *
 * Content-free diagnostics: log events carry counters and reason codes only, never transcript text, titles or quotes.
 */
const crypto = require('node:crypto');
const { mapFinals, liveSessionId } = require('./veneta-live-checklist');

const OUTCOMES = Object.freeze(['besluit', 'informatie', 'discussie', 'actie']);
const STATUSES = Object.freeze(['open', 'loopt', 'afgerond', 'overgeslagen', 'doorgeschoven']);
const KINDS = Object.freeze(['besluit', 'actie', 'vraag']);
const ACTIONS = Object.freeze(['start', 'finish', 'skip', 'defer', 'confirmSuggestion', 'dismissSuggestion', 'undoSwitch']);
const LIMITS = Object.freeze({
  items: 32, sourceChars: 24_000, titleChars: 200, agendaTitleChars: 120, ownerChars: 80, minutes: 480,
  segments: 256, characters: 24_000, requestChars: 100_000, findings: 400, findingsPerCheck: 48,
  findingText: 300, dueChars: 80, context: 6, recentAssessed: 1024, dismissed: 256, questions: 64,
});
/** The state of the question check after stopping (0.11.0). */
const QUESTION_REVIEW_STATUSES = Object.freeze(['done', 'failed', 'tooLarge']);
const STABLE_MS = 10_000;
const MAX_WAIT_MS = 30_000;
const FINAL_GRACE_MS = 3_000;
const DRAIN_MAX_MS = 5_500;
const BUSY_RETRY_MS = 5_000;
/** tijd_bijna_om from 80% of the time block, tijd_om from 100%. */
const NEAR_RATIO = 0.8;
/** vereist_punt_open: less than ten minutes left of the total planned time. */
const REQUIRED_MARGIN_MS = 10 * 60_000;

const clone = (value) => JSON.parse(JSON.stringify(value));
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const onlyKeys = (value, keys) => object(value) && Object.keys(value).every((key) => keys.includes(key));
const norm = (text) => String(text).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const squash = (text) => String(text).replace(/\s+/g, ' ').trim();

// A citation is at least three characters and starts and ends on word boundaries inside its segment (same rule as the
// checklist, in the renderer, the host and the Python backend).
const WORD = '[\\p{L}\\p{N}_]';
function wholeWordQuote(text, quote) {
  if (typeof quote !== 'string' || typeof text !== 'string' || quote.trim().length < 3) return false;
  const escaped = quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const head = new RegExp(`^${WORD}`, 'u').test(quote) ? `(?<!${WORD})` : '';
  const tail = new RegExp(`${WORD}$`, 'u').test(quote) ? `(?!${WORD})` : '';
  return new RegExp(head + escaped + tail, 'u').test(text);
}
/** A name or term counts as said when it occurs as whole words (case-insensitive) in the text. */
function saidIn(text, phrase) {
  if (typeof phrase !== 'string' || phrase.trim().length < 2) return false;
  const escaped = norm(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<!${WORD})${escaped}(?!${WORD})`, 'u').test(norm(text));
}

// ---------------------------------------------------------------------------------------------------------------
// Parsing (deterministic, no model)
// ---------------------------------------------------------------------------------------------------------------

const NAME_WORD = "\\p{Lu}[\\p{L}'’.-]*";
const PARTICLE = '(?:van|de|der|den|ter|ten|het|te|in|op|v\\.d\\.)';
const NAME = `${NAME_WORD}(?:\\s+(?:${PARTICLE}|${NAME_WORD})){0,3}`;
const NAME_ONLY = new RegExp(`^${NAME}$`, 'u');
const OWNER_LABEL = new RegExp(`^(?:eigenaar|inleider|trekker|owner|door|wie|presentatie|spreker)\\s*[:=]?\\s*(${NAME})$`, 'iu');
const OWNER_INLINE_CI = /(?:^|\s)(?:eigenaar|inleider|trekker|owner)\s*[:=]\s*/i;
const OWNER_BY = new RegExp(`(?:^|\\s)door\\s+(${NAME})\\s*$`, 'u');
const OWNER_AT = /(?:^|\s)@([\p{L}][\p{L}'’.-]*)/u;
const REQUIRED_WORD = /^(?:vereist|verplicht|required|must|moet)$/i;
const TIME_PART = /^(\d{1,3}(?:[.,]\d)?)\s*(?:min(?:uten|uut|\.)?|m|minutes?|')$|^(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:uur|u|h|hours?)$/i;
const TIME_ANY = /(?:^|[\s(,[–—-])(\d{1,3}(?:[.,]\d)?)\s*(?:min(?:uten|uut|\.)?|m|minutes?|')(?=$|[\s),\].;–—-])|(?:^|[\s(,[–—-])(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:uur|u|h|hours?)(?=$|[\s),\].;–—-])/gi;
const TIME_RANGE = /(?:^|\s)(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})(?:\s*uur)?(?=$|\s)/;
const OUTCOME_TAGS = [
  [/^(?:ter\s+)?besluit(?:vorming)?$|^besluiten$|^decision$|^beslissen$/i, 'besluit'],
  [/^(?:ter\s+)?info(?:rmatie)?$|^mededeling(?:en)?$|^informeren$/i, 'informatie'],
  [/^(?:ter\s+)?(?:discussie|bespreking)$|^bespreken$|^overleg$|^discussion$/i, 'discussie'],
  [/^actie(?:s|punt|punten)?$|^action$/i, 'actie'],
];
const OUTCOME_FROM_TITLE = [
  [/(?<![\p{L}])(?:besluit|besluiten|besluitvorming|vaststellen|vaststelling|goedkeuren|goedkeuring|kiezen|keuze)(?![\p{L}])/iu, 'besluit'],
  [/(?<![\p{L}])(?:actiepunten|actielijst|acties)(?![\p{L}])/iu, 'actie'],
  [/(?<![\p{L}])(?:mededelingen|ter\s+info(?:rmatie)?|stand\s+van\s+zaken|update|terugkoppeling)(?![\p{L}])/iu, 'informatie'],
];
const METADATA = /^\s*(?:datum|tijd|locatie|plaats|aanwezig|afwezig|voorzitter|notulist|notulen\s+door|deelnemers|genodigden|afmeldingen|ruimte|link)\s*:/i;
const LIST = /^(\s*)(?:(\d{1,3})[.)]|[-*+•–]|[a-zA-Z][.)])\s+(?:\[[ xX]?\]\s+)?(.*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const TABLE_ROW = /^\s*\|(.*)\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const minutesOf = (amount, hours) => {
  const value = Number(String(amount).replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  const minutes = Math.round(hours ? value * 60 : value);
  return minutes >= 1 && minutes <= LIMITS.minutes ? minutes : null;
};
const timeOfPart = (part) => {
  const match = TIME_PART.exec(part.trim());
  if (!match) return null;
  return match[1] !== undefined ? minutesOf(match[1], false) : minutesOf(match[2], true);
};
const outcomeOfTag = (part) => {
  const text = part.trim();
  for (const [pattern, outcome] of OUTCOME_TAGS) if (pattern.test(text)) return outcome;
  return null;
};
const cleanTitle = (text) => squash(text.replace(/\(\s*\)|\[\s*\]/g, ' '))
  .replace(/^[\s\-–—|:;,.·*]+/, '').replace(/[\s\-–—|:;,·*]+$/, '').trim();

/**
 * One item line (without list marker) to fields. Recognised, and removed from the title: a time block ('10 min',
 * '(15m)', '1 uur', '10:00-10:15'), an owner ('Eigenaar: Sanne', 'door Sanne', '@Sanne', '(Sanne)' or a name-like
 * part next to another recognised part), 'vereist'/'verplicht' and an outcome tag ('(besluit)', 'ter info').
 * Unrecognised text stays in the title. Without a tag the outcome follows a few title words, otherwise 'discussie'.
 */
function parseItemText(raw) {
  let text = ` ${String(raw).replace(/\s+/g, ' ')} `;
  const found = { minutes: null, owner: null, required: false, outcome: null };
  const setOwner = (name) => { if (!found.owner) found.owner = squash(name).slice(0, LIMITS.ownerChars); };
  if (/^\s*!/.test(text)) { found.required = true; text = text.replace(/^\s*!\s*/, ' '); }
  if (/\*\s*$/.test(text) && !/\*\*\s*$/.test(text)) { found.required = true; text = text.replace(/\*\s*$/, ' '); }
  text = text.replace(/\*\*|__/g, ' ');
  const range = TIME_RANGE.exec(text);
  if (range) {
    const from = Number(range[1]) * 60 + Number(range[2]);
    const to = Number(range[3]) * 60 + Number(range[4]);
    if (to > from && to - from <= LIMITS.minutes) found.minutes = to - from;
    text = text.replace(range[0], ' ');
  }
  // Bracket groups: every part must be recognised for the group to be removed.
  text = text.replace(/[([]([^()[\]]{1,80})[)\]]/g, (whole, inner) => {
    const parts = inner.split(/\s*[,;·|/]\s*/).filter((part) => part.trim());
    const plan = [];
    for (const part of parts) {
      const minutes = timeOfPart(part);
      if (minutes !== null) { plan.push(['minutes', minutes]); continue; }
      if (REQUIRED_WORD.test(part.trim())) { plan.push(['required', true]); continue; }
      const outcome = outcomeOfTag(part);
      if (outcome) { plan.push(['outcome', outcome]); continue; }
      const label = OWNER_LABEL.exec(part.trim());
      if (label) { plan.push(['owner', label[1]]); continue; }
      if (NAME_ONLY.test(part.trim()) && !/\d/.test(part)) { plan.push(['owner', part.trim()]); continue; }
      return whole;
    }
    if (!plan.length) return whole;
    for (const [key, value] of plan) {
      if (key === 'owner') setOwner(value);
      else if (key === 'minutes') { if (found.minutes === null) found.minutes = value; }
      else if (key === 'outcome') { if (!found.outcome) found.outcome = value; }
      else found.required = true;
    }
    return ' ';
  });
  // Separated parts: 'Begroting 2027 – 20 min – Sanne' or a table-like '|'.
  const parts = text.split(/\s[|–—-]\s|\s[|]|[|]\s/).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    const keep = [parts[0]]; const names = []; let other = false;
    for (const part of parts.slice(1)) {
      const minutes = timeOfPart(part);
      if (minutes !== null) { if (found.minutes === null) found.minutes = minutes; other = true; continue; }
      if (REQUIRED_WORD.test(part)) { found.required = true; other = true; continue; }
      const outcome = outcomeOfTag(part);
      if (outcome) { if (!found.outcome) found.outcome = outcome; other = true; continue; }
      const label = OWNER_LABEL.exec(part);
      if (label) { setOwner(label[1]); other = true; continue; }
      if (NAME_ONLY.test(part) && !/\d/.test(part)) { names.push(part); continue; }
      keep.push(part);
    }
    // A bare name is only an owner next to another recognised part; 'Opening - Welkom' stays a title.
    if (other && names.length) setOwner(names[names.length - 1]);
    else keep.push(...names);
    text = ` ${keep.join(' - ')} `;
  }
  // A loose time block anywhere: the last one counts ('Begroting 2027 15 min').
  if (found.minutes === null) {
    let last = null;
    for (const match of text.matchAll(TIME_ANY)) last = match;
    if (last) {
      found.minutes = last[1] !== undefined ? minutesOf(last[1], false) : minutesOf(last[2], true);
      text = text.slice(0, last.index) + ' ' + text.slice(last.index + last[0].length);
    }
  }
  const inline = OWNER_INLINE_CI.exec(text);
  if (inline) {
    const rest = text.slice(inline.index + inline[0].length);
    const name = new RegExp(`^(${NAME})`, 'u').exec(rest);
    if (name) { setOwner(name[1]); text = text.slice(0, inline.index) + ' ' + rest.slice(name[1].length); }
  }
  const by = OWNER_BY.exec(text);
  if (by) { setOwner(by[1]); text = text.slice(0, by.index) + ' '; }
  const at = OWNER_AT.exec(text);
  if (at) { setOwner(at[1]); text = text.replace(at[0], ' '); }
  text = text.replace(/(?:^|\s)(?:vereist|verplicht)(?=\s*$)/i, () => { found.required = true; return ' '; });
  const tagged = /(?:^|\s)(?:ter\s+(?:besluitvorming|info(?:rmatie)?|bespreking))(?=\s*$)/i.exec(text);
  if (tagged) { if (!found.outcome) found.outcome = outcomeOfTag(tagged[0]); text = text.slice(0, tagged.index) + ' '; }
  const title = cleanTitle(text).slice(0, LIMITS.titleChars);
  if (!found.outcome) {
    for (const [pattern, outcome] of OUTCOME_FROM_TITLE) if (pattern.test(title)) { found.outcome = outcome; break; }
  }
  return { title, outcome: found.outcome || 'discussie', minutes: found.minutes, owner: found.owner, required: found.required };
}

/** A markdown table with a header row: columns are recognised by their header names. */
function parseTable(rows) {
  const cells = (row) => TABLE_ROW.exec(row)[1].split('|').map((cell) => cell.trim());
  const header = cells(rows[0]).map((cell) => norm(cell));
  const column = (pattern) => header.findIndex((cell) => pattern.test(cell));
  const columns = {
    title: column(/^(?:onderwerp|agendapunt|punt|titel|item|wat)$/),
    minutes: column(/^(?:tijd|duur|min(?:uten)?|tijdsblok|minutes)$/),
    owner: column(/^(?:eigenaar|wie|inleider|door|trekker|owner)$/),
    outcome: column(/^(?:uitkomst|doel|type|soort)$/),
    required: column(/^(?:vereist|verplicht|required)$/),
  };
  if (columns.title < 0) columns.title = header.findIndex((cell, index) => !/^(?:nr|#|no|nummer)?\.?$/.test(cell) && !Object.values(columns).includes(index));
  if (columns.title < 0) return [];
  const items = [];
  for (const row of rows.slice(2)) {
    if (!TABLE_ROW.test(row) || TABLE_RULE.test(row)) continue;
    const values = cells(row);
    const base = parseItemText(values[columns.title] || '');
    if (!base.title) continue;
    const pick = (index) => (index >= 0 && values[index] ? values[index] : '');
    const minutes = pick(columns.minutes) ? timeOfPart(pick(columns.minutes)) ?? minutesOf(pick(columns.minutes).replace(/[^\d.,]/g, ''), false) : null;
    const owner = pick(columns.owner) ? squash(pick(columns.owner)).slice(0, LIMITS.ownerChars) : null;
    const outcome = pick(columns.outcome) ? outcomeOfTag(pick(columns.outcome)) : null;
    const required = pick(columns.required) ? /^(?:ja|j|yes|y|x|✓|✔|vereist|verplicht|true)$/i.test(pick(columns.required)) : false;
    items.push({ ...base, minutes: minutes ?? base.minutes, owner: owner || base.owner, outcome: outcome || base.outcome, required: required || base.required });
  }
  return items;
}

/**
 * Text (pasted, or a chosen .md/.txt file) to an agenda draft. Deterministic: no model, no network, no file access.
 * Numbered or bulleted lines are items (only the outermost list level; deeper lines are detail and are not items).
 * Without list lines: a markdown table, then sub-headings, then plain lines. Metadata lines ('Datum:', 'Locatie:')
 * are never items. The first '# heading' (or a first plain line with 'agenda' in it) is the title.
 * Returns { ok: true, agenda, dropped } or { ok: false, code } with code 'empty' or 'too_long'.
 */
function parseAgenda(input, { sourceName = null, now = Date.now } = {}) {
  if (typeof input !== 'string') return { ok: false, code: 'empty' };
  const sourceText = input.replace(/^\uFEFF/, '');
  if (sourceText.length > LIMITS.sourceChars) return { ok: false, code: 'too_long' };
  const lines = sourceText.replace(/\r\n?/g, '\n').split('\n');
  let title = null;
  const listLines = []; const headings = []; const plain = []; const tables = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim() || METADATA.test(line)) continue;
    if (TABLE_ROW.test(line) && index + 1 < lines.length && TABLE_RULE.test(lines[index + 1])) {
      const rows = [line];
      while (index + 1 < lines.length && TABLE_ROW.test(lines[index + 1])) rows.push(lines[++index]);
      tables.push(rows);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      if (heading[1].length === 1 && title === null) title = cleanTitle(heading[2]);
      else headings.push(heading[2]);
      continue;
    }
    const list = LIST.exec(line);
    if (list) { listLines.push({ indent: list[1].replace(/\t/g, '    ').length, text: list[3] }); continue; }
    plain.push(line.trim());
  }
  let raw = [];
  if (listLines.length) {
    const top = Math.min(...listLines.map((line) => line.indent));
    raw = listLines.filter((line) => line.indent <= top + 1).map((line) => line.text);
  } else if (tables.length) {
    const items = tables.flatMap(parseTable);
    return finish(items);
  } else if (headings.length) raw = headings;
  else {
    raw = plain.slice();
    if (title === null && raw.length > 1 && (/agenda/i.test(raw[0]) || /:\s*$/.test(raw[0]))) title = cleanTitle(raw.shift());
  }
  return finish(raw.map(parseItemText));

  function finish(parsed) {
    // The same title twice (case and spacing ignored) is one item; the first one stays and the merge is reported.
    const seen = new Set(); let merged = 0;
    const items = parsed.filter((item) => {
      if (!item.title) return false;
      const key = norm(item.title);
      if (seen.has(key)) { merged++; return false; }
      seen.add(key); return true;
    });
    const kept = items.slice(0, LIMITS.items).map((item, index) => ({ id: `p${index + 1}`, ...item }));
    if (!kept.length) return { ok: false, code: 'empty' };
    const agenda = {
      schemaVersion: 1, agendaId: crypto.randomUUID(),
      title: (title || '').slice(0, LIMITS.agendaTitleChars) || null,
      source: { kind: sourceName ? 'file' : 'text', name: sourceName ? String(sourceName).slice(0, 200) : null, text: sourceText },
      version: 1, createdAt: new Date(now()).toISOString(), items: kept,
    };
    return { ok: true, agenda: validateAgenda(agenda), dropped: items.length - kept.length, merged };
  }
}

/** The strict shape of a stored or prepared agenda. Throws on anything else; titles are trimmed, nothing is invented. */
function validateAgenda(value) {
  if (!onlyKeys(value, ['schemaVersion', 'agendaId', 'title', 'source', 'version', 'createdAt', 'items']) || value.schemaVersion !== 1 ||
      typeof value.agendaId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(value.agendaId) ||
      !(value.title === null || (typeof value.title === 'string' && value.title.length <= LIMITS.agendaTitleChars)) ||
      !Number.isInteger(value.version) || value.version < 1 || value.version > 1_000_000 ||
      typeof value.createdAt !== 'string' || value.createdAt.length > 40 ||
      !onlyKeys(value.source, ['kind', 'name', 'text']) || !['text', 'file'].includes(value.source.kind) ||
      !(value.source.name === null || (typeof value.source.name === 'string' && value.source.name.length <= 200)) ||
      typeof value.source.text !== 'string' || value.source.text.length > LIMITS.sourceChars ||
      !Array.isArray(value.items) || value.items.length < 1 || value.items.length > LIMITS.items) {
    throw new Error('Ongeldige agenda.');
  }
  const ids = new Set();
  const items = value.items.map((item) => {
    if (!onlyKeys(item, ['id', 'title', 'outcome', 'minutes', 'owner', 'required']) || typeof item.id !== 'string' ||
        !/^[a-zA-Z0-9-]{1,40}$/.test(item.id) || ['__proto__', 'constructor', 'prototype'].includes(item.id) || ids.has(item.id) ||
        typeof item.title !== 'string' || !item.title.trim() || item.title.length > LIMITS.titleChars ||
        !OUTCOMES.includes(item.outcome) || typeof item.required !== 'boolean' ||
        !(item.minutes === null || (Number.isInteger(item.minutes) && item.minutes >= 1 && item.minutes <= LIMITS.minutes)) ||
        !(item.owner === null || (typeof item.owner === 'string' && item.owner.length <= LIMITS.ownerChars))) {
      throw new Error('Ongeldig agendapunt.');
    }
    ids.add(item.id);
    const owner = item.owner === null ? null : squash(item.owner) || null;
    return { id: item.id, title: squash(item.title), outcome: item.outcome, minutes: item.minutes, owner, required: item.required };
  });
  const seen = new Set();
  for (const item of items) { const key = norm(item.title); if (seen.has(key)) throw Object.assign(new Error('Dubbel agendapunt.'), { code: 'duplicate_items' }); seen.add(key); }
  return { schemaVersion: 1, agendaId: value.agendaId, title: value.title === null ? null : squash(value.title) || null,
    source: { kind: value.source.kind, name: value.source.name, text: value.source.text }, version: value.version, createdAt: value.createdAt, items };
}

// ---------------------------------------------------------------------------------------------------------------
// Timing and signals
// ---------------------------------------------------------------------------------------------------------------

/** Milliseconds spent on an item at `nowMs`: the closed runs plus the run in progress. */
const spentMs = (state, nowMs) => state.spentMs + (state.runningSince !== null ? Math.max(0, nowMs - state.runningSince) : 0);
const meetingMs = (session, nowMs) => session.meetingMs + (session.meetingSince !== null ? Math.max(0, nowMs - session.meetingSince) : 0);
const plannedMs = (agenda) => agenda.items.reduce((sum, item) => sum + (item.minutes || 0), 0) * 60_000;
const isRejected = (finding, reviews) => reviews?.[finding.id]?.status === 'afgewezen';
const effectiveOf = (finding, reviews) => {
  const review = reviews?.[finding.id];
  if (review && review.status === 'gecorrigeerd') return { text: review.text ?? finding.text, owner: review.owner !== undefined ? review.owner : finding.owner, due: review.due !== undefined ? review.due : finding.due };
  return { text: finding.text, owner: finding.owner, due: finding.due };
};

/**
 * The signals of stand 1, at `nowMs`. Pure: the same session and time give the same list.
 *  tijd_bijna_om           the running item has used 80% of its time block
 *  tijd_om                 the running item has used 100% of its time block
 *  besluit_zonder_eigenaar a decision (not rejected) without an owner (a missing deadline is no signal: the decision
 *                          shows it quietly, 0.11.0)
 *  uitkomst_ontbreekt      an item with outcome 'besluit' ended (or ran out of time) without a decision
 *  vereist_punt_open       less than ten minutes left of the total planned time and a required item is still open
 *                          or running (a deferred item is not open: deferring is a decision of the chair)
 * (afdwaling is not built in stand 1.)
 */
function signalsOf(session, nowMs, reviews = {}) {
  const signals = [];
  const live = session.findings.filter((finding) => !isRejected(finding, reviews));
  for (const item of session.agenda.items) {
    const state = session.items[item.id];
    const limit = item.minutes ? item.minutes * 60_000 : null;
    const used = spentMs(state, nowMs);
    if (state.status === 'loopt' && limit) {
      if (used >= limit) signals.push({ code: 'tijd_om', itemId: item.id });
      else if (used >= limit * NEAR_RATIO) signals.push({ code: 'tijd_bijna_om', itemId: item.id });
    }
    if (item.outcome === 'besluit') {
      const ended = state.status === 'afgerond' || (state.status === 'loopt' && limit && used >= limit);
      if (ended && !live.some((finding) => finding.kind === 'besluit' && finding.itemId === item.id)) signals.push({ code: 'uitkomst_ontbreekt', itemId: item.id });
    }
  }
  for (const finding of live) {
    if (finding.kind !== 'besluit') continue;
    if (!effectiveOf(finding, reviews).owner) signals.push({ code: 'besluit_zonder_eigenaar', itemId: finding.itemId, findingId: finding.id });
  }
  const planned = plannedMs(session.agenda);
  if (planned > 0 && planned - meetingMs(session, nowMs) < REQUIRED_MARGIN_MS) {
    const open = session.agenda.items.filter((item) => item.required && ['open', 'loopt'].includes(session.items[item.id].status)).map((item) => item.id);
    if (open.length) signals.push({ code: 'vereist_punt_open', itemIds: open });
  }
  return signals;
}

/** The next moment a time signal can change (for the host's own timer), or null. */
function nextSignalAt(session, nowMs) {
  const moments = [];
  for (const item of session.agenda.items) {
    const state = session.items[item.id];
    if (state.status !== 'loopt' || state.runningSince === null || !item.minutes) continue;
    const used = spentMs(state, nowMs);
    for (const ratio of [NEAR_RATIO, 1]) { const at = item.minutes * 60_000 * ratio; if (used < at) moments.push(nowMs + (at - used)); }
  }
  const planned = plannedMs(session.agenda);
  if (planned > 0 && session.meetingSince !== null) {
    const left = planned - meetingMs(session, nowMs) - REQUIRED_MARGIN_MS;
    if (left >= 0) moments.push(nowMs + left + 1);
  }
  return moments.length ? Math.min(...moments) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Model request and answer
// ---------------------------------------------------------------------------------------------------------------

/** Final segments as the agenda reads them: the checklist's stable ids, the channel as speaker. */
function agendaSegments(finals) {
  return mapFinals(finals, true).map((segment) => ({ ...segment, speaker: segment.speaker === 'seller' ? 'self' : segment.speaker }));
}

/**
 * Choose what one check may read: the not yet assessed segments with a few earlier ones as context, as the newest
 * contiguous tail that fits 256 segments and 24.000 characters (item titles count too). Older text is never cut out of
 * the middle; if not even the newest segment fits, the check is skipped ('te_veel_tekst').
 */
function planAgendaWindow(items, segments, isAssessed) {
  const firstNew = segments.findIndex((segment) => !isAssessed(segment));
  if (firstNew < 0) return { kind: 'none' };
  const from = Math.max(0, firstNew - LIMITS.context);
  const titleChars = items.reduce((sum, item) => sum + item.title.length, 0);
  const budget = LIMITS.characters - titleChars;
  if (budget <= 0) return { kind: 'tooLarge' };
  const picked = []; let chars = 0;
  for (let index = segments.length - 1; index >= from && picked.length < LIMITS.segments; index--) {
    const length = segments[index].text.length;
    if (chars + length > budget) break;
    picked.unshift(segments[index]); chars += length;
  }
  while (picked.length && JSON.stringify({ items, segments: picked }).length > LIMITS.requestChars - 2000) picked.shift();
  if (!picked.length) return { kind: 'tooLarge' };
  const inWindow = new Set(picked.map((segment) => segment.id));
  // Unassessed segments older than the window are given up (counted), never read out of order later.
  const skipped = segments.filter((segment) => !isAssessed(segment) && !inWindow.has(segment.id));
  const fresh = picked.filter((segment) => !isAssessed(segment));
  return { kind: 'ok', segments: picked, fresh: fresh.map((segment) => segment.id), skipped: skipped.map((segment) => segment.id),
    assessedUntil: fresh.length ? Math.max(...fresh.map((segment) => segment.start)) : null };
}

/**
 * The window of the question check after stopping: the whole conversation if it fits, else its newest contiguous tail
 * within 256 segments and 24.000 characters (the question texts count too). Same tail rule as a live check.
 */
function planQuestionWindow(questions, segments) {
  const budget = LIMITS.characters - questions.reduce((sum, question) => sum + question.text.length, 0);
  if (budget <= 0) return { kind: 'tooLarge' };
  const picked = []; let chars = 0;
  for (let index = segments.length - 1; index >= 0 && picked.length < LIMITS.segments; index--) {
    const length = segments[index].text.length;
    if (chars + length > budget) break;
    picked.unshift(segments[index]); chars += length;
  }
  while (picked.length && JSON.stringify({ questions, segments: picked }).length > LIMITS.requestChars - 2000) picked.shift();
  if (!picked.length) return { kind: 'tooLarge' };
  return { kind: 'ok', segments: picked, tail: picked.length < segments.length };
}
const REASON_CODE = /^[a-z_]{1,40}$/;

function validateSegments(segments) {
  const segmentIds = new Set(); let chars = 0;
  for (const segment of segments) {
    if (!onlyKeys(segment, ['id', 'text', 'speaker', 'start', 'end']) || typeof segment.id !== 'string' || segmentIds.has(segment.id) ||
        typeof segment.text !== 'string' || !['self', 'other', 'unknown'].includes(segment.speaker) ||
        !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end < segment.start) throw new Error('Ongeldig segment.');
    segmentIds.add(segment.id); chars += segment.text.length;
  }
  return chars;
}

/** The question check after stopping: the open questions and the conversation (its newest tail within the bounds). */
function validateQuestionRequest(request) {
  if (!onlyKeys(request, ['sessionId', 'revision', 'mode', 'segments', 'questions']) || request.mode !== 'questions' ||
      typeof request.sessionId !== 'string' || !request.sessionId.trim() || request.sessionId.length > 128 ||
      typeof request.revision !== 'string' || !request.revision || request.revision.length > 128 ||
      !Array.isArray(request.segments) || request.segments.length < 1 || request.segments.length > LIMITS.segments ||
      !Array.isArray(request.questions) || request.questions.length < 1 || request.questions.length > LIMITS.questions ||
      JSON.stringify(request).length > LIMITS.requestChars) throw new Error('Ongeldig vragenverzoek.');
  let chars = validateSegments(request.segments);
  const ids = new Set();
  for (const question of request.questions) {
    if (!onlyKeys(question, ['id', 'text', 'start']) || typeof question.id !== 'string' || !/^f[a-f0-9]{12}$/.test(question.id) || ids.has(question.id) ||
        typeof question.text !== 'string' || !question.text.trim() || question.text.length > LIMITS.findingText ||
        !Number.isFinite(question.start) || question.start < 0) throw new Error('Ongeldige vraag.');
    ids.add(question.id); chars += question.text.length;
  }
  if (chars > LIMITS.characters) throw new Error('Te veel tekst.');
}

/** Strict: an answer names a known question and quotes a segment that starts after it, literally and in whole words. */
function validateQuestionResponse(response, request) {
  if (!onlyKeys(response, ['revision', 'answered']) || response.revision !== request.revision || !Array.isArray(response.answered) ||
      response.answered.length > LIMITS.questions) throw new Error('De vragencontrole leverde geen geldig resultaat.');
  const questions = new Map(request.questions.map((question) => [question.id, question]));
  const segments = new Map(request.segments.map((segment) => [segment.id, segment]));
  const seen = new Set();
  const answered = response.answered.map((answer) => {
    const question = onlyKeys(answer, ['questionId', 'segmentId', 'quote']) ? questions.get(answer.questionId) : null;
    const segment = question ? segments.get(answer.segmentId) : null;
    if (!question || !segment || seen.has(answer.questionId) || !(segment.start > question.start) || !wholeWordQuote(segment.text, answer.quote)) {
      throw new Error('Onbetrouwbaar antwoord op een vraag.');
    }
    seen.add(answer.questionId);
    return { questionId: answer.questionId, segmentId: answer.segmentId, quote: answer.quote };
  });
  return { revision: response.revision, answered };
}

function validateAgendaRequest(request) {
  if (request && request.mode === 'questions') { validateQuestionRequest(request); return; }
  if (!onlyKeys(request, ['sessionId', 'revision', 'currentItemId', 'items', 'segments']) ||
      typeof request.sessionId !== 'string' || !request.sessionId.trim() || request.sessionId.length > 128 ||
      typeof request.revision !== 'string' || !request.revision || request.revision.length > 128 ||
      !Array.isArray(request.items) || request.items.length < 1 || request.items.length > LIMITS.items ||
      !Array.isArray(request.segments) || request.segments.length < 1 || request.segments.length > LIMITS.segments ||
      JSON.stringify(request).length > LIMITS.requestChars) {
    throw new Error('Ongeldig agendaverzoek.');
  }
  const ids = new Set();
  for (const item of request.items) {
    if (!onlyKeys(item, ['id', 'title', 'outcome']) || typeof item.id !== 'string' || ids.has(item.id) || typeof item.title !== 'string' ||
        !item.title.trim() || !OUTCOMES.includes(item.outcome)) throw new Error('Ongeldig agendapunt.');
    ids.add(item.id);
  }
  if (!(request.currentItemId === null || ids.has(request.currentItemId))) throw new Error('Ongeldig lopend punt.');
  const chars = validateSegments(request.segments);
  if (chars + request.items.reduce((sum, item) => sum + item.title.length, 0) > LIMITS.characters) throw new Error('Te veel tekst.');
}

/**
 * The model's answer, checked against the request: known ids only, literal whole-word quotes of at least three
 * characters, bounded texts. An owner or deadline that is not said in the request (or named on the agenda) is dropped;
 * the finding stays. Strict: anything else rejects the whole answer (the Python backend already salvaged per item).
 */
function validateAgendaResponse(response, request) {
  if (request && request.mode === 'questions') return validateQuestionResponse(response, request);
  if (!object(response) || response.revision !== request.revision || !Array.isArray(response.findings) || response.error ||
      response.findings.length > LIMITS.findingsPerCheck || !(response.currentItem === null || object(response.currentItem))) {
    throw new Error('De agendacontrole leverde geen geldig resultaat.');
  }
  const items = new Set(request.items.map((item) => item.id));
  const segments = new Map(request.segments.map((segment) => [segment.id, segment]));
  const allText = request.segments.map((segment) => segment.text).join('\n');
  const grounded = (segmentId, quote) => segments.has(segmentId) && wholeWordQuote(segments.get(segmentId).text, quote);
  let currentItem = null;
  if (response.currentItem) {
    const current = response.currentItem;
    if (!onlyKeys(current, ['itemId', 'segmentId', 'quote']) || !items.has(current.itemId) || !grounded(current.segmentId, current.quote)) {
      throw new Error('Onbetrouwbaar voorstel voor het lopende punt.');
    }
    currentItem = { itemId: current.itemId, segmentId: current.segmentId, quote: current.quote };
  }
  const findings = response.findings.map((finding) => {
    if (!onlyKeys(finding, ['kind', 'itemId', 'text', 'owner', 'due', 'segmentId', 'quote']) || !KINDS.includes(finding.kind) ||
        !(finding.itemId === null || items.has(finding.itemId)) || typeof finding.text !== 'string' || !finding.text.trim() ||
        finding.text.length > LIMITS.findingText || !(finding.owner === null || (typeof finding.owner === 'string' && finding.owner.length <= LIMITS.ownerChars)) ||
        !(finding.due === null || (typeof finding.due === 'string' && finding.due.length <= LIMITS.dueChars)) || !grounded(finding.segmentId, finding.quote)) {
      throw new Error('Onbetrouwbare bevinding.');
    }
    const owner = finding.owner && finding.owner.trim() && saidIn(allText, finding.owner) ? squash(finding.owner) : null;
    const due = finding.due && finding.due.trim() && saidIn(allText, finding.due) ? squash(finding.due) : null;
    return { kind: finding.kind, itemId: finding.itemId, text: squash(finding.text), owner, due, segmentId: finding.segmentId, quote: finding.quote };
  });
  return { revision: response.revision, currentItem, findings };
}

// ---------------------------------------------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------------------------------------------

/** A fresh meeting state for an agenda. */
function newSession(sessionId, agenda) {
  const items = {};
  for (const item of agenda.items) items[item.id] = { status: 'open', spentMs: 0, runningSince: null, runs: [], recognition: null };
  return { schemaVersion: 1, sessionId, agenda: clone(agenda), items, currentItemId: null, suggestion: null, dismissed: [],
    findings: [], assessed: { until: null, recent: [] }, stateVersion: 0, meetingMs: 0, meetingSince: null, recordingStartedAtMs: null, ended: false,
    undo: null, questionsReview: null };
}

const validItemState = (state) => onlyKeys(state, ['status', 'spentMs', 'runningSince', 'runs', 'recognition']) && STATUSES.includes(state.status) &&
  Number.isFinite(state.spentMs) && state.spentMs >= 0 && (state.runningSince === null || Number.isFinite(state.runningSince)) &&
  Array.isArray(state.runs) && state.runs.length <= 64 && (state.recognition === null || ['mens', 'agent_bevestigd'].includes(state.recognition)) &&
  state.runs.every((run) => onlyKeys(run, ['from', 'to']) && Number.isFinite(run.from) && (run.to === null || Number.isFinite(run.to)));
const validEvidence = (evidence) => onlyKeys(evidence, ['segmentId', 'quote', 'start', 'end', 'speaker']) &&
  typeof evidence.segmentId === 'string' && typeof evidence.quote === 'string' && evidence.quote.trim().length >= 3 &&
  Number.isFinite(evidence.start) && Number.isFinite(evidence.end) && ['self', 'other', 'unknown'].includes(evidence.speaker);

function validateSession(value) {
  if (!onlyKeys(value, ['schemaVersion', 'sessionId', 'savedAt', 'agenda', 'items', 'currentItemId', 'suggestion', 'dismissed', 'findings',
    'assessed', 'stateVersion', 'meetingMs', 'meetingSince', 'recordingStartedAtMs', 'ended', 'undo', 'questionsReview']) || value.schemaVersion !== 1 ||
      typeof value.sessionId !== 'string' || value.sessionId.length > 128) throw new Error('Ongeldige agendasessie.');
  const agenda = validateAgenda(value.agenda);
  const items = {};
  for (const item of agenda.items) {
    const state = value.items?.[item.id];
    if (!validItemState(state)) throw new Error('Ongeldige punttoestand.');
    items[item.id] = clone(state);
  }
  if (!(value.currentItemId === null || Object.hasOwn(items, value.currentItemId)) || !Array.isArray(value.findings) ||
      value.findings.length > LIMITS.findings || !onlyKeys(value.assessed, ['until', 'recent']) ||
      !(value.assessed.until === null || Number.isFinite(value.assessed.until)) || !Array.isArray(value.assessed.recent) ||
      value.assessed.recent.length > LIMITS.recentAssessed || !value.assessed.recent.every((id) => typeof id === 'string' && id.length <= 128) ||
      !Array.isArray(value.dismissed) || value.dismissed.length > LIMITS.dismissed || !Number.isInteger(value.stateVersion) ||
      typeof value.ended !== 'boolean' || !Number.isFinite(value.meetingMs)) throw new Error('Ongeldige agendasessie.');
  for (const finding of value.findings) {
    if (!onlyKeys(finding, ['id', 'kind', 'itemId', 'text', 'owner', 'due', 'evidence', 'origin', 'answer']) || typeof finding.id !== 'string' ||
        !KINDS.includes(finding.kind) || !(finding.itemId === null || Object.hasOwn(items, finding.itemId)) || typeof finding.text !== 'string' ||
        finding.origin !== 'ai' || !validEvidence(finding.evidence) ||
        (Object.hasOwn(finding, 'answer') && (finding.kind !== 'vraag' || !validEvidence(finding.answer)))) throw new Error('Ongeldige bevinding.');
  }
  // Both are optional, so sessions stored before 0.11.0 stay readable.
  const undo = value.undo ?? null;
  if (undo !== null && (!onlyKeys(undo, ['previousItemId', 'startedItemId', 'previous', 'started', 'at', 'fromSuggestion']) ||
      !Object.hasOwn(items, undo.previousItemId) || !Object.hasOwn(items, undo.startedItemId) || undo.previousItemId === undo.startedItemId ||
      !validItemState(undo.previous) || !validItemState(undo.started) || !Number.isFinite(undo.at) ||
      !(undo.fromSuggestion === null || (onlyKeys(undo.fromSuggestion, ['itemId', 'segmentId']) && typeof undo.fromSuggestion.segmentId === 'string')))) {
    throw new Error('Ongeldige ongedaanmaking.');
  }
  const review = value.questionsReview ?? null;
  if (review !== null && (!onlyKeys(review, ['status', 'checked', 'answered', 'tail', 'from', 'reason', 'at']) || !QUESTION_REVIEW_STATUSES.includes(review.status) ||
      !Number.isInteger(review.checked) || review.checked < 0 || !Number.isInteger(review.answered) || review.answered < 0 ||
      typeof review.tail !== 'boolean' || !(review.from === null || Number.isFinite(review.from)) ||
      !(review.reason === null || (typeof review.reason === 'string' && review.reason.length <= 40)) || typeof review.at !== 'string')) {
    throw new Error('Ongeldige vragencontrole.');
  }
  return clone({ ...value, agenda, items, undo, questionsReview: review });
}

const offsetOf = (session, nowMs) => (session.recordingStartedAtMs === null ? 0 : Math.max(0, (nowMs - session.recordingStartedAtMs) / 1000));
/** The item a segment belongs to: the item that ran (by human confirmation) at its time, else the model's item. */
function itemAt(session, start, fallback) {
  for (const item of session.agenda.items) {
    if (session.items[item.id].runs.some((run) => start >= run.from && (run.to === null || start < run.to))) return item.id;
  }
  return fallback;
}
const findingId = (kind, segmentId, quote) => `f${crypto.createHash('sha1').update(`${kind}\n${segmentId}\n${norm(quote)}`).digest('hex').slice(0, 12)}`;

/**
 * Merge one validated answer into the session. Monotone: a finding is never removed by a later check (only a human
 * rejects it), the same finding is never added twice, only findings quoting a segment of this check's fresh part count.
 * The suggestion for the running item is dropped when a human changed the meeting state after the request left
 * (`stale`), or when it names an item a human already closed.
 */
function mergeAnswer(session, { request, response, fresh, stateVersion, nowMs }) {
  const freshSet = new Set(fresh);
  const segments = new Map(request.segments.map((segment) => [segment.id, segment]));
  const known = new Set(session.findings.map((finding) => finding.id));
  let added = 0;
  for (const finding of response.findings) {
    if (!freshSet.has(finding.segmentId) || session.findings.length >= LIMITS.findings) continue;
    const id = findingId(finding.kind, finding.segmentId, finding.quote);
    if (known.has(id)) continue;
    const segment = segments.get(finding.segmentId);
    session.findings.push({ id, kind: finding.kind, itemId: itemAt(session, segment.start, finding.itemId), text: finding.text, owner: finding.owner, due: finding.due,
      evidence: { segmentId: segment.id, quote: finding.quote, start: segment.start, end: segment.end, speaker: segment.speaker }, origin: 'ai' });
    known.add(id); added++;
  }
  let stale = false;
  const current = response.currentItem;
  if (stateVersion !== session.stateVersion) stale = Boolean(current);
  else if (current && current.itemId === session.currentItemId) session.suggestion = null;
  else if (current && freshSet.has(current.segmentId) && ['open', 'doorgeschoven'].includes(session.items[current.itemId].status) &&
      !session.dismissed.some((entry) => entry.itemId === current.itemId && entry.segmentId === current.segmentId)) {
    const segment = segments.get(current.segmentId);
    session.suggestion = { itemId: current.itemId, segmentId: segment.id, quote: current.quote, start: segment.start, speaker: segment.speaker, at: new Date(nowMs).toISOString() };
  }
  return { added, stale };
}

/**
 * Undo the last switch (0.11.0): starting an item finishes the running one, and one tap takes that back. The previous
 * item runs again as if it never stopped (the time since the switch counts for it), the started item returns to its
 * state before the switch, and findings the timeline gave the started item since the switch go back to the previous
 * one. A confirmed suggestion that is undone counts as dismissed. Only the last switch, only until the next action.
 */
function undoSwitch(session, itemId) {
  const undo = session.undo;
  if (!undo || session.ended || session.currentItemId !== undo.startedItemId || (itemId !== undefined && itemId !== undo.previousItemId)) {
    return { ok: false, code: 'stale' };
  }
  session.items[undo.previousItemId] = clone(undo.previous);
  session.items[undo.startedItemId] = clone(undo.started);
  session.currentItemId = undo.previousItemId;
  for (const finding of session.findings) {
    if (finding.itemId === undo.startedItemId && finding.evidence.start >= undo.at) finding.itemId = undo.previousItemId;
  }
  if (undo.fromSuggestion) session.dismissed = [...session.dismissed, clone(undo.fromSuggestion)].slice(-LIMITS.dismissed);
  session.suggestion = null; session.undo = null; session.stateVersion++;
  return { ok: true };
}

/** A human action on the meeting. Returns { ok: true } or { ok: false, code }; findings only move back on an undo. */
function applyAction(session, { action, itemId }, nowMs) {
  if (!ACTIONS.includes(action)) return { ok: false, code: 'invalid' };
  if (action === 'undoSwitch') return undoSwitch(session, itemId);
  if (action === 'dismissSuggestion') {
    if (!session.suggestion || (itemId !== undefined && itemId !== session.suggestion.itemId)) return { ok: false, code: 'stale' };
    session.dismissed = [...session.dismissed, { itemId: session.suggestion.itemId, segmentId: session.suggestion.segmentId }].slice(-LIMITS.dismissed);
    session.suggestion = null; session.undo = null; session.stateVersion++;
    return { ok: true };
  }
  let recognition = 'mens';
  if (action === 'confirmSuggestion') {
    if (!session.suggestion || (itemId !== undefined && itemId !== session.suggestion.itemId)) return { ok: false, code: 'stale' };
    itemId = session.suggestion.itemId; recognition = 'agent_bevestigd';
  }
  if (typeof itemId !== 'string' || !Object.hasOwn(session.items, itemId)) return { ok: false, code: 'unknown_item' };
  const offset = offsetOf(session, nowMs);
  const stop = (id) => {
    const state = session.items[id];
    if (state.runningSince !== null) { state.spentMs += Math.max(0, nowMs - state.runningSince); state.runningSince = null; }
    const run = state.runs[state.runs.length - 1];
    if (run && run.to === null) run.to = Math.max(run.from, offset);
  };
  const target = session.items[itemId];
  if (action === 'start' || action === 'confirmSuggestion') {
    if (target.status === 'loopt') { if (action === 'confirmSuggestion') session.suggestion = null; session.stateVersion++; return { ok: true }; }
    let undo = null;
    const previousId = session.currentItemId;
    if (previousId && previousId !== itemId && session.items[previousId].status === 'loopt') {
      // Snapshot before anything changes, so one tap can take the switch back with the time intact.
      undo = { previousItemId: previousId, startedItemId: itemId, previous: clone(session.items[previousId]), started: clone(target), at: offset,
        fromSuggestion: action === 'confirmSuggestion' ? { itemId, segmentId: session.suggestion.segmentId } : null };
      stop(previousId); session.items[previousId].status = 'afgerond';
    }
    session.undo = session.ended ? null : undo;
    target.status = 'loopt'; target.recognition = recognition;
    target.runningSince = session.ended ? null : nowMs;
    if (target.runs.length < 64) target.runs.push({ from: offset, to: null });
    session.currentItemId = itemId; session.suggestion = null;
  } else {
    stop(itemId);
    session.undo = null;
    target.status = action === 'finish' ? 'afgerond' : action === 'skip' ? 'overgeslagen' : 'doorgeschoven';
    if (session.currentItemId === itemId) session.currentItemId = null;
    if (session.suggestion && session.suggestion.itemId === itemId) session.suggestion = null;
  }
  session.stateVersion++;
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------
// The host planner
// ---------------------------------------------------------------------------------------------------------------

/**
 * Which segments a session has read. Bounded on purpose: everything clearly before the newest assessed segment counts as
 * read (a late final released more than two minutes back in time is not read again), recent ids are remembered exactly.
 */
const LATE_MARGIN_S = 120;
const assessedTest = (assessed) => {
  const recent = new Set(assessed.recent);
  return (segment) => Boolean(segment) && (recent.has(segment.id) || (assessed.until !== null && segment.start < assessed.until - LATE_MARGIN_S));
};

const shortId = (sessionId) => crypto.createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 8);
const signatureOf = (finals) => crypto.createHash('sha1').update(JSON.stringify(finals.filter((s) => s && s.isFinal && s.text)
  .map((s) => [s.text, s.start, s.end, s.speaker]))).digest('hex');

/**
 * deps:
 *  moduleEnabled(): boolean                    the module is on (Veneta profile and switch)
 *  attach(sessionId): session | null           the existing session of a continued note, or a new one from the
 *                                              prepared agenda; null when no agenda stands ready (nothing is created)
 *  getFinals(): LiveSegment[]                  the host's live buffer (prior segments then finals)
 *  analyze(request, { final }): Promise<{ok:true,response}|{ok:false,reason}>   guarded, validated, local-only route
 *  persist(session): void                      writes the session file the note tab reads
 *  getReviews(sessionId): object               human reviews of findings (for signals); optional
 *  emit(state), log(event, fields), keyOf(sessionId), now, setTimeout, clearTimeout
 */
function createAgendaPlanner(deps) {
  const now = deps.now || Date.now;
  const setT = deps.setTimeout || setTimeout;
  const clearT = deps.clearTimeout || clearTimeout;
  const stableMs = deps.stableMs ?? (deps.energySaver ? 30_000 : STABLE_MS);
  const maxWaitMs = deps.maxWaitMs ?? (deps.energySaver ? 60_000 : MAX_WAIT_MS);
  const graceMs = deps.finalGraceMs ?? FINAL_GRACE_MS;
  const busyRetryMs = deps.busyRetryMs ?? BUSY_RETRY_MS;
  const log = (event, fields = {}) => { try { deps.log?.(event, fields); } catch (_) { /* Diagnostics never break the planner. */ } };
  const moduleOn = () => { try { return deps.moduleEnabled() === true; } catch (_) { return false; } };
  const reviewsOf = (sess) => { try { return deps.getReviews?.(sess.data.sessionId) || {}; } catch (_) { return {}; } };
  let current = null;
  let seq = 0;
  const finalizing = new Set();
  const stopping = new Set();

  const phaseOf = (sess) => {
    if (sess.finalRunning) return 'finalBusy';
    if (sess.inFlight) return 'busy';
    if (sess.failure) return 'error';
    if (sess.tooLarge) return 'tooLarge';
    if (sess.lastRunAt) return sess.data.ended ? 'ended' : 'listening';
    if (sess.lines === 0) return sess.data.ended ? 'ended' : 'noText';
    return sess.data.ended ? 'ended' : 'waiting';
  };
  const publicOf = (sess) => {
    const at = now(); const data = sess.data;
    return {
      active: true, seq: sess.seq, sessionId: data.sessionId, hostNow: at, ended: data.ended, stateVersion: data.stateVersion,
      agenda: { title: data.agenda.title, version: data.agenda.version, items: data.agenda.items },
      items: Object.fromEntries(data.agenda.items.map((item) => {
        const state = data.items[item.id];
        return [item.id, { status: state.status, spentMs: spentMs(state, at), running: state.runningSince !== null, recognition: state.recognition,
          startOffset: state.runs.length ? state.runs[0].from : null }];
      })),
      currentItemId: data.currentItemId, suggestion: data.suggestion, findings: data.findings,
      undo: data.undo && !data.ended ? { itemId: data.undo.previousItemId, startedItemId: data.undo.startedItemId } : null,
      questionsReview: data.questionsReview ?? null,
      signals: signalsOf(data, at, reviewsOf(sess)),
      planned: { totalMinutes: plannedMs(data.agenda) / 60_000, meetingMs: meetingMs(data, at) },
      phase: phaseOf(sess),
      lastRunAt: sess.lastRunAt ? new Date(sess.lastRunAt).toISOString() : null,
      failure: sess.failure ? { reason: sess.failure.reason, at: new Date(sess.failure.at).toISOString() } : null,
      counters: { lines: sess.lines, checks: sess.checks, failures: sess.failures, stale: sess.stale, skipped: sess.skipped },
      lastReason: sess.lastReason,
    };
  };
  const save = (sess) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { deps.persist(clone(sess.data)); return true; } catch (_) { /* Retried once, then reported. */ }
    }
    log('persist_failed', {});
    return false;
  };
  const armSignals = (sess) => {
    if (sess.signalTimer) { clearT(sess.signalTimer); sess.signalTimer = null; }
    if (sess.cancelled || current !== sess) return;
    const at = nextSignalAt(sess.data, now());
    if (at === null) return;
    sess.signalTimer = setT(() => { sess.signalTimer = null; publish(sess); }, Math.max(0, at - now()));
  };
  function publish(sess) {
    sess.seq = ++seq;
    if (current === sess) { try { deps.emit?.(publicOf(sess)); } catch (_) { /* The display is never the planner's problem. */ } }
    armSignals(sess);
  }
  const clearTimer = (sess) => { if (sess.timer) { clearT(sess.timer); sess.timer = null; } };
  const finalsOf = (sess) => {
    if (current === sess) { try { sess.lastFinals = deps.getFinals(); } catch (_) { /* Keep the last known copy. */ } }
    return sess.lastFinals;
  };
  const schedule = (sess) => {
    clearTimer(sess);
    if (sess.cancelled || sess.data.ended || sess.inFlight || !sess.dirty || sess.pendingSince === null) return;
    const waited = now() - sess.pendingSince;
    const delay = Math.min(stableMs, Math.max(0, maxWaitMs - waited));
    sess.timer = setT(() => { sess.timer = null; void run(sess, now() - sess.pendingSince >= maxWaitMs ? 'maxwacht' : 'stil'); }, delay);
    log('scheduled', { delayMs: delay, lines: sess.lines });
  };
  const unassessed = (sess) => {
    const isAssessed = assessedTest(sess.data.assessed);
    return agendaSegments(finalsOf(sess)).some((segment) => !isAssessed(segment));
  };
  const markAssessed = (sess, plan) => {
    const assessed = sess.data.assessed;
    const until = plan.assessedUntil === null ? assessed.until : Math.max(assessed.until ?? -Infinity, plan.assessedUntil);
    const recent = [...new Set([...assessed.recent, ...plan.fresh, ...plan.skipped])];
    sess.data.assessed = { until, recent: recent.slice(-LIMITS.recentAssessed) };
  };

  async function run(sess, trigger) {
    if (sess.cancelled || sess.inFlight || (sess.data.ended && trigger !== 'stop')) return;
    if (!moduleOn()) { cancelSession(sess); return; }
    const segments = agendaSegments(finalsOf(sess));
    sess.dirty = false; sess.pendingSince = null;
    if (!segments.length) return;
    const items = sess.data.agenda.items.map((item) => ({ id: item.id, title: item.title, outcome: item.outcome }));
    const plan = planAgendaWindow(items, segments, assessedTest(sess.data.assessed));
    if (plan.kind === 'none') return;
    if (plan.kind !== 'ok') {
      sess.tooLarge = true; sess.lastReason = 'te_veel_tekst';
      log('too_large', { lines: segments.length });
      publish(sess);
      return;
    }
    sess.tooLarge = false;
    sess.inFlight = true; sess.checks++;
    const stateVersion = sess.data.stateVersion;
    const request = { sessionId: sess.data.sessionId, revision: crypto.randomUUID(), currentItemId: sess.data.currentItemId, items,
      segments: plan.segments.map((segment) => ({ id: segment.id, text: segment.text, speaker: segment.speaker, start: segment.start, end: segment.end })) };
    log('check_start', { trigger, lines: segments.length, window: plan.segments.length, fresh: plan.fresh.length, checks: sess.checks });
    publish(sess);
    const started = now();
    const flight = (async () => {
      let outcome;
      try { outcome = await deps.analyze(clone(request), { final: trigger === 'stop' }); }
      catch (_) { outcome = { ok: false, reason: 'failed' }; }
      if (sess.cancelled) return;
      if (!outcome.ok && outcome.reason === 'busy') {
        sess.checks--; sess.dirty = true; sess.pendingSince ??= now(); sess.lastReason = 'busy'; sess.inFlight = false;
        log('check_busy', {});
        publish(sess);
        clearTimer(sess);
        if (trigger === 'stop') {
          sess.busyRetries = (sess.busyRetries || 0) + 1;
          if (sess.busyRetries <= 24) { await sleep(sess, busyRetryMs).promise; if (!sess.cancelled) await run(sess, 'stop'); return; }
          sess.failures++; sess.failure = { reason: 'busy', at: now() };
          publish(sess);
          return;
        }
        sess.timer = setT(() => { sess.timer = null; void run(sess, trigger); }, busyRetryMs);
        return;
      }
      if (outcome.ok) {
        const merged = mergeAnswer(sess.data, { request, response: outcome.response, fresh: plan.fresh, stateVersion, nowMs: now() });
        markAssessed(sess, plan);
        sess.skipped += plan.skipped.length;
        if (merged.stale) sess.stale++;
        if (!save(sess)) outcome = { ok: false, reason: 'failed' };
        else {
          sess.lastRunAt = now(); sess.failure = null; sess.lastReason = merged.stale ? 'verouderd' : trigger;
          log('check_done', { ms: now() - started, checks: sess.checks, added: merged.added, stale: merged.stale ? 1 : 0, skipped: plan.skipped.length });
        }
      }
      if (!outcome.ok) {
        sess.failures++;
        sess.failure = { reason: outcome.reason || 'failed', at: now() };
        sess.lastReason = sess.failure.reason;
        log('check_failed', { reason: sess.failure.reason, failures: sess.failures });
      }
      sess.inFlight = false;
      publish(sess);
      schedule(sess);
    })();
    sess.flight = flight;
    await flight;
  }

  function sleep(sess, ms) {
    let entry;
    const promise = new Promise((resolve) => {
      entry = { resolve, handle: null };
      entry.handle = setT(() => { sess.sleepers.delete(entry); resolve(); }, ms);
      sess.sleepers.add(entry);
    });
    return { promise, clear: () => { if (sess.sleepers.delete(entry)) clearT(entry.handle); } };
  }
  /** Open questions: not rejected by a human, not yet answered (the last check after stopping may answer them). */
  const openQuestions = (sess) => {
    const reviews = reviewsOf(sess);
    return sess.data.findings.filter((finding) => finding.kind === 'vraag' && !finding.answer && !isRejected(finding, reviews));
  };
  /**
   * After stopping, once: are the open questions answered later in the conversation? The whole conversation within the
   * same bounds as a live check (256 segments, 24.000 characters, question texts included). A longer conversation is
   * read as its newest contiguous tail (never the middle) and the result says so (`tail`, `from`).
   */
  async function reviewQuestions(sess) {
    const reviews = reviewsOf(sess);
    const open = openQuestions(sess).slice(0, LIMITS.questions);
    const segments = agendaSegments(finalsOf(sess));
    if (!open.length || !segments.length) return;
    const questions = open.map((finding) => ({ id: finding.id, text: effectiveOf(finding, reviews).text.slice(0, LIMITS.findingText), start: finding.evidence.start }));
    const plan = planQuestionWindow(questions, segments);
    const at = () => new Date(now()).toISOString();
    if (plan.kind !== 'ok') {
      sess.data.questionsReview = { status: 'tooLarge', checked: 0, answered: 0, tail: true, from: null, reason: 'te_veel_tekst', at: at() };
      log('questions_too_large', { questions: questions.length });
      save(sess); publish(sess);
      return;
    }
    const request = { sessionId: sess.data.sessionId, revision: crypto.randomUUID(), mode: 'questions', questions,
      segments: plan.segments.map((segment) => ({ id: segment.id, text: segment.text, speaker: segment.speaker, start: segment.start, end: segment.end })) };
    log('questions_start', { questions: questions.length, window: plan.segments.length, tail: plan.tail ? 1 : 0 });
    let outcome;
    for (let attempt = 0; ; attempt++) {
      try { outcome = await deps.analyze(clone(request), { final: true }); }
      catch (_) { outcome = { ok: false, reason: 'failed' }; }
      if (sess.cancelled) return;
      if (outcome.ok || outcome.reason !== 'busy' || attempt >= 24) break;
      await sleep(sess, busyRetryMs).promise;
      if (sess.cancelled) return;
    }
    const base = { checked: questions.length, tail: plan.tail, from: plan.tail ? plan.segments[0].start : null, at: at() };
    if (outcome.ok) {
      const byId = new Map(request.segments.map((segment) => [segment.id, segment]));
      let answered = 0;
      for (const answer of outcome.response.answered) {
        const finding = sess.data.findings.find((item) => item.id === answer.questionId);
        const segment = byId.get(answer.segmentId);
        if (!finding || finding.answer || !segment) continue;
        finding.answer = { segmentId: segment.id, quote: answer.quote, start: segment.start, end: segment.end, speaker: segment.speaker };
        answered++;
      }
      sess.data.questionsReview = { status: 'done', answered, reason: null, ...base };
      log('questions_done', { questions: questions.length, answered });
    } else {
      sess.data.questionsReview = { status: 'failed', answered: 0, reason: REASON_CODE.test(outcome.reason || '') ? outcome.reason : 'failed', ...base };
      log('questions_failed', { reason: sess.data.questionsReview.reason });
    }
    save(sess); publish(sess);
  }
  const cancelSession = (sess) => {
    sess.cancelled = true; clearTimer(sess); sess.inFlight = false; sess.finalRunning = false; finalizing.delete(sess); stopping.delete(sess);
    if (sess.signalTimer) { clearT(sess.signalTimer); sess.signalTimer = null; }
    for (const entry of [...sess.sleepers]) { clearT(entry.handle); entry.resolve(); }
    sess.sleepers.clear();
    sess.lastFinals = [];
    if (current === sess) { current = null; seq++; try { deps.emit?.({ active: false, seq }); } catch (_) { /* Display only. */ } }
  };
  /** Stop the clocks of the meeting (stop of a recording): time is never counted while nobody records. */
  const freeze = (sess) => {
    const at = now(); const data = sess.data;
    for (const state of Object.values(data.items)) {
      if (state.runningSince !== null) { state.spentMs += Math.max(0, at - state.runningSince); state.runningSince = null; }
      const run = state.runs[state.runs.length - 1];
      if (run && run.to === null) run.to = Math.max(run.from, offsetOf(data, at));
    }
    if (data.meetingSince !== null) { data.meetingMs += Math.max(0, at - data.meetingSince); data.meetingSince = null; }
  };

  return {
    /** A recording starts. Off module or no agenda ready: returns false and reads nothing of the agenda files. */
    begin({ appendTarget = null, startedAtMs }) {
      if (current && !current.data.ended) cancelSession(current);
      current = null;
      if (!moduleOn()) { seq++; return false; }
      const sessionId = liveSessionId({ appendTarget, startedAtMs });
      let data = null;
      try { data = deps.attach(sessionId); } catch (_) { data = null; }
      if (!data) { seq++; log('begin_none', {}); return false; }
      const at = now();
      data.ended = false; data.meetingSince = at; data.recordingStartedAtMs = Number.isFinite(startedAtMs) ? startedAtMs : at;
      data.undo = null;
      // A continued note resumes the running item's clock; its earlier runs keep their own time codes.
      for (const state of Object.values(data.items)) {
        if (state.status === 'loopt') { state.runningSince = at; if (state.runs.length < 64) state.runs.push({ from: 0, to: null }); }
      }
      current = {
        data, lines: 0, checks: 0, failures: 0, stale: 0, skipped: 0, lastReason: null, signature: signatureOf([]), lastFinals: [],
        dirty: false, pendingSince: null, timer: null, signalTimer: null, inFlight: false, flight: null, lastRunAt: null, failure: null,
        tooLarge: false, cancelled: false, finalRunning: false, seq: 0, sleepers: new Set(),
      };
      save(current);
      log('begin', { session: shortId(sessionId), items: data.agenda.items.length, continued: Boolean(appendTarget) });
      publish(current);
      return true;
    },
    notify() {
      const sess = current;
      if (!sess || sess.data.ended || sess.cancelled) return;
      if (!moduleOn()) { cancelSession(sess); return; }
      let finals;
      try { finals = deps.getFinals(); } catch (_) { return; }
      sess.lastFinals = finals;
      const signature = signatureOf(finals);
      if (signature === sess.signature) return;
      sess.signature = signature;
      const lines = finals.filter((s) => s && s.isFinal && s.text).length;
      const grew = lines !== sess.lines;
      sess.lines = lines;
      sess.dirty = true; sess.pendingSince ??= now();
      log('finals', { lines, grew });
      if (grew || !sess.inFlight) publish(sess);
      schedule(sess);
    },
    /** A human action (start, finish, skip, defer, confirm or dismiss the suggestion). Always possible while a session exists. */
    act(request) {
      const sess = current;
      if (!sess || sess.cancelled) return { ok: false, code: 'no_session' };
      if (!moduleOn()) { cancelSession(sess); return { ok: false, code: 'module_disabled' }; }
      if (!onlyKeys(request, ['action', 'itemId']) || !ACTIONS.includes(request.action)) return { ok: false, code: 'invalid' };
      const outcome = applyAction(sess.data, request, now());
      if (!outcome.ok) return outcome;
      log('action', { action: request.action });
      save(sess);
      publish(sess);
      return { ok: true, state: publicOf(sess) };
    },
    finish({ drained = null, drainTimeoutMs = DRAIN_MAX_MS } = {}) {
      const sess = current;
      if (!sess || sess.data.ended || sess.cancelled) return Promise.resolve();
      sess.data.ended = true; clearTimer(sess);
      if (!moduleOn()) { cancelSession(sess); return Promise.resolve(); }
      freeze(sess);
      sess.data.undo = null;
      save(sess);
      stopping.add(sess);
      const claim = () => { if (!sess.finalRunning) { sess.finalRunning = true; finalizing.add(sess); log('final_start', { lines: sess.lines }); publish(sess); } };
      if (sess.inFlight || unassessed(sess) || openQuestions(sess).length) claim(); else publish(sess);
      const done = (async () => {
        if (drained && typeof drained.then === 'function') {
          const limit = sleep(sess, Math.max(0, drainTimeoutMs));
          await Promise.race([Promise.resolve(drained).then(() => {}, () => {}), limit.promise]);
          limit.clear();
        } else if (graceMs > 0) await sleep(sess, graceMs).promise;
        if (sess.flight) { try { await sess.flight; } catch (_) { /* Reported by the flight itself. */ } }
        if (!sess.cancelled && unassessed(sess)) {
          claim();
          sess.lines = finalsOf(sess).filter((item) => item && item.isFinal && item.text).length;
          await run(sess, 'stop');
        }
        if (!sess.cancelled && moduleOn() && openQuestions(sess).length) {
          claim();
          await reviewQuestions(sess);
        }
        if (sess.finalRunning) log('final_done', { checks: sess.checks });
        sess.finalRunning = false; finalizing.delete(sess); stopping.delete(sess);
        sess.lastFinals = [];
        if (!sess.cancelled) publish(sess);
      })();
      return done;
    },
    cancel({ keepFinishing = false } = {}) {
      if (keepFinishing) { if (current && !current.data.ended) cancelSession(current); return; }
      if (current) cancelSession(current);
      for (const sess of [...finalizing, ...stopping]) cancelSession(sess);
    },
    getState() { return current ? publicOf(current) : { active: false, seq }; },
    sessionId() { return current && !current.cancelled ? current.data.sessionId : null; },
    retainedFinals() { return current ? current.lastFinals.length : 0; },
    finalPendingFor(sessionKey) { return [...stopping].some((sess) => deps.keyOf(sess.data.sessionId) === sessionKey); },
    finalRunningFor(sessionKey) { return [...finalizing].some((sess) => deps.keyOf(sess.data.sessionId) === sessionKey); },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Minutes (notulen) after the meeting
// ---------------------------------------------------------------------------------------------------------------

const REVIEW_STATUSES = Object.freeze(['bevestigd', 'afgewezen', 'gecorrigeerd']);
const STATUS_TEXT = { open: 'Niet behandeld', loopt: 'Liep nog bij het stoppen', afgerond: 'Afgerond', overgeslagen: 'Overgeslagen', doorgeschoven: 'Doorgeschoven' };
const OUTCOME_TEXT = { besluit: 'Besluit', informatie: 'Informatie', discussie: 'Discussie', actie: 'Actie' };
const REVIEW_TEXT = { voorstel: 'voorstel', bevestigd: 'bevestigd', afgewezen: 'afgewezen', gecorrigeerd: 'gecorrigeerd' };
const SPEAKER_TEXT = { self: 'Jij', other: 'Anderen', unknown: 'Onbekend' };
const clock = (seconds) => {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const rest = `${String(Math.floor((whole % 3600) / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
  return hours ? `${hours}:${rest}` : rest;
};

/** Derived, read-only view of a stored session with the human reviews applied. A human correction always wins. */
function buildMinutes(session, reviews = {}) {
  const row = (finding) => {
    const review = reviews[finding.id] || null;
    const effective = effectiveOf(finding, reviews);
    return { id: finding.id, kind: finding.kind, text: effective.text, owner: effective.owner, due: effective.due,
      ai: { text: finding.text, owner: finding.owner, due: finding.due }, evidence: finding.evidence,
      review: review ? review.status : 'voorstel', reason: review?.reason ?? null, answer: finding.answer ?? null };
  };
  const signals = signalsOf(session, 0, reviews).filter((signal) => signal.code !== 'tijd_bijna_om');
  const group = (itemId) => {
    const own = session.findings.filter((finding) => finding.itemId === itemId).map(row);
    return { decisions: own.filter((f) => f.kind === 'besluit'), actions: own.filter((f) => f.kind === 'actie'), questions: own.filter((f) => f.kind === 'vraag') };
  };
  const items = session.agenda.items.map((item, index) => {
    const state = session.items[item.id];
    return { ...item, number: index + 1, status: state.status, spentSec: Math.round(state.spentMs / 1000), recognition: state.recognition,
      startOffset: state.runs.length ? state.runs[0].from : null,
      overTime: Boolean(item.minutes && state.spentMs > item.minutes * 60_000),
      missingOutcome: signals.some((signal) => signal.code === 'uitkomst_ontbreekt' && signal.itemId === item.id),
      ...group(item.id) };
  });
  const other = group(null);
  const counts = { decisions: 0, actions: 0, questions: 0, answered: 0, proposals: 0, confirmed: 0 };
  for (const finding of session.findings) {
    if (isRejected(finding, reviews)) continue;
    // A question the last check found answered later is no longer open.
    if (finding.kind === 'vraag' && finding.answer) counts.answered++;
    else counts[finding.kind === 'besluit' ? 'decisions' : finding.kind === 'actie' ? 'actions' : 'questions']++;
    if (reviews[finding.id]) counts.confirmed++; else counts.proposals++;
  }
  return { schemaVersion: 1, title: session.agenda.title, items, other, counts,
    totals: { plannedMinutes: plannedMs(session.agenda) / 60_000, spentSec: Math.round(session.agenda.items.reduce((sum, item) => sum + session.items[item.id].spentMs, 0) / 1000) },
    ownerMissing: signals.filter((signal) => signal.code === 'besluit_zonder_eigenaar').map((signal) => signal.findingId),
    questionsReview: session.questionsReview ?? null };
}

/** One honest sentence about the question check after stopping (also shown in the note tab). */
function questionsReviewText(review) {
  if (review.status === 'done' && review.tail) {
    return `Na het stoppen zijn de open vragen nog eens nagegaan, alleen in het laatste deel van het gesprek (vanaf ${clock(review.from ?? 0)}): het hele gesprek past niet in één controle. ${review.answered} van ${review.checked} beantwoord.`;
  }
  if (review.status === 'done') return `Na het stoppen zijn de open vragen nog eens nagegaan over het hele gesprek: ${review.answered} van ${review.checked} beantwoord.`;
  if (review.status === 'tooLarge') return 'Na het stoppen konden de open vragen niet opnieuw worden nagegaan: te veel tekst voor één controle.';
  return 'Na het stoppen konden de open vragen niet opnieuw worden nagegaan.';
}

const mdEscape = (text) => String(text).replace(/([\\`*_[\]<>#|])/g, '\\$1').replace(/\n+/g, ' ');
/** The minutes as markdown ('Kopieer als markdown'). Rejected findings are left out; unconfirmed ones say 'voorstel'. */
function minutesMarkdown(minutes, { title } = {}) {
  const lines = [`# Notulen${minutes.title || title ? ` ${mdEscape(minutes.title || title)}` : ''}`, '',
    '_Gemaakt door Veneta MemoAi met het lokale model. Niet bevestigde besluiten, acties en vragen zijn voorstellen; elk punt heeft een letterlijk citaat._', ''];
  const finding = (f) => {
    const parts = [`- [${REVIEW_TEXT[f.review]}] ${mdEscape(f.text)}`];
    if (f.kind !== 'vraag') parts.push(`Eigenaar: ${f.owner ? mdEscape(f.owner) : 'niet genoemd'}`);
    if (f.kind !== 'vraag') parts.push(`Termijn: ${f.due ? mdEscape(f.due) : 'niet genoemd'}`);
    const out = [parts.join(' · '), `  > "${mdEscape(f.evidence.quote)}" (${clock(f.evidence.start)}, ${SPEAKER_TEXT[f.evidence.speaker] || SPEAKER_TEXT.unknown})`];
    if (f.answer) out.push(`  Beantwoord: "${mdEscape(f.answer.quote)}" (${clock(f.answer.start)}, ${SPEAKER_TEXT[f.answer.speaker] || SPEAKER_TEXT.unknown})`);
    return out;
  };
  const section = (name, rows) => {
    const shown = rows.filter((row) => row.review !== 'afgewezen');
    if (!shown.length) return [];
    return [`**${name}**`, '', ...shown.flatMap(finding), ''];
  };
  const questions = (rows) => [...section('Open vragen', rows.filter((row) => !row.answer)), ...section('Beantwoorde vragen', rows.filter((row) => row.answer))];
  const review = minutes.questionsReview;
  if (review) lines.push(`_${questionsReviewText(review)}_`, '');
  for (const item of minutes.items) {
    const meta = [OUTCOME_TEXT[item.outcome], item.minutes ? `${item.minutes} min` : null, item.owner ? `eigenaar ${mdEscape(item.owner)}` : null, item.required ? 'vereist' : null].filter(Boolean).join(', ');
    lines.push(`## ${item.number}. ${mdEscape(item.title)}${meta ? ` (${meta})` : ''}`, '');
    lines.push(`Status: ${STATUS_TEXT[item.status]} · besteed ${clock(item.spentSec)}${item.minutes ? ` van ${clock(item.minutes * 60)}` : ''}${item.missingOutcome ? ' · geen besluit herkend' : ''}`, '');
    lines.push(...section('Besluiten', item.decisions), ...section('Acties', item.actions), ...questions(item.questions));
  }
  const rest = [...section('Besluiten', minutes.other.decisions), ...section('Acties', minutes.other.actions), ...questions(minutes.other.questions)];
  if (rest.length) lines.push('## Overig (geen agendapunt)', '', ...rest);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

module.exports = {
  OUTCOMES, STATUSES, KINDS, ACTIONS, LIMITS, REVIEW_STATUSES, STABLE_MS, MAX_WAIT_MS, NEAR_RATIO, REQUIRED_MARGIN_MS,
  wholeWordQuote, saidIn, parseAgenda, parseItemText, validateAgenda, signalsOf, nextSignalAt, agendaSegments, planAgendaWindow, planQuestionWindow,
  validateAgendaRequest, validateAgendaResponse, newSession, validateSession, mergeAnswer, applyAction, createAgendaPlanner,
  buildMinutes, minutesMarkdown, questionsReviewText, findingId, assessedTest,
};
