'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const LIMIT = 4 * 1024 * 1024;  // 0.9.2: token documents are larger than the 0.9.1 sentence documents
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const fail = () => new Error('Ongeldige detailniveaus.');
function sourceSections(meeting) {
  const sections = [];
  const overview = typeof meeting.summary === 'string' ? meeting.summary : meeting.summary?.overview;
  if (overview?.trim()) sections.push({ id: 'overview', title: 'Samenvatting', full: overview });
  for (const [i, area] of (meeting.discussion_areas || []).entries()) {
    if (typeof area?.analysis === 'string' && area.analysis.trim()) sections.push({ id: `discussion-${i}`, title: typeof area.title === 'string' ? area.title : 'Onderwerp', full: area.analysis });
  }
  // 0.9.1: the whole standard note folds, so its key points are a section too.
  const points = Array.isArray(meeting.key_points) ? meeting.key_points.filter(p => typeof p === 'string' && p.trim()) : [];
  if (points.length) sections.push({ id: 'key-points', title: 'Kernpunten', full: points.map(p => '- ' + p.trim()).join('\n') });
  if (!sections.length || sections.length > 64 || sections.reduce((n, s) => n + s.full.length + s.title.length, 0) > 96000) throw fail();
  return sections;
}
const ROLES = ['context', 'gap', 'claim', 'method', 'setup', 'result', 'analysis', 'limitation'];
const alnum = text => String(text).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const isIndex = (n, max) => Number.isInteger(n) && n >= 0 && n < max;
const TOKEN_KEYS = new Set(['t', 's', 'm', 'k']);
function checkTokens(toks, { allowM = false, allowK = false, max = 4096 } = {}) {
  if (!Array.isArray(toks) || toks.length > max) throw fail();
  for (const tok of toks) {
    if (!tok || typeof tok !== 'object' || Array.isArray(tok) || Object.keys(tok).some(k => !TOKEN_KEYS.has(k))) throw fail();
    if (typeof tok.t !== 'string' || !tok.t || tok.t.length > 400 || /\s/.test(tok.t)) throw fail();
    if (tok.s !== undefined && tok.s !== 1) throw fail();
    if ((tok.m !== undefined && !allowM) || (tok.k !== undefined && !allowK)) throw fail();
  }
  return toks;
}
const textOf = toks => toks.map((tok, i) => tok.t + (tok.s && i < toks.length - 1 ? ' ' : '')).join('');
function sourceLines(full) {
  return full.split('\n').map(line => line.trim()).filter(line => line && !/^(?:-{3,}|\*{3,}|_{3,})$/.test(line));
}
function checkUnit(unit, line, provenance) {
  if (!unit || typeof unit !== 'object' || !['paragraph', 'item', 'heading'].includes(unit.kind)) throw fail();
  if (unit.src !== line || typeof unit.full !== 'string' || !unit.full.trim()) throw fail();
  const body = unit.kind === 'heading' ? line.replace(/^#{1,6}\s+/, '') : unit.kind === 'item' ? line.replace(/^(?:[-*+]|\d{1,3}[.)])\s+/, '') : line;
  if (unit.kind === 'item' ? !/^(?:[-*+]|\d{1,3}[.)])$/.test(unit.marker) : unit.marker !== undefined) throw fail();
  // Inline Markdown markers may go; no word may be added or dropped.
  if (alnum(unit.full) !== alnum(body)) throw fail();
  checkTokens(unit.toks);
  if (textOf(unit.toks) !== unit.full) throw fail();
  if (unit.kind === 'heading') { if (unit.sents !== undefined || unit.lad !== undefined) throw fail(); return; }
  const { sents, lad } = unit;
  if (!Array.isArray(sents) || !sents.length || sents.length > 8192) throw fail();
  let at = 0;
  for (const range of sents) {
    if (!Array.isArray(range) || range.length !== 2 || range[0] !== at || !Number.isInteger(range[1]) || range[1] <= range[0]) throw fail();
    at = range[1];
  }
  if (at !== unit.toks.length) throw fail();
  if (!lad || typeof lad !== 'object' || !ROLES.includes(lad.role) || !['ai', 'local'].includes(lad.model)) throw fail();
  if (provenance === 'local' && lad.model !== 'local') throw fail();
  if (!Array.isArray(lad.ev) || !lad.ev.length || lad.ev.length > 3 || new Set(lad.ev).size !== lad.ev.length || lad.ev.some((n, i) => !isIndex(n, sents.length) || (i && n <= lad.ev[i - 1]))) throw fail();
  const evTokens = new Set(lad.ev.flatMap(n => Array.from({ length: sents[n][1] - sents[n][0] }, (_, i) => sents[n][0] + i)));
  checkTokens(lad.brief, { allowM: true, max: 1024 });
  let last = -1;
  for (const tok of lad.brief) if (tok.m !== undefined) { if (!isIndex(tok.m, unit.toks.length) || !evTokens.has(tok.m) || tok.m <= last) throw fail(); last = tok.m; }
  if (!Number.isInteger(lad.tn) || lad.tn < 0 || lad.tn > lad.brief.length) throw fail();
  checkTokens(lad.topic, { allowK: true, max: 64 });
  for (const tok of lad.topic) if (tok.k !== undefined && !isIndex(tok.k, lad.tn)) throw fail();
}
function validateDocument(doc, request, expected) {
  if (!doc || doc.schemaVersion !== 2 || doc.sourceHash !== request.sourceHash || !['ai', 'local'].includes(doc.provenance) || (expected && doc.provenance !== expected) || !Array.isArray(doc.sections) || doc.sections.length !== request.sections.length) throw fail();
  for (const [i, section] of doc.sections.entries()) {
    const source = request.sections[i];
    if (!section || section.id !== source.id || section.title !== source.title || section.full !== source.full) throw fail();
    if (!Array.isArray(section.units) || !section.units.length || section.units.length > 2048) throw fail();
    const lines = sourceLines(source.full);
    if (lines.length !== section.units.length) throw fail();
    section.units.forEach((unit, n) => checkUnit(unit, lines[n], doc.provenance));
    if (!section.units.some(unit => unit.kind !== 'heading')) throw fail();
    const line = section.lad;
    if (line !== null && line !== undefined) {
      if (doc.provenance === 'local' || typeof line !== 'object' || !Array.isArray(line.topic)) throw fail();
      checkTokens(line.take, { max: 128 });
      if (line.topic.some(n => !isIndex(n, line.take.length))) throw fail();
    }
  }
  if (Buffer.byteLength(JSON.stringify(doc)) > LIMIT) throw fail();
  return doc;
}
const { REASONS } = require('./summary-folding-runner');
const reasonOf = error => (REASONS.has(error?.reason) ? error.reason : 'failed');
function registerSummaryFoldingIpc({ ipcMain, getUserDataDir, readMeeting, evaluate, evaluateLocal, cancelRun = () => {}, runPythonScript, isBusy = () => false }) {
  let active = false;
  function cacheFile(realPath) { return path.join(getUserDataDir(), 'summary-folding', hash(realPath) + '.json'); }
  function checkDirectory(create = false) {
    const directory = path.join(getUserDataDir(), 'summary-folding');
    try {
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) throw fail();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!create) return false;
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      return checkDirectory();
    }
    return true;
  }
  function cached(snapshot, request) {
    if (!checkDirectory()) return null;
    let fd;
    try {
      fd = fs.openSync(cacheFile(snapshot.cacheIdentity || snapshot.realPath), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > LIMIT || (process.getuid && stat.uid !== process.getuid())) throw fail();
      const record = JSON.parse(fs.readFileSync(fd, 'utf8'));
      if (record.fingerprint !== snapshot.fingerprint || record.document?.sourceHash !== request.sourceHash) return null;
      // An older cache (other schema or a failed check) is simply not a cache: it is prepared again.
      try { return validateDocument(record.document, request, 'ai'); } catch (_) { return null; }
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  async function prepare(file, reportId) {
    if (typeof file !== 'string' || file.length > 32768) throw fail();
    const snapshot = await readMeeting(file);
    let meeting = snapshot.meeting;
    if (reportId !== undefined && reportId !== null) {
      if (typeof reportId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(reportId)) throw fail();
      const report = meeting.reports?.find(item => item.id === reportId);
      if (!report || typeof report.content !== 'string') throw fail();
      meeting = { summary: report.content.replace(/(?:^[ \t]*)?<(think|thought|thinking|reasoning)>[\s\S]*?(?:<\/\1>|$(?![\s\S]))\n?/gim, '').replace(/^\n+/, '') };
      snapshot.cacheIdentity = snapshot.realPath + '\0' + reportId;
    }
    const sections = sourceSections(meeting);
    const request = { schemaVersion: 2, sourceHash: hash(JSON.stringify(sections)), sections };
    return { snapshot, request };
  }
  ipcMain.handle('summary-fold-load', async (_event, file, reportId) => {
    try {
      const { snapshot, request } = await prepare(file, reportId);
      return { success: true, document: cached(snapshot, request) };
    } catch (_) { return { success: false, error: 'Detailniveaus konden niet worden geladen. De oorspronkelijke samenvatting blijft beschikbaar.' }; }
  });
  // 0.9.2: all five levels at once from the author's own words (TextFold's local mode). Deterministic, no model,
  // never cached: computed from the same canonical source and validated like an AI document.
  ipcMain.handle('summary-fold-local', async (_event, file, reportId) => {
    try {
      if (typeof evaluateLocal !== 'function') throw fail();
      const { request } = await prepare(file, reportId);
      return { success: true, document: validateDocument(await evaluateLocal(request), request, 'local') };
    } catch (_) { return { success: false, error: 'Voorlopige niveaus konden niet worden gemaakt. De oorspronkelijke samenvatting blijft beschikbaar.' }; }
  });
  ipcMain.handle('summary-fold-cancel', async () => { try { cancelRun(); } catch (_) { /* Nothing to stop. */ } return { success: true }; });
  ipcMain.handle('summary-fold-generate', async (event, file, reportId) => {
    if (active || isBusy()) return { success: false, error: 'Wacht tot de huidige verwerking is afgerond.', reason: 'busy' };
    active = true;
    let staged;
    try {
      const { snapshot, request } = await prepare(file, reportId);
      const existing = cached(snapshot, request);
      if (existing) return { success: true, document: existing };
      // Counters only, and only to the window that asked.
      const onProgress = ({ done, total }) => {
        const sender = event?.sender;
        if (sender && !(typeof sender.isDestroyed === 'function' && sender.isDestroyed())) sender.send('summary-fold-progress', { done, total });
      };
      const document = validateDocument(await evaluate(request, { onProgress }), request, 'ai');
      const latest = await prepare(file, reportId);
      if (latest.snapshot.fingerprint !== snapshot.fingerprint || latest.snapshot.realPath !== snapshot.realPath || latest.request.sourceHash !== request.sourceHash) throw fail();
      checkDirectory(true);
      const destination = cacheFile(snapshot.cacheIdentity || snapshot.realPath);
      staged = destination + '.' + crypto.randomUUID() + '.tmp';
      const fd = fs.openSync(staged, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify({ fingerprint: snapshot.fingerprint, document })); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      checkDirectory();
      fs.renameSync(staged, destination);
      staged = undefined;
      return { success: true, document };
    } catch (error) { return { success: false, error: 'Detailniveaus konden niet worden voorbereid. Je bestaande samenvatting is niet gewijzigd.', reason: reasonOf(error) }; }
    finally {
      active = false;
      if (staged) { try { fs.unlinkSync(staged); } catch (_) { /* Only the owned temporary cache is eligible for cleanup. */ } }
    }
  });
  ipcMain.handle('get-summary-detail', async () => {
    try {
      const settings = JSON.parse(await runPythonScript('simple_recorder.py', ['get-summary-detail'], true));
      if (!['brief', 'balanced', 'detailed'].includes(settings.summary_detail)) throw fail();
      return { success: true, summary_detail: settings.summary_detail };
    } catch (_) { return { success: false, error: 'De samenvattingsinstelling kon niet worden geladen.' }; }
  });
  ipcMain.handle('set-summary-detail', async (_event, value) => {
    try {
      if (!['brief', 'balanced', 'detailed'].includes(value)) throw fail();
      const settings = JSON.parse(await runPythonScript('simple_recorder.py', ['set-summary-detail', value], true));
      if (settings.summary_detail !== value) throw fail();
      return { success: true, summary_detail: value };
    } catch (_) { return { success: false, error: 'De samenvattingsinstelling kon niet worden opgeslagen.' }; }
  });
}
module.exports = { registerSummaryFoldingIpc, sourceSections, validateDocument };
