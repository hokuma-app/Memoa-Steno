'use strict';
/**
 * Agenda en voorzitter (stand 1): host channels, storage and the guarded local-model route.
 *
 * Same boundaries as the conversation checklist: the module is off by default and only works in the Veneta profile.
 * Off means: no reads of agenda files, no model calls, no files written (every channel refuses before touching disk).
 * The model route is the existing local one (backend command `agenda-analyze`: local provider only, installed model
 * only, no download, no cloud, no proxy or redirect) and shares the one model slot with the checklist.
 *
 * Storage, all inside `veneta-modules/` and never inside a note:
 *   agenda-preparation.json            the agenda that stands ready for the next recording
 *   agenda-sessions/<sha256>.json      the meeting state of one recording (or continued note)
 *   agenda-reviews/<sha256>.json       human confirmations, rejections and corrections of findings
 *   agenda-note-results/<sha256>.json  the link from a note (realpath identity) to its session
 * The canonical note, transcript and summary are never changed.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicWrite, assertDirectory, AGENDA_MODULE } = require('./veneta-product-ipc');
const { liveSessionId } = require('./veneta-live-checklist');
const { CHECKLIST_REASONS } = require('./veneta-checklist-runner');
const chair = require('./veneta-agenda-chair');

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_REASON = 200;
const REASONS = new Set([...CHECKLIST_REASONS, 'module_disabled', 'busy']);
const HOST_MESSAGES = {
  empty: 'Er zijn geen agendapunten gevonden. Zet elk punt op een eigen regel, genummerd of met een streepje.',
  too_long: 'De agenda is te lang: maximaal 24.000 tekens.',
  file_type: 'Kies een tekstbestand (.md of .txt).',
  duplicate_items: 'Twee agendapunten hebben dezelfde titel. Pas er een aan of verwijder er een.',
  no_session: 'Er loopt geen opname met een agenda.',
  stale: 'Dit voorstel is niet meer actueel.',
  unknown_item: 'Onbekend agendapunt.',
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const onlyKeys = (value, keys) => object(value) && Object.keys(value).every((key) => keys.includes(key));
const hostError = (code) => Object.assign(new Error(HOST_MESSAGES[code] || 'Ongeldig verzoek.'), { code });

function readJson(file, fallback, validate) {
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return fallback === null ? null : clone(fallback); throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) throw new Error('Onveilige of te grote agendaopslag.');
  return validate(JSON.parse(fs.readFileSync(file, 'utf8')));
}
function removeFile(file) {
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Ongeldige agendaopslag.');
  fs.unlinkSync(file);
}
function writeJson(file, value) {
  if (Buffer.byteLength(JSON.stringify(value, null, 2) + '\n') > MAX_FILE_BYTES) throw new Error('Te veel agendaopslag.');
  atomicWrite(file, value);
}
function sessionKey(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 128) throw new Error('Ongeldig gesprek.');
  return crypto.createHash('sha256').update(sessionId).digest('hex');
}
function noteKeyOf(noteFile) {
  if (typeof noteFile !== 'string' || noteFile.length > 4096 || !path.isAbsolute(noteFile) || noteFile.includes('\0')) throw new Error('Ongeldige notitie.');
  let directory = path.dirname(noteFile);
  try { directory = fs.realpathSync(directory); } catch (_) { /* The folder may not exist yet; the plain path is stable. */ }
  return crypto.createHash('sha256').update(path.join(directory, path.basename(noteFile))).digest('hex');
}

