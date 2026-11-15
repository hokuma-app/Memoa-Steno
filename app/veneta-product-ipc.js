'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { CHECKLIST_REASONS } = require('./veneta-checklist-runner');

const MODULE = 'conversation-checklist';
// Optional modules of the Veneta profile. The checklist key is always stored; a newer module key is optional (absent = off),
// so settings files written before that module existed stay valid and unchanged.
const AGENDA_MODULE = 'agenda-chair';
const MODULES = new Set([MODULE, AGENDA_MODULE]);
const PROFILES = new Set(['default', 'veneta']);
const STATES = new Set(['unmentioned', 'partial', 'covered', 'uncertain']);
// Humans may also mark a point "Niet van toepassing" (with a short reason); the AI never may.
const HUMAN_STATES = new Set([...STATES, 'notApplicable']);
const KINDS = new Set(['none', 'mentioned', 'explained']);
const MAX_QUOTES = 3;
const MAX_REASON = 200;
const REASONS = new Set([...CHECKLIST_REASONS, 'module_disabled', 'busy']);
const FAILURE_TEXT = 'De checklist kon niet veilig worden beoordeeld. Controleer het lokale model en de invoer.';
const { buildOverview, overviewMarkdown } = require('./veneta-checklist-overview');
const { loadStandardChecklists, normalizeName } = require('./veneta-standard-checklists');
const { createLiveChecklistPlanner, uniqueCriteria, liveSessionId } = require('./veneta-live-checklist');
// A refusal the interface can explain, without leaking content; other failures stay generic.
const HOST_MESSAGES = {
  name_taken: 'Deze naam is al in gebruik. Kies een andere naam voor je eigen checklist.',
  locked: 'De Veneta-standaard staat vast en kan niet worden gewijzigd of verwijderd.',
  unavailable: 'De inhoud van deze standaard volgt nog van Veneta. Kies een andere checklist.',
  duplicate_criteria: 'Dit lijstje bevat dubbele punten. Voeg ze samen of verwijder ze.',
};
const hostError = (code) => Object.assign(new Error(HOST_MESSAGES[code]), { code });
// A citation is at least three characters and starts and ends on word boundaries inside its segment.
const WORD = '[\\p{L}\\p{N}_]';
const wholeWordQuote = (text, quote) => {
  if (typeof quote !== 'string' || quote.trim().length < 3) return false;
  const escaped = quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const head = new RegExp(`^${WORD}`, 'u').test(quote) ? `(?<!${WORD})` : '';
  const tail = new RegExp(`${WORD}$`, 'u').test(quote) ? `(?!${WORD})` : '';
  return new RegExp(head + escaped + tail, 'u').test(text);
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const onlyKeys = (value, keys) => object(value) && Object.keys(value).every((key) => keys.includes(key));

function validateSettings(value) {
  if (!onlyKeys(value, ['schemaVersion', 'profile', 'modules']) || value.schemaVersion !== 1 ||
      !PROFILES.has(value.profile) || !onlyKeys(value.modules, [...MODULES]) || typeof value.modules[MODULE] !== 'boolean' ||
      Object.values(value.modules).some((flag) => typeof flag !== 'boolean')) {
    throw new Error('Ongeldige productinstellingen.');
  }
  return clone(value);
}

function safeRead(file, fallback, validate) {
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return clone(fallback); throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 262144) throw new Error('Onveilige of te grote moduleopslag.');
  return validate(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function assertDirectory(directory) {
  try {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Onveilige modulemap.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function atomicWrite(file, value) {
  const directory = path.dirname(file);
  assertDirectory(directory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Moduleopslag mag geen symbolische koppeling zijn.');
  if (fs.existsSync(file) && !fs.lstatSync(file).isFile()) throw new Error('Ongeldige moduleopslag.');
  const temporary = path.join(directory, `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function atomicWriteText(file, text) {
  const directory = path.dirname(file);
  assertDirectory(directory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Moduleopslag mag geen symbolische koppeling zijn.');
  if (fs.existsSync(file) && !fs.lstatSync(file).isFile()) throw new Error('Ongeldige moduleopslag.');
  const temporary = path.join(directory, `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, text, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function createProductSettingsStore({ userDataDir, defaultProfile = 'default' }) {
  if (!PROFILES.has(defaultProfile)) throw new Error('Onbekend standaardprofiel.');
  const directory = path.join(userDataDir, 'veneta-modules');
  const filePath = path.join(directory, 'product-settings.json');
  const defaults = { schemaVersion: 1, profile: defaultProfile, modules: { [MODULE]: false } };
  const get = () => {
    assertDirectory(directory);
    return safeRead(filePath, defaults, validateSettings);
  };
  const set = (patch) => {
    if (!onlyKeys(patch, ['profile', 'modules']) ||
        (Object.hasOwn(patch, 'profile') && !PROFILES.has(patch.profile)) ||
        (Object.hasOwn(patch, 'modules') && (!onlyKeys(patch.modules, [...MODULES]) ||
          Object.values(patch.modules).some((value) => typeof value !== 'boolean')))) {
      throw new Error('Ongeldige wijziging van productinstellingen.');
    }
    const current = get();
    const next = validateSettings({ ...current, ...patch, modules: { ...current.modules, ...patch.modules } });
    atomicWrite(filePath, next);
    return next;
  };
  return { filePath, get, set, moduleEnabled: (id) => {
    const settings = get();
    return MODULES.has(id) && settings.profile === 'veneta' && settings.modules[id] === true;
  } };
}

function validateRequest(request) {
  if (!onlyKeys(request, ['sessionId', 'revision', 'mappingConfirmed', 'criteria', 'segments']) ||
      typeof request.sessionId !== 'string' || !request.sessionId.trim() || request.sessionId.length > 128 ||
      typeof request.revision !== 'string' || !request.revision || request.revision.length > 128 ||
      typeof request.mappingConfirmed !== 'boolean' || !Array.isArray(request.criteria) ||
      request.criteria.length < 1 || request.criteria.length > 32 || !Array.isArray(request.segments) ||
      request.segments.length < 1 || request.segments.length > 256 || JSON.stringify(request).length > 100000) {
    throw new Error('Ongeldige gesprekschecklist.');
  }
}

function validateAssessmentResponse(response, request) {
  if (!object(response) || response.revision !== request.revision || !Array.isArray(response.assessments) || response.error) {
    throw new Error('De checklistanalyse leverde geen geldig resultaat.');
  }
  const criteria = new Set(request.criteria.map((item) => item.id));
  const segments = new Map(request.segments.map((item) => [item.id, item]));
  const grounded = (items, speaker) => Array.isArray(items) && items.length <= 16 && items.every((evidence) => {
    const segment = object(evidence) ? segments.get(evidence.segmentId) : null;
    return segment && wholeWordQuote(segment.text, evidence.quote)
      && (speaker === undefined || segment.speaker === speaker);
  });
  const seen = new Set(); const normalized = [];
  for (const item of response.assessments) {
    if (!object(item) || !criteria.has(item.criterionId) || seen.has(item.criterionId) || !STATES.has(item.status) ||
        !Array.isArray(item.evidence) || typeof item.explanation !== 'string' || item.explanation.length > 2000) {
      throw new Error('Onbetrouwbare checklistbeoordeling.');
    }
    seen.add(item.criterionId);
    const sellerProof = request.mappingConfirmed && item.evidence.length > 0 && item.evidence.every((evidence) =>
      segments.get(evidence.segmentId)?.speaker === 'seller');
    if (!grounded(item.evidence) || (item.status === 'covered' && !sellerProof)) throw new Error('De brononderbouwing van de checklist klopt niet.');
    // Levels are separate fields; absent ones (older backend) get conservative defaults.
    const explicit = ['kind', 'customerConfirmed', 'customerEvidence'].some((key) => Object.hasOwn(item, key));
    const kind = explicit ? item.kind : item.status === 'covered' ? 'explained' : item.evidence.length ? 'mentioned' : 'none';
    const customerEvidence = explicit ? item.customerEvidence : [];
    const customerConfirmed = explicit ? item.customerConfirmed : false;
    if (!KINDS.has(kind) || typeof customerConfirmed !== 'boolean' || !grounded(customerEvidence, 'other') ||
        customerEvidence.length > MAX_QUOTES ||
        (customerConfirmed && customerEvidence.length === 0) || (!customerConfirmed && customerEvidence.length > 0) ||
        // "Explained" is exactly the covered status: a customer or an unconfirmed channel never explains.
        (kind === 'explained') !== (item.status === 'covered') || (kind === 'none' && item.evidence.length > 0)) {
      throw new Error('De bewijsniveaus van de checklist kloppen niet.');
    }
    normalized.push({ criterionId: item.criterionId, status: item.status, evidence: clone(item.evidence), explanation: item.explanation,
      kind, customerConfirmed, customerEvidence: clone(customerEvidence) });
  }
  if (seen.size !== criteria.size) throw new Error('De checklistbeoordeling is onvolledig.');
  return { revision: response.revision, assessments: normalized };
}

function validateCriteria(criteria) {
  if (!Array.isArray(criteria) || criteria.length > 32) throw new Error('Ongeldige checklistpunten.');
  const ids = new Set(); let length = 0;
  for (const item of criteria) {
    if (!onlyKeys(item, ['id', 'label', 'required']) || typeof item.id !== 'string' || !item.id || item.id.length > 128 ||
        ['__proto__', 'constructor', 'prototype'].includes(item.id) || ids.has(item.id) ||
        typeof item.label !== 'string' || !item.label.trim() || typeof item.required !== 'boolean') throw new Error('Ongeldig checklistpunt.');
    ids.add(item.id); length += item.label.length;
  }
  if (length > 24000) throw new Error('Te veel checklisttekst.');
  return clone(criteria);
}

// Human corrections are only "Niet van toepassing" (with a reason) or a rejected AI tick (back to not heard,
// with a reason). Older 0.9.2 drafts may still hold manual statuses: they stay readable but are never counted
// (see the overview) and can no longer be written.
function validateDraft(draft, { strict = false } = {}) {
  if (!onlyKeys(draft, ['criteria', 'manualOverrides', 'templateId', 'templateName']) || !object(draft.manualOverrides) ||
      (Object.hasOwn(draft, 'templateId') && (typeof draft.templateId !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(draft.templateId))) ||
      (Object.hasOwn(draft, 'templateName') && (typeof draft.templateName !== 'string' || !draft.templateName.trim() || draft.templateName.length > 120))) {
    throw new Error('Ongeldige checklist.');
  }
  const criteria = validateCriteria(draft.criteria);
  const ids = new Set(criteria.map((item) => item.id));
  for (const [id, override] of Object.entries(draft.manualOverrides)) {
    if (!ids.has(id) || !onlyKeys(override, ['origin', 'status', 'reason', 'rejected']) || override.origin !== 'human' || !HUMAN_STATES.has(override.status)) {
      throw new Error('Ongeldige handmatige correctie.');
    }
    const reasonOk = typeof override.reason === 'string' && override.reason.trim() && override.reason.length <= MAX_REASON;
    if (override.status === 'notApplicable') {
      if (!reasonOk || Object.hasOwn(override, 'rejected')) throw new Error('Ongeldige reden voor de handmatige correctie.');
    } else if (Object.hasOwn(override, 'rejected')) {
      if (override.rejected !== true || override.status !== 'unmentioned' || !reasonOk) throw new Error('Ongeldige afwijzing.');
    } else if (strict || Object.hasOwn(override, 'reason')) {
      throw new Error('Handmatig afvinken is niet toegestaan.');
    }
  }
  return { criteria, manualOverrides: clone(draft.manualOverrides),
    ...(Object.hasOwn(draft, 'templateId') ? { templateId: draft.templateId } : {}),
    ...(Object.hasOwn(draft, 'templateName') ? { templateName: draft.templateName } : {}) };
}

function sessionKey(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 128) throw new Error('Ongeldig gesprek.');
  return crypto.createHash('sha256').update(sessionId).digest('hex');
}

function registerVenetaProductIpc({ ipcMain, getUserDataDir, defaultProfile = 'default', isBusy = () => false, evaluateChecklist,
  getLiveFinals = () => [], emitLiveState = () => {}, logLive = () => {}, liveTimers = {}, isOllamaBusy = () => false,
  standardChecklistsDir = path.join(__dirname, 'veneta-standard-checklists'), modelSlot = { busy: false } }) {
  const store = () => createProductSettingsStore({ userDataDir: getUserDataDir(), defaultProfile });
  // One local model slot, shared with every Veneta module that analyses (the agenda chair passes the same object).
  const slot = modelSlot;
  const settingsListeners = new Set();
  ipcMain.handle('get-product-settings', async () => {
    try { return { success: true, settings: store().get() }; }
    catch (_) { return { success: false, error: 'Productinstellingen kunnen niet veilig worden gelezen.' }; }
  });
  ipcMain.handle('set-product-settings', async (_event, patch) => {
    try {
      const current = store();
      if (Object.hasOwn(patch || {}, 'profile') && patch.profile !== current.get().profile && (isBusy() || slot.busy)) {
        return { success: false, error: 'Stop eerst de opname of lopende verwerking voordat je het profiel wisselt.' };
      }
      const settings = current.set(patch);
      if (!current.moduleEnabled(MODULE)) {
        live.cancel();
        if (typeof evaluateChecklist?.cancelAll === 'function') evaluateChecklist.cancelAll();
      }
      for (const listener of settingsListeners) { try { listener(); } catch (_) { /* A module reacts on its own; settings stay saved. */ } }
      return { success: true, settings };
    } catch (_) { return { success: false, error: 'Productinstellingen konden niet veilig worden opgeslagen.' }; }
  });
  const requireModule = () => { if (!store().moduleEnabled(MODULE)) throw new Error('Module uitgeschakeld.'); };
  const templateFile = () => path.join(getUserDataDir(), 'veneta-modules', 'checklist-template.json');
  const draftFile = (id) => path.join(getUserDataDir(), 'veneta-modules', 'drafts', sessionKey(id) + '.json');
  const readDraft = (id) => {
    const file = draftFile(id); assertDirectory(path.dirname(file));
    const criteria = safeRead(templateFile(), [], validateCriteria);
    return safeRead(file, { criteria, manualOverrides: {} }, validateDraft);
  };
  const namedFile = () => path.join(getUserDataDir(), 'veneta-modules', 'checklist-templates.json');
  const preparedFile = () => path.join(getUserDataDir(), 'veneta-modules', 'checklist-preparation.json');
  const settingsFile = () => path.join(getUserDataDir(), 'veneta-modules', 'checklist-settings.json');
  const validateNamed = (items) => {
    if (!Array.isArray(items) || items.length > 64) throw new Error('Ongeldige sjablonen.');
    const ids = new Set();
    return items.map(item => {
      if (!onlyKeys(item, ['id', 'name', 'criteria']) || typeof item.id !== 'string' ||
          !/^[a-zA-Z0-9-]{1,128}$/.test(item.id) || ids.has(item.id) ||
          typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120) throw new Error('Ongeldig sjabloon.');
      ids.add(item.id);
      const criteria = validateCriteria(item.criteria);
      if (!criteria.length) throw new Error('Voeg eerst checklistpunten toe.');
      return { id: item.id, name: item.name, criteria };
    });
  };
  const readNamed = () => safeRead(namedFile(), [], validateNamed);
  const standards = () => loadStandardChecklists(standardChecklistsDir).standards;
  const readPrepared = () => safeRead(preparedFile(), null, value => {
    if (!onlyKeys(value, ['templateId', 'criteria', 'manualOverrides']) || typeof value.templateId !== 'string' ||
        !/^[a-zA-Z0-9-]{1,128}$/.test(value.templateId)) throw new Error('Ongeldige voorbereiding.');
    return { templateId: value.templateId, ...validateDraft({ criteria: value.criteria, manualOverrides: value.manualOverrides }) };
  });
  // The prepared standard always follows the shipped definition; an emptied or removed standard is not prepared.
  const readPreparation = () => {
    const prepared = readPrepared();
    if (!prepared) return null;
    const standard = standards().find(item => item.id === prepared.templateId);
    if (standard) return standard.available ? { templateId: standard.id, name: standard.name, locked: true, criteria: standard.criteria, manualOverrides: {} } : null;
    const own = readNamed().find(item => item.id === prepared.templateId);
    return own ? { ...prepared, name: own.name, locked: false } : null;
  };
  const removeFile = (file) => {
    let stat;
    try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Ongeldige moduleopslag.');
    fs.unlinkSync(file);
  };
  let activeSession = null;
  const checklistHandler = action => async (_event, request) => {
    try { requireModule(); return { success: true, ...action(request) }; }
    catch (error) {
      return { success: false, error: (error && HOST_MESSAGES[error.code]) || 'De checklist kon niet veilig worden bewaard of gelezen.',
        ...(error && HOST_MESSAGES[error.code] ? { code: error.code } : {}) };
    }
  };
  ipcMain.handle('veneta-checklist-list-templates', checklistHandler(() => ({
    // Old lists may hold the same point twice; the display never does (the file stays as the user saved it).
    templates: readNamed().map(item => ({ ...item, criteria: uniqueCriteria(item.criteria) })),
    standards: standards().map(({ criteria, ...rest }) => ({ ...rest, criteriaCount: criteria.length })),
    preparation: readPreparation(),
  })));
  ipcMain.handle('veneta-checklist-save-named-template', checklistHandler(request => {
    if (!onlyKeys(request, ['id', 'name', 'criteria'])) throw new Error('Ongeldig verzoek.');
    const fixed = standards();
    if (fixed.some(standard => standard.id === request.id)) throw hostError('locked');
    const items = readNamed();
    const item = validateNamed([{ ...request, id: request.id ?? crypto.randomUUID() }])[0];
    if (uniqueCriteria(item.criteria).length !== item.criteria.length) throw hostError('duplicate_criteria');
    const taken = [...fixed.map(standard => standard.name), ...items.filter(existing => existing.id !== item.id).map(existing => existing.name)];
    if (taken.some(name => normalizeName(name) === normalizeName(item.name))) throw hostError('name_taken');
    const index = items.findIndex(existing => existing.id === item.id);
    if (request.id !== undefined && index < 0) throw new Error('Onbekend sjabloon.');
    if (index < 0) items.push(item); else items[index] = item;
    if (Buffer.byteLength(JSON.stringify(items, null, 2) + '\n') > 262144) throw new Error('Te veel sjabloonopslag.');
    atomicWrite(namedFile(), validateNamed(items));
    return { template: item };
  }));
  ipcMain.handle('veneta-checklist-delete-named-template', checklistHandler(request => {
    if (!onlyKeys(request, ['id']) || typeof request.id !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(request.id)) throw new Error('Ongeldig verzoek.');
    if (standards().some(standard => standard.id === request.id)) throw hostError('locked');
    const items = readNamed();
    if (!items.some(item => item.id === request.id)) throw new Error('Onbekend sjabloon.');
    const prepared = readPrepared();
    atomicWrite(namedFile(), validateNamed(items.filter(item => item.id !== request.id)));
    if (prepared && prepared.templateId === request.id) removeFile(preparedFile());
    return {};
  }));
  ipcMain.handle('veneta-checklist-prepare', checklistHandler(request => {
    if (!onlyKeys(request, ['templateId'])) throw new Error('Ongeldig verzoek.');
    const standard = standards().find(item => item.id === request.templateId);
    if (standard && !standard.available) throw hostError('unavailable');
    const item = standard || readNamed().find(item => item.id === request.templateId);
    if (!item) throw new Error('Kies een opgeslagen sjabloon.');
    readPrepared();
    const draft = { criteria: uniqueCriteria(item.criteria), manualOverrides: {} };
    atomicWrite(preparedFile(), { templateId: item.id, ...draft });
    return { draft };
  }));
  ipcMain.handle('veneta-checklist-clear-preparation', checklistHandler(() => { readPrepared(); removeFile(preparedFile()); return {}; }));
  ipcMain.handle('veneta-checklist-get-settings', checklistHandler(() => ({ settings: { micIsSeller: readSettings().micIsSeller } })));
  ipcMain.handle('veneta-checklist-set-settings', checklistHandler(request => {
    if (!onlyKeys(request, ['micIsSeller']) || Object.keys(request).length !== 1 || typeof request.micIsSeller !== 'boolean') throw new Error('Ongeldige instelling.');
    readSettings();
    atomicWrite(settingsFile(), { schemaVersion: 1, micIsSeller: request.micIsSeller });
    return { settings: { micIsSeller: request.micIsSeller } };
  }));
  const readSettings = () => safeRead(settingsFile(), { schemaVersion: 1, micIsSeller: true }, value => {
    if (!onlyKeys(value, ['schemaVersion', 'micIsSeller']) || value.schemaVersion !== 1 || typeof value.micIsSeller !== 'boolean') throw new Error('Ongeldige instelling.');
    return value;
  });
  // Without a prepared checklist a conversation has none: the 0.9.2 default list never turns into one silently.
  const attachPrepared = (id) => {
    const file = draftFile(id);
    assertDirectory(path.dirname(file));
    // Existing progress always wins, including repeated mounts and continued recordings.
    if (fs.existsSync(file)) {
      const existing = safeRead(file, null, validateDraft);
      activeSession = existing.criteria.length ? id : null;
      return existing;
    }
    const prepared = readPreparation();
    if (!prepared) { activeSession = null; return { criteria: [], manualOverrides: {} }; }
    const draft = { criteria: uniqueCriteria(prepared.criteria), manualOverrides: {}, templateId: prepared.templateId, templateName: prepared.name };
    atomicWrite(file, draft);
    activeSession = id;
    return draft;
  };
  ipcMain.handle('veneta-checklist-attach-prepared', checklistHandler(id => ({ draft: attachPrepared(id) })));
  ipcMain.handle('veneta-checklist-load-draft', async (_event, id) => {
    try { requireModule(); return { success: true, draft: readDraft(id) }; }
    catch (_) { return { success: false, error: 'De opgeslagen checklist kan niet veilig worden gelezen.' }; }
  });
  ipcMain.handle('veneta-checklist-save-draft', async (_event, request) => {
    try {
      requireModule();
      if (!onlyKeys(request, ['sessionId', 'criteria', 'manualOverrides'])) throw new Error('Ongeldig verzoek.');
      const draft = validateDraft({ criteria: request.criteria, manualOverrides: request.manualOverrides }, { strict: true });
      const existing = readDraft(request.sessionId); // Never silently replace corrupt existing module data.
      // Which checklist a conversation used is not the interface's to change.
      const meta = { ...(existing.templateId ? { templateId: existing.templateId } : {}), ...(existing.templateName ? { templateName: existing.templateName } : {}) };
      atomicWrite(draftFile(request.sessionId), { ...draft, ...meta });
      return { success: true, draft: { ...draft, ...meta } };
    } catch (_) { return { success: false, error: 'De checklist kon niet veilig worden opgeslagen.' }; }
  });
  ipcMain.handle('veneta-checklist-save-template', async (_event, criteria) => {
    try {
      requireModule(); const next = validateCriteria(criteria);
      safeRead(templateFile(), [], validateCriteria);
      atomicWrite(templateFile(), next);
      return { success: true };
    } catch (_) { return { success: false, error: 'De standaardchecklist kon niet veilig worden opgeslagen.' }; }
  });
  const fail = (reason, error = FAILURE_TEXT) => ({ success: false, error, reason: REASONS.has(reason) ? reason : 'failed' });
  const evaluationFile = (sessionId) => path.join(getUserDataDir(), 'veneta-modules', 'checklists', sessionKey(sessionId) + '.json');
  const persistEvaluation = (request, response) => atomicWrite(evaluationFile(request.sessionId), {
    schemaVersion: 1, savedAt: new Date().toISOString(), request, response,
  });
  /** The one guarded route to the local model, shared by the manual IPC and the host planner: module on, one at a time, validated. */
  const runEvaluation = async (request, { final = false } = {}) => {
    try {
      if (!store().moduleEnabled(MODULE)) return fail('module_disabled', 'Schakel de Gesprekschecklist eerst in binnen Veneta.');
      // The last check at stop competes with the summary of that very conversation (and any reprocess) for the one
      // local model: it yields and is retried by the planner, bounded.
      if (final) { let held = false; try { held = isOllamaBusy() === true; } catch (_) { held = false; } if (held) return fail('busy', 'Een samenvatting gebruikt het model.'); }
      if (slot.busy) return fail('busy', 'Er loopt al een checklistanalyse.');
      try { validateRequest(request); } catch (_) { return fail('invalid_request'); }
      slot.busy = true;
      try {
        let raw;
        try { raw = await evaluateChecklist(clone(request)); }
        catch (error) { return fail(error && error.reason); }
        let response;
        try { response = validateAssessmentResponse(raw, request); } catch (_) { return fail('invalid_answer'); }
        if (!store().moduleEnabled(MODULE)) return fail('module_disabled', 'De Gesprekschecklist is inmiddels uitgeschakeld.');
        return { success: true, response };
      } finally { slot.busy = false; }
    } catch (_) { return fail('failed'); }
  };
  ipcMain.handle('veneta-checklist-evaluate', async (_event, request) => {
    const outcome = await runEvaluation(request);
    if (!outcome.success) return outcome;
    try { persistEvaluation(request, outcome.response); }
    catch (_) { return fail('failed'); }
    return { success: true, ...outcome.response };
  });

  // ---- Live check planned by the host: independent of any component's lifetime ----
  const live = createLiveChecklistPlanner({
    ...liveTimers,
    moduleEnabled: () => store().moduleEnabled(MODULE),
    getMicIsSeller: () => readSettings().micIsSeller,
    keyOf: sessionKey,
    getFinals: getLiveFinals,
    attach: (id) => attachPrepared(id),
    evaluate: async (request, options) => {
      const outcome = await runEvaluation(request, { final: Boolean(options && options.final) });
      return outcome.success ? { ok: true, response: outcome.response } : { ok: false, reason: outcome.reason };
    },
    persist: persistEvaluation,
    emit: emitLiveState,
    log: logLive,
  });
  ipcMain.handle('veneta-checklist-live-state', checklistHandler(() => ({ live: live.getState() })));

  // ---- Overview after the conversation: derived, read-only with respect to notes and transcripts ----
  const overviewsDir = () => path.join(getUserDataDir(), 'veneta-modules', 'overviews');
  const identity = (request) => {
    if (!onlyKeys(request, ['sessionId', 'sessionKey']) || Object.keys(request).length !== 1) throw new Error('Ongeldig gesprek.');
    if (Object.hasOwn(request, 'sessionKey')) {
      if (typeof request.sessionKey !== 'string' || !/^[a-f0-9]{64}$/.test(request.sessionKey)) throw new Error('Ongeldig gesprek.');
      return request.sessionKey;
    }
    return sessionKey(request.sessionId);
  };
  const readEvaluation = (key) => safeRead(path.join(getUserDataDir(), 'veneta-modules', 'checklists', key + '.json'), null, (value) => {
    if (!onlyKeys(value, ['schemaVersion', 'savedAt', 'request', 'response']) || value.schemaVersion !== 1 || typeof value.savedAt !== 'string') {
      throw new Error('Ongeldige beoordeling.');
    }
    validateRequest(value.request);
    return { savedAt: value.savedAt, request: value.request, response: validateAssessmentResponse(value.response, value.request) };
  });
  const overviewForKey = (key, { title } = {}) => {
    const file = path.join(getUserDataDir(), 'veneta-modules', 'drafts', key + '.json');
    assertDirectory(path.dirname(file));
    if (!fs.existsSync(file)) throw new Error('Geen checklist voor dit gesprek.');
    const draft = safeRead(file, null, validateDraft);
    // The same points the planner checked: a duplicate in an older stored list is one point, not a point that stays unheard.
    const overview = buildOverview({ criteria: uniqueCriteria(draft.criteria), manualOverrides: draft.manualOverrides, evaluation: readEvaluation(key) });
    const name = draft.templateName || null;
    return { key, draft, name, overview, markdown: overviewMarkdown(overview, name || title ? { title: title || `Checklist ${name}` } : undefined) };
  };
  const overviewFor = (request) => overviewForKey(identity(request));

  // ---- Result bound to the note itself: a sidecar in the module namespace, never inside the note ----
  const noteKeyOf = (noteFile) => {
    if (typeof noteFile !== 'string' || noteFile.length > 4096 || !path.isAbsolute(noteFile) || noteFile.includes('\0')) throw new Error('Ongeldige notitie.');
    let directory = path.dirname(noteFile);
    try { directory = fs.realpathSync(directory); } catch (_) { /* The folder may not exist yet; the plain path is stable. */ }
    return crypto.createHash('sha256').update(path.join(directory, path.basename(noteFile))).digest('hex');
  };
  const linkFile = (noteKey) => path.join(getUserDataDir(), 'veneta-modules', 'note-results', noteKey + '.json');
  const readLink = (noteKey) => safeRead(linkFile(noteKey), null, (value) => {
    if (!onlyKeys(value, ['schemaVersion', 'noteKey', 'sessionKey', 'boundAt']) || value.schemaVersion !== 1 || value.noteKey !== noteKey ||
        typeof value.sessionKey !== 'string' || !/^[a-f0-9]{64}$/.test(value.sessionKey) || typeof value.boundAt !== 'string') throw new Error('Ongeldige koppeling.');
    return value;
  });
  const noteResult = (noteFile) => {
    const link = readLink(noteKeyOf(noteFile));
    return link ? { link, ...overviewForKey(link.sessionKey) } : null;
  };
  const noteBody = (found, key = found.link.sessionKey) => ({ found: true, title: found.name || 'Checklist', overview: found.overview, markdown: found.markdown,
    // The last check of the conversation may still be running after the recording stopped.
    finalRunning: live.finalRunningFor(key) || live.finalPendingFor(key) });
  /** Called by the host when a recording stops and it knows the note file: the only moment the link is certain. */
  const bindSessionToNote = (request) => {
    try {
      if (!onlyKeys(request, ['noteFile', 'recordingId', 'appended']) || typeof request.recordingId !== 'string' || typeof request.appended !== 'boolean') return false;
      // The planner owns the session of the recording in progress; a later renderer mount that attached some other
      // session moves the shared attachment but not this. Without a planner session the attachment is all there is.
      const session = live.sessionId() || activeSession;
      if (!store().moduleEnabled(MODULE) || !session) return false;
      // Exactly this recording, or exactly this note's own session: never any session that merely looks like a note.
      if (session !== liveSessionId({ appendTarget: request.appended ? request.noteFile : null, startedAtMs: request.recordingId })) return false;
      const noteKey = noteKeyOf(request.noteFile);
      const key = sessionKey(session);
      const draft = path.join(getUserDataDir(), 'veneta-modules', 'drafts', key + '.json');
      assertDirectory(path.dirname(draft));
      if (!fs.existsSync(draft)) return false;
      atomicWrite(linkFile(noteKey), { schemaVersion: 1, noteKey, sessionKey: key, boundAt: new Date().toISOString() });
      if (activeSession === session) activeSession = null;
      return true;
    } catch (_) { return false; }
  };
  ipcMain.handle('veneta-checklist-note-result', checklistHandler((request) => {
    if (!onlyKeys(request, ['noteFile']) || Object.keys(request).length !== 1) throw new Error('Ongeldige notitie.');
    const found = noteResult(request.noteFile);
    return found ? noteBody(found) : { found: false };
  }));
  ipcMain.handle('veneta-checklist-note-scores', checklistHandler((request) => {
    if (!onlyKeys(request, ['noteFiles']) || !Array.isArray(request.noteFiles) || request.noteFiles.length > 200) throw new Error('Ongeldig verzoek.');
    const keys = request.noteFiles.map((file) => [file, noteKeyOf(file)]);
    const scores = {};
    for (const [file, key] of keys) {
      if (!fs.existsSync(linkFile(key))) continue;
      try {
        const found = noteResult(file);
        if (found) scores[file] = { title: found.name || 'Checklist', covered: found.overview.score.covered, total: found.overview.score.total };
      } catch (_) { /* One unreadable result never hides the others. */ }
    }
    return { scores };
  }));
  // The only human actions: reject an AI tick (back to not heard, with a reason) and mark "Niet van toepassing".
  ipcMain.handle('veneta-checklist-note-correct', checklistHandler((request) => {
    if (!onlyKeys(request, ['noteFile', 'criterionId', 'action', 'reason']) || typeof request.criterionId !== 'string' ||
        !['reject', 'notApplicable', 'clear'].includes(request.action)) throw new Error('Ongeldige correctie.');
    const found = noteResult(request.noteFile);
    if (!found || !uniqueCriteria(found.draft.criteria).some((item) => item.id === request.criterionId)) throw new Error('Onbekend punt.');
    const reason = typeof request.reason === 'string' ? request.reason.trim() : '';
    const manualOverrides = { ...found.draft.manualOverrides };
    if (request.action === 'clear') delete manualOverrides[request.criterionId];
    else {
      if (!reason || reason.length > MAX_REASON) throw new Error('Een korte reden is verplicht.');
      if (request.action === 'notApplicable') manualOverrides[request.criterionId] = { origin: 'human', status: 'notApplicable', reason };
      else {
        const ai = found.overview.rows.find((row) => row.criterionId === request.criterionId).aiStatus;
        if (ai !== 'covered' && ai !== 'partial') throw new Error('Alleen een AI-vinkje kan worden afgewezen.');
        manualOverrides[request.criterionId] = { origin: 'human', status: 'unmentioned', rejected: true, reason };
      }
    }
    atomicWrite(path.join(getUserDataDir(), 'veneta-modules', 'drafts', found.link.sessionKey + '.json'), validateDraft({ ...found.draft, manualOverrides }));
    return noteBody(overviewForKey(found.link.sessionKey), found.link.sessionKey);
  }));
  ipcMain.handle('veneta-checklist-overview', checklistHandler((request) => {
    const { overview, markdown } = overviewFor(request);
    return { overview, markdown };
  }));
  ipcMain.handle('veneta-checklist-export-overview', checklistHandler((request) => {
    const { key, overview, markdown } = overviewFor(request);
    const target = path.join(overviewsDir(), key + '.md');
    atomicWriteText(target, markdown);
    atomicWrite(path.join(overviewsDir(), key + '.json'), overview);
    return { path: target, markdown };
  }));
  ipcMain.handle('veneta-checklist-list-overviews', checklistHandler(() => {
    const directory = path.join(getUserDataDir(), 'veneta-modules', 'drafts');
    assertDirectory(directory);
    if (!fs.existsSync(directory)) return { items: [] };
    const items = [];
    for (const name of fs.readdirSync(directory)) {
      const match = /^([a-f0-9]{64})\.json$/.exec(name);
      if (!match) continue;
      const stat = fs.lstatSync(path.join(directory, name));
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      let draft; try { draft = safeRead(path.join(directory, name), null, validateDraft); } catch (_) { continue; }
      let evaluation = null; try { evaluation = readEvaluation(match[1]); } catch (_) { /* Listed without an AI verdict. */ }
      items.push({ sessionKey: match[1], updatedAt: stat.mtime.toISOString(), criteriaCount: uniqueCriteria(draft.criteria).length,
        reviewed: Boolean(evaluation), manualCount: Object.keys(draft.manualOverrides).length });
    }
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { items: items.slice(0, 20) };
  }));
  return { store, bindSessionToNote, live, modelSlot: slot, onSettingsChanged: (listener) => { settingsListeners.add(listener); return () => settingsListeners.delete(listener); } };
}

module.exports = { createProductSettingsStore, registerVenetaProductIpc, validateRequest, validateAssessmentResponse,
  safeRead, atomicWrite, assertDirectory, AGENDA_MODULE };