function validateReviews(value) {
  if (!onlyKeys(value, ['schemaVersion', 'reviews']) || value.schemaVersion !== 1 || !object(value.reviews) || Object.keys(value.reviews).length > chair.LIMITS.findings) {
    throw new Error('Ongeldige beoordelingen.');
  }
  for (const [id, review] of Object.entries(value.reviews)) {
    if (!/^f[a-f0-9]{12}$/.test(id) || !onlyKeys(review, ['status', 'text', 'owner', 'due', 'reason', 'at']) || !chair.REVIEW_STATUSES.includes(review.status) ||
        typeof review.at !== 'string' ||
        (Object.hasOwn(review, 'text') && (typeof review.text !== 'string' || !review.text.trim() || review.text.length > chair.LIMITS.findingText)) ||
        (Object.hasOwn(review, 'owner') && !(review.owner === null || (typeof review.owner === 'string' && review.owner.length <= chair.LIMITS.ownerChars))) ||
        (Object.hasOwn(review, 'due') && !(review.due === null || (typeof review.due === 'string' && review.due.length <= chair.LIMITS.dueChars))) ||
        (Object.hasOwn(review, 'reason') && (typeof review.reason !== 'string' || review.reason.length > MAX_REASON))) {
      throw new Error('Ongeldige beoordeling.');
    }
  }
  return clone(value);
}

/**
 * deps: ipcMain, getUserDataDir, store() (product settings store factory), modelSlot (shared with the checklist),
 * analyzeAgenda(request) (the backend runner; replaced only at the model boundary under e2e), isOllamaBusy(),
 * getLiveFinals(), emitLiveState(state), logLive(event, fields), liveTimers, onSettingsChanged(listener).
 */
function registerVenetaAgendaIpc({ ipcMain, getUserDataDir, store, modelSlot, analyzeAgenda, isOllamaBusy = () => false,
  getLiveFinals = () => [], emitLiveState = () => {}, logLive = () => {}, liveTimers = {}, onSettingsChanged = () => {} }) {
  const moduleOn = () => store().moduleEnabled(AGENDA_MODULE);
  const requireModule = () => { if (!moduleOn()) throw Object.assign(new Error('Module uitgeschakeld.'), { code: 'module_disabled' }); };
  const dir = () => path.join(getUserDataDir(), 'veneta-modules');
  const preparedFile = () => path.join(dir(), 'agenda-preparation.json');
  const sessionFile = (key) => path.join(dir(), 'agenda-sessions', key + '.json');
  const reviewsFile = (key) => path.join(dir(), 'agenda-reviews', key + '.json');
  const linkFile = (noteKey) => path.join(dir(), 'agenda-note-results', noteKey + '.json');
  const guard = (file) => { assertDirectory(dir()); assertDirectory(path.dirname(file)); return file; };

  const readPrepared = () => readJson(guard(preparedFile()), null, (value) => {
    if (!onlyKeys(value, ['schemaVersion', 'agenda']) || value.schemaVersion !== 1) throw new Error('Ongeldige voorbereiding.');
    return chair.validateAgenda(value.agenda);
  });
  const readSession = (key) => readJson(guard(sessionFile(key)), null, (value) => chair.validateSession(value));
  const readReviews = (key) => readJson(guard(reviewsFile(key)), { schemaVersion: 1, reviews: {} }, validateReviews).reviews;
  const persistSession = (session) => writeJson(guard(sessionFile(sessionKey(session.sessionId))), { ...session, savedAt: new Date().toISOString() });

  /** Existing progress always wins (continued note); otherwise the prepared agenda becomes this meeting's copy. */
  const attach = (sessionId) => {
    const key = sessionKey(sessionId);
    const existing = readSession(key);
    if (existing) { const { savedAt: _ignored, ...session } = existing; return session; }
    const prepared = readPrepared();
    if (!prepared) return null;
    return chair.newSession(sessionId, prepared);
  };

  const handler = (action) => async (_event, request) => {
    try { requireModule(); return { success: true, ...action(request) }; }
    catch (error) {
      const code = error && error.code;
      return { success: false, error: HOST_MESSAGES[code] || 'De agenda kon niet veilig worden bewaard of gelezen.', ...(HOST_MESSAGES[code] || code === 'module_disabled' ? { code } : {}) };
    }
  };

  // ---- Before: parse (deterministic, no model) and prepare for the next recording ----
  ipcMain.handle('veneta-agenda-parse', handler((request) => {
    if (!onlyKeys(request, ['text', 'sourceName']) || typeof request.text !== 'string' ||
        (Object.hasOwn(request, 'sourceName') && !(request.sourceName === null || (typeof request.sourceName === 'string' && request.sourceName.length <= 200)))) {
      throw new Error('Ongeldig verzoek.');
    }
    if (request.sourceName && !/\.(?:md|markdown|txt)$/i.test(request.sourceName)) throw hostError('file_type');
    const parsed = chair.parseAgenda(request.text, { sourceName: request.sourceName || null });
    if (!parsed.ok) throw hostError(parsed.code);
    return { agenda: parsed.agenda, dropped: parsed.dropped, merged: parsed.merged };
  }));
  ipcMain.handle('veneta-agenda-get-preparation', handler(() => ({ preparation: readPrepared() })));
  ipcMain.handle('veneta-agenda-prepare', handler((request) => {
    if (!onlyKeys(request, ['agenda'])) throw new Error('Ongeldig verzoek.');
    let agenda;
    try { agenda = chair.validateAgenda(request.agenda); }
    catch (error) { throw error && error.code === 'duplicate_items' ? hostError('duplicate_items') : error; }
    const previous = readPrepared();
    // An edited agenda is a new version of the same agenda.
    if (previous && previous.agendaId === agenda.agendaId && JSON.stringify(previous.items) !== JSON.stringify(agenda.items)) agenda.version = previous.version + 1;
    writeJson(guard(preparedFile()), { schemaVersion: 1, agenda });
    return { preparation: agenda };
  }));
  ipcMain.handle('veneta-agenda-clear-preparation', handler(() => { readPrepared(); removeFile(guard(preparedFile())); return {}; }));

  // ---- During: the host planner, fed by final live segments ----
  const fail = (reason) => ({ ok: false, reason: REASONS.has(reason) ? reason : 'failed' });
  const runAnalysis = async (request, { final = false } = {}) => {
    try {
      if (!moduleOn()) return fail('module_disabled');
      if (final) { let held = false; try { held = isOllamaBusy() === true; } catch (_) { held = false; } if (held) return fail('busy'); }
      if (modelSlot.busy) return fail('busy');
      try { chair.validateAgendaRequest(request); } catch (_) { return fail('invalid_request'); }
      modelSlot.busy = true;
      try {
        let raw;
        try { raw = await analyzeAgenda(clone(request)); }
        catch (error) { return fail(error && error.reason); }
        let response;
        try { response = chair.validateAgendaResponse(raw, request); } catch (_) { return fail('invalid_answer'); }
        if (!moduleOn()) return fail('module_disabled');
        return { ok: true, response };
      } finally { modelSlot.busy = false; }
    } catch (_) { return fail('failed'); }
  };
  const live = chair.createAgendaPlanner({
    ...liveTimers,
    moduleEnabled: moduleOn,
    attach,
    getFinals: getLiveFinals,
    analyze: runAnalysis,
    persist: persistSession,
    getReviews: (sessionId) => readReviews(sessionKey(sessionId)),
    keyOf: sessionKey,
    emit: emitLiveState,
    log: logLive,
  });
  onSettingsChanged(() => { if (!moduleOn()) live.cancel(); });
  ipcMain.handle('veneta-agenda-live-state', handler(() => ({ live: live.getState() })));
  ipcMain.handle('veneta-agenda-live-action', handler((request) => {
    const outcome = live.act(request);
    if (!outcome.ok) throw hostError(outcome.code);
    return { live: outcome.state };
  }));

  // ---- After: the minutes, bound to the note ----
  const readLink = (noteKey) => readJson(guard(linkFile(noteKey)), null, (value) => {
    if (!onlyKeys(value, ['schemaVersion', 'noteKey', 'sessionKey', 'boundAt']) || value.schemaVersion !== 1 || value.noteKey !== noteKey ||
        typeof value.sessionKey !== 'string' || !/^[a-f0-9]{64}$/.test(value.sessionKey) || typeof value.boundAt !== 'string') throw new Error('Ongeldige koppeling.');
    return value;
  });
  const noteBody = (noteFile) => {
    const link = readLink(noteKeyOf(noteFile));
    if (!link) return { found: false };
    const session = readSession(link.sessionKey);
    if (!session) return { found: false };
    const reviews = readReviews(link.sessionKey);
    const minutes = chair.buildMinutes(session, reviews);
    return { found: true, title: session.agenda.title, minutes, markdown: chair.minutesMarkdown(minutes),
      finalRunning: live.finalRunningFor(link.sessionKey) || live.finalPendingFor(link.sessionKey), sessionKey: link.sessionKey, session };
  };
  const publicNote = (body) => {
    if (!body.found) return { found: false };
    const { session: _session, sessionKey: _key, ...rest } = body;
    return rest;
  };
  /** Called by the host when a recording stops and it knows the note file: the only moment the link is certain. */
  const bindSessionToNote = (request) => {
    try {
      if (!onlyKeys(request, ['noteFile', 'recordingId', 'appended']) || typeof request.recordingId !== 'string' || typeof request.appended !== 'boolean') return false;
      const session = live.sessionId();
      if (!moduleOn() || !session) return false;
      if (session !== liveSessionId({ appendTarget: request.appended ? request.noteFile : null, startedAtMs: request.recordingId })) return false;
      const noteKey = noteKeyOf(request.noteFile);
      const key = sessionKey(session);
      if (!fs.existsSync(guard(sessionFile(key)))) return false;
      writeJson(guard(linkFile(noteKey)), { schemaVersion: 1, noteKey, sessionKey: key, boundAt: new Date().toISOString() });
      return true;
    } catch (_) { return false; }
  };
  ipcMain.handle('veneta-agenda-note-result', handler((request) => {
    if (!onlyKeys(request, ['noteFile']) || Object.keys(request).length !== 1) throw new Error('Ongeldige notitie.');
    return publicNote(noteBody(request.noteFile));
  }));
  // Human review of one finding: confirm, reject (with optional reason), correct (text, owner, deadline) or undo.
  ipcMain.handle('veneta-agenda-note-correct', handler((request) => {
    if (!onlyKeys(request, ['noteFile', 'findingId', 'action', 'text', 'owner', 'due', 'reason']) || typeof request.findingId !== 'string' ||
        !['confirm', 'reject', 'correct', 'clear'].includes(request.action)) throw new Error('Ongeldige correctie.');
    const body = noteBody(request.noteFile);
    if (!body.found || !body.session.findings.some((finding) => finding.id === request.findingId)) throw new Error('Onbekende bevinding.');
    const reviews = readReviews(body.sessionKey);
    const at = new Date().toISOString();
    const text = (value, max) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      if (typeof value !== 'string' || value.length > max) throw new Error('Ongeldige tekst.');
      return value.replace(/\s+/g, ' ').trim() || null;
    };
    if (request.action === 'clear') delete reviews[request.findingId];
    else if (request.action === 'confirm') reviews[request.findingId] = { status: 'bevestigd', at };
    else if (request.action === 'reject') {
      const reason = text(request.reason, MAX_REASON);
      reviews[request.findingId] = { status: 'afgewezen', at, ...(reason ? { reason } : {}) };
    } else {
      const corrected = { status: 'gecorrigeerd', at };
      const value = text(request.text, chair.LIMITS.findingText);
      if (value === null) throw new Error('Een correctie heeft tekst nodig.');
      if (value !== undefined) corrected.text = value;
      const owner = text(request.owner, chair.LIMITS.ownerChars);
      if (owner !== undefined) corrected.owner = owner;
      const due = text(request.due, chair.LIMITS.dueChars);
      if (due !== undefined) corrected.due = due;
      reviews[request.findingId] = corrected;
    }
    writeJson(guard(reviewsFile(body.sessionKey)), validateReviews({ schemaVersion: 1, reviews }));
    return publicNote(noteBody(request.noteFile));
  }));
  return { live, bindSessionToNote };
}

module.exports = { registerVenetaAgendaIpc, validateReviews };
