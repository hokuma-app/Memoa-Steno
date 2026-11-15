'use strict';
/**
 * Host planner for the live conversation checklist (0.9.4).
 *
 * The planning of the automatic AI check lives here, in the main process, per active recording. It does not
 * depend on any React component staying mounted: the renderer only displays the state this planner keeps and
 * pushes. A check runs after STABLE_MS without new finals, and at the latest MAX_WAIT_MS after the first final
 * that has not been assessed yet. One check at a time (single flight), bounded by the same limits as a manual
 * request, local model only (the injected `evaluate` is the existing guarded route; this module never talks to
 * a model, a network or a download itself).
 *
 * Content-free by construction: state sent for diagnostics and every log event carries counters and reason
 * codes only, never transcript text, criteria or quotes. (The state pushed to the display does carry the
 * grounded result, because that is what the sidebar shows.)
 */
const crypto = require('node:crypto');

const STABLE_MS = 10_000;
const MAX_WAIT_MS = 30_000;
/** Fallback when the host cannot hand over the real drain: the final check starts a moment after stop. */
const FINAL_GRACE_MS = 3_000;
/** Upper bound on waiting for the real sidecar drain (the host passes its own kill watchdog plus a margin). */
const DRAIN_MAX_MS = 5_500;
const BUSY_RETRY_MS = 5_000;
const LIMITS = Object.freeze({ criteria: 32, segments: 256, characters: 24_000, requestChars: 100_000 });

const clone = (value) => JSON.parse(JSON.stringify(value));
const norm = (label) => String(label).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

/** The same stable per-note key the renderer used to compute: a short hash of the note's realpath. */
function noteSessionId(summaryFile) {
  let a = 0x811c9dc5; let b = 0x01000193;
  for (let i = 0; i < summaryFile.length; i++) {
    const code = summaryFile.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x5bd1e995) >>> 0;
  }
  return `note:${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}:${summaryFile.length}`;
}
/** A continued note keeps its own copy; a fresh recording is keyed by the start time the host assigned. */
function liveSessionId({ appendTarget, startedAtMs }) {
  if (appendTarget) return noteSessionId(appendTarget);
  return `recording:${startedAtMs}`.slice(0, 128);
}

/**
 * Final segments only, roles from the channel, never from ASR mutation.
 * The id belongs to the segment itself (start, end and a hash of speaker and text), never to its position: a late
 * final that the host inserts chronologically earlier shifts every later index but must not move a quote to another
 * segment between two requests. Identical twins get a counter. Ids from before 0.9.4 (`f<index>-start-end`) stay
 * readable in stored results, because those carry their own segments.
 */
function mapFinals(finals, confirmed) {
  const seen = new Map();
  return finals.filter((segment) => segment && segment.isFinal && typeof segment.text === 'string' && segment.text).map((segment) => {
    const hash = crypto.createHash('sha1').update(`${segment.speaker}\n${segment.text}`).digest('hex').slice(0, 8);
    const base = `s${segment.start}-${segment.end}-${hash}`;
    const count = (seen.get(base) || 0) + 1; seen.set(base, count);
    return {
      id: count > 1 ? `${base}~${count}` : base,
      text: segment.text, start: segment.start, end: segment.end,
      speaker: !confirmed ? 'unknown' : segment.speaker === 'You' ? 'seller' : segment.speaker === 'Others' ? 'other' : 'unknown',
    };
  });
}

/** Points with the same label (ignoring case and spacing) are one point; the first one stays. */
function uniqueCriteria(criteria) {
  const seen = new Set();
  return criteria.filter((item) => { const key = norm(item.label); if (seen.has(key)) return false; seen.add(key); return true; });
}

/**
 * Choose what one check may read. Within the limits: everything. Over them: the newest contiguous tail that fits
 * the character budget (labels count too), at most 256 segments. Safe by design: older text is never cut out of
 * the middle, and if not even the newest segment fits the check is skipped with the existing "too much text" status
 * (an earlier result then stays as it was). `carried` are segments an earlier finding still stands on: they take
 * their places and characters out of the same limits, so the stored request can always hold them.
 */
function planWindow(criteria, segments, carried = []) {
  const labelChars = criteria.reduce((sum, item) => sum + item.label.length, 0);
  if (criteria.length < 1 || criteria.length > LIMITS.criteria) return { kind: 'tooLarge' };
  const reservedChars = carried.reduce((sum, segment) => sum + segment.text.length, 0);
  const budget = LIMITS.characters - labelChars - reservedChars;
  const room = LIMITS.segments - carried.length;
  if (budget <= 0 || room < 1) return { kind: 'tooLarge' };
  const picked = []; let chars = 0;
  for (let index = segments.length - 1; index >= 0 && picked.length < room; index--) {
    const length = segments[index].text.length;
    if (chars + length > budget) break;
    picked.unshift(segments[index]); chars += length;
  }
  while (picked.length && JSON.stringify({ criteria, segments: [...carried, ...picked] }).length > LIMITS.requestChars - 1000) picked.shift();
  if (!picked.length) return { kind: 'tooLarge' };
  return { kind: 'ok', segments: picked, dropped: segments.length - picked.length };
}

/**
 * Levels per point, as the interface shows them: notHeard < mentioned < explained < explainedConfirmed. Within one
 * conversation "said" is a fact that does not disappear (0.10.1), so a later check may only raise a point.
 */
function rankOf(assessment) {
  if (!assessment) return 0;
  if (assessment.status === 'covered') return assessment.customerConfirmed ? 3 : 2;
  if (assessment.status === 'partial') return 1;
  // An unsure judgment that still named the point with a grounded quote counts as mentioned.
  if (assessment.status === 'uncertain' && assessment.kind === 'mentioned' && Array.isArray(assessment.evidence) && assessment.evidence.length) return 1;
  return 0;
}
const evidenceIds = (assessment) => [...assessment.evidence, ...(assessment.customerEvidence || [])].map((item) => item.segmentId);
/** A quote still stands when its segment is in this session's transcript with the same text (no transcript given: it stands). */
const standsIn = (transcript, segment) => !transcript || transcript.get(segment.id) === segment.text;
const heldAssessment = (old, byId, transcript) => rankOf(old) >= 1 && evidenceIds(old).every((id) => byId.has(id) && standsIn(transcript, byId.get(id)));

/** Segments an earlier result still stands on that a shorter window no longer contains, oldest first. */
function carriedSegments(previous, window, confirmed = previous && previous.mappingConfirmed, transcript = null) {
  if (!previous || previous.mappingConfirmed !== confirmed) return [];
  const inWindow = new Set(window.map((segment) => segment.id));
  const byId = new Map(previous.segments.map((segment) => [segment.id, segment]));
  const needed = new Map();
  for (const assessment of previous.response.assessments) {
    if (!heldAssessment(assessment, byId, transcript)) continue;
    for (const id of evidenceIds(assessment)) if (!inWindow.has(id)) needed.set(id, byId.get(id));
  }
  return inOrder(previous, needed);
}
const inOrder = (previous, needed) => {
  const position = new Map(previous.segments.map((segment, index) => [segment.id, index]));
  return [...needed.values()].sort((a, b) => position.get(a.id) - position.get(b.id));
};

/**
 * The window of one check together with the segments that must travel along. Carrying makes the window smaller,
 * which can push more of an earlier finding's quotes out of it, so this repeats until it settles (the carried set
 * only ever grows, so it ends). A finding is never given up to make room: older text that is not carried falls out.
 */
function planWithCarry(criteria, segments, previous, confirmed, transcript = null) {
  let carried = [];
  for (let round = 0; round <= LIMITS.criteria + 1; round++) {
    const plan = planWindow(criteria, segments, carried);
    if (plan.kind !== 'ok') return plan;
    const next = plan.dropped > 0 ? carriedSegments(previous, plan.segments, confirmed, transcript) : [];
    if (next.length === carried.length) return { ...plan, carried };
    carried = next;
  }
  return { kind: 'tooLarge' };
}

/**
 * Monotone levels (0.10.1). Per point, an earlier finding is kept when it is at least as high as the new one and the
 * segments it quotes still stand unchanged in this session's transcript: a later check can raise a point, never lower
 * it, and at an equal level the first quote stays. A point that rises takes the new finding (and so the newest quote).
 * A quoted segment that was rewritten or is gone releases the point to be judged again. `held` counts the lowerings
 * this stopped; `carried` the earlier findings that were kept. `transcript` maps segment id to text for the whole
 * session (not only this window); without it every earlier quote counts as standing.
 */
function carryForward(previous, request, response, transcript = null) {
  const none = { request, response, carried: 0, held: 0 };
  if (!previous || previous.mappingConfirmed !== request.mappingConfirmed) return none;
  const byId = new Map(previous.segments.map((segment) => [segment.id, segment]));
  const inWindow = new Set(request.segments.map((segment) => segment.id));
  const extra = new Map(); let carried = 0; let held = 0;
  const assessments = response.assessments.map((assessment) => {
    const old = previous.response.assessments.find((item) => item.criterionId === assessment.criterionId);
    if (!old || !heldAssessment(old, byId, transcript) || rankOf(old) < rankOf(assessment)) return assessment;
    for (const id of evidenceIds(old)) if (!inWindow.has(id)) extra.set(id, byId.get(id));
    carried++;
    if (rankOf(old) > rankOf(assessment)) held++;
    return clone(old);
  });
  if (!carried) return none;
  const segments = [...inOrder(previous, extra), ...request.segments];
  const chars = segments.reduce((sum, segment) => sum + segment.text.length, 0) + request.criteria.reduce((sum, item) => sum + item.label.length, 0);
  if (segments.length > LIMITS.segments || chars > LIMITS.characters) return none;
  return { request: { ...request, segments }, response: { ...response, assessments }, carried, held };
}

const shortId = (sessionId) => crypto.createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 8);
const signatureOf = (finals) => crypto.createHash('sha1').update(JSON.stringify(finals.filter((s) => s && s.isFinal && s.text)
  .map((s) => [s.text, s.start, s.end, s.speaker]))).digest('hex');

/**
 * deps:
 *  moduleEnabled(): boolean            the module is on (profile and switch)
 *  getMicIsSeller(): boolean           the setting, read per check
 *  attach(sessionId): draft | null     idempotent: the prepared checklist becomes this conversation's copy
 *  getFinals(): LiveSegment[]          the host's live buffer: prior segments then final segments
 *  evaluate(request, { final }): Promise<{ok:true,response}|{ok:false,reason}>   guarded, validated, local-only route;
 *                                      `final` marks the last check at stop (the host may then treat a summary on the model as busy)
 *  persist(request, response): void    writes the session file the note tab reads
 *  emit(state): void                   push to the renderer
 *  log(event, fields): void            content-free diagnostics
 *  keyOf(sessionId): string            the session file key
 */
function createLiveChecklistPlanner(deps) {
  const now = deps.now || Date.now;
  const setT = deps.setTimeout || setTimeout;
  const clearT = deps.clearTimeout || clearTimeout;
  const stableMs = deps.stableMs ?? (deps.energySaver ? 30_000 : STABLE_MS);
  const maxWaitMs = deps.maxWaitMs ?? (deps.energySaver ? 60_000 : MAX_WAIT_MS);
  const graceMs = deps.finalGraceMs ?? FINAL_GRACE_MS;
  const busyRetryMs = deps.busyRetryMs ?? BUSY_RETRY_MS;
  const log = (event, fields = {}) => { try { deps.log?.(event, fields); } catch (_) { /* Diagnostics never break the planner. */ } };
  let current = null;
  let seq = 0;
  const finalizing = new Set();
  /** Stopped, and the last check (or the decision that none is needed) is not finished yet. */
  const stopping = new Set();

  const phaseOf = (sess) => {
    if (sess.finalRunning) return 'finalBusy';
    if (sess.inFlight) return 'busy';
    if (sess.failure) return 'error';
    if (sess.tooLarge) return 'tooLarge';
    if (sess.lastRunAt) return sess.ended ? 'ended' : 'listening';
    if (sess.lines === 0) return 'noText';
    return sess.ended ? 'ended' : 'waiting';
  };
  const publicOf = (sess) => ({
    active: true, seq: sess.seq, sessionId: sess.sessionId, title: sess.title, criteria: sess.criteria, mappingConfirmed: sess.mappingConfirmed,
    phase: phaseOf(sess),
    lastRunAt: sess.lastRunAt ? new Date(sess.lastRunAt).toISOString() : null,
    failure: sess.failure ? { reason: sess.failure.reason, at: new Date(sess.failure.at).toISOString() } : null,
    counters: { lines: sess.lines, checks: sess.checks, failures: sess.failures, window: sess.window, held: sess.held },
    lastReason: sess.lastReason,
    result: sess.result ? { response: sess.result.response, segments: sess.result.segments } : null,
  });
  const publish = (sess) => {
    sess.seq = ++seq;
    if (current === sess) { try { deps.emit?.(publicOf(sess)); } catch (_) { /* The display is never the planner's problem. */ } }
  };
  const clearTimer = (sess) => { if (sess.timer) { clearT(sess.timer); sess.timer = null; } };
  const moduleOn = () => { try { return deps.moduleEnabled() === true; } catch (_) { return false; } };

  const schedule = (sess) => {
    clearTimer(sess);
    if (sess.cancelled || sess.ended || sess.inFlight || !sess.dirty || sess.pendingSince === null) return;
    const waited = now() - sess.pendingSince;
    const delay = Math.min(stableMs, Math.max(0, maxWaitMs - waited));
    sess.timer = setT(() => {
      sess.timer = null;
      void run(sess, now() - sess.pendingSince >= maxWaitMs ? 'maxwacht' : 'stil');
    }, delay);
    log('scheduled', { delayMs: delay, lines: sess.lines });
  };

  const finalsOf = (sess) => {
    if (current === sess) { try { sess.lastFinals = deps.getFinals(); } catch (_) { /* Keep the last known copy. */ } }
    return sess.lastFinals;
  };

  async function run(sess, trigger) {
    if (sess.cancelled || sess.inFlight || (sess.ended && trigger !== 'stop')) return;
    if (!moduleOn()) { cancelSession(sess); return; }
    let confirmed;
    try { confirmed = deps.getMicIsSeller() === true; } catch (_) { confirmed = false; }
    const finals = finalsOf(sess);
    const segments = mapFinals(finals, confirmed);
    const signature = signatureOf(finals);
    if (!segments.length) { sess.dirty = false; sess.pendingSince = null; return; }
    sess.dirty = false; sess.pendingSince = null;
    const transcript = new Map(segments.map((segment) => [segment.id, segment.text]));
    const plan = planWithCarry(sess.criteria, segments, sess.result, confirmed, transcript);
    if (plan.kind !== 'ok') {
      sess.tooLarge = true; sess.lastReason = 'te_veel_tekst'; sess.window = null;
      log('too_large', { lines: segments.length });
      publish(sess);
      return;
    }
    sess.tooLarge = false;
    sess.window = plan.dropped > 0 ? plan.segments.length : null;
    sess.inFlight = true; sess.checks++; sess.lastTrigger = trigger;
    const request = { sessionId: sess.sessionId, revision: crypto.randomUUID(), mappingConfirmed: confirmed,
      criteria: clone(sess.criteria), segments: plan.segments.map((segment) => ({ ...segment })) };
    log('check_start', { trigger, lines: segments.length, window: plan.segments.length, checks: sess.checks });
    publish(sess);
    const started = now();
    const flight = (async () => {
      let outcome;
      try { outcome = await deps.evaluate(clone(request), { final: trigger === 'stop' }); }
      catch (_) { outcome = { ok: false, reason: 'failed' }; }
      if (sess.cancelled) return;
      if (!outcome.ok && outcome.reason === 'busy') {
        // Another analysis holds the single slot: not a failure, try again shortly with the same text.
        sess.checks--; sess.dirty = true; sess.pendingSince ??= now(); sess.lastReason = 'busy';
        sess.inFlight = false;
        log('check_busy', {});
        publish(sess);
        clearTimer(sess);
        if (trigger === 'stop') {
          // The last check is awaited by finish(): retry inline, bounded (about two minutes), then report it honestly.
          sess.busyRetries = (sess.busyRetries || 0) + 1;
          if (sess.busyRetries <= 24) {
            await sleep(sess, busyRetryMs).promise;
            if (!sess.cancelled) await run(sess, 'stop');
            return;
          }
          sess.failures++; sess.failure = { reason: 'busy', at: now() }; sess.lastReason = 'busy';
          publish(sess);
          return;
        }
        sess.timer = setT(() => { sess.timer = null; void run(sess, trigger); }, busyRetryMs);
        return;
      }
      if (outcome.ok) {
        const merged = carryForward(sess.result, request, outcome.response, transcript);
        let stored = false;
        // One retry of the same merged result: a monotone result is never swapped for the raw answer of the model.
        for (let attempt = 0; attempt < 2 && !stored; attempt++) {
          try { deps.persist(merged.request, merged.response); stored = true; } catch (_) { /* Retried once, then reported. */ }
        }
        if (!stored) outcome = { ok: false, reason: 'failed' };
        else {
          sess.result = { response: merged.response, segments: merged.request.segments, mappingConfirmed: confirmed };
          sess.held += merged.held;
          sess.lastRunAt = now(); sess.failure = null; sess.lastReason = trigger;
          sess.assessedSignature = signature;
          log('check_done', { ms: now() - started, checks: sess.checks, carried: merged.carried, held: merged.held });
        }
      }
      if (!outcome.ok) {
        sess.failures++;
        sess.failure = { reason: outcome.reason || 'failed', at: now() };
        sess.lastReason = sess.failure.reason;
        sess.assessedSignature = null;
        log('check_failed', { reason: sess.failure.reason, failures: sess.failures });
      }
      sess.inFlight = false;
      publish(sess);
      schedule(sess);
    })();
    sess.flight = flight;
    await flight;
  }

  /** A tracked wait: cancel() clears the timer and lets the waiter go on, so nothing outlives its recording. */
  function sleep(sess, ms) {
    let entry;
    const promise = new Promise((resolve) => {
      entry = { resolve, handle: null };
      entry.handle = setT(() => { sess.sleepers.delete(entry); resolve(); }, ms);
      sess.sleepers.add(entry);
    });
    return { promise, clear: () => { if (sess.sleepers.delete(entry)) clearT(entry.handle); } };
  }
  const cancelSession = (sess) => {
    sess.cancelled = true; clearTimer(sess); sess.inFlight = false; sess.finalRunning = false; finalizing.delete(sess); stopping.delete(sess);
    for (const entry of [...sess.sleepers]) { clearT(entry.handle); entry.resolve(); }
    sess.sleepers.clear();
    sess.lastFinals = [];
    if (current === sess) { publish(sess); }
  };

  return {
    /** A recording starts. Returns false (and reads nothing about checklists) when the module is off or no checklist stands ready. */
    begin({ appendTarget = null, startedAtMs }) {
      if (current && !current.ended) cancelSession(current);
      current = null;
      if (!moduleOn()) { seq++; return false; }
      const sessionId = liveSessionId({ appendTarget, startedAtMs });
      let draft = null;
      try { draft = deps.attach(sessionId); } catch (_) { draft = null; }
      if (!draft || !Array.isArray(draft.criteria) || !draft.criteria.length) { seq++; log('begin_none', {}); return false; }
      const criteria = uniqueCriteria(draft.criteria);
      let micIsSeller = false;
      try { micIsSeller = deps.getMicIsSeller() === true; } catch (_) { /* Roles stay unknown. */ }
      current = {
        sessionId, title: draft.templateName || null, criteria, mappingConfirmed: micIsSeller,
        lines: 0, checks: 0, failures: 0, held: 0, window: null, lastReason: null, lastTrigger: null,
        signature: signatureOf([]), assessedSignature: null, lastFinals: [],
        dirty: false, pendingSince: null, timer: null, inFlight: false, flight: null,
        result: null, lastRunAt: null, failure: null, tooLarge: false,
        ended: false, cancelled: false, finalRunning: false, seq: 0, sleepers: new Set(),
      };
      log('begin', { session: shortId(sessionId), criteria: criteria.length, continued: Boolean(appendTarget) });
      publish(current);
      return true;
    },
    /** The host buffered another final segment (or rewrote some). Cheap; safe to call for every one. */
    notify() {
      const sess = current;
      if (!sess || sess.ended || sess.cancelled) return;
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
    /** The recording stops: one last check over whatever has not been assessed, written to the same session file. */
    finish({ drained = null, drainTimeoutMs = DRAIN_MAX_MS } = {}) {
      const sess = current;
      if (!sess || sess.ended || sess.cancelled) return Promise.resolve();
      sess.ended = true; clearTimer(sess);
      if (!moduleOn()) { cancelSession(sess); return Promise.resolve(); }
      // From the moment of stop the note's result may still change (a check can be claimed only after the drain):
      // readers keep asking until this is done.
      stopping.add(sess);
      const unassessed = () => {
        const finals = finalsOf(sess);
        return finals.some((item) => item && item.isFinal && item.text) && signatureOf(finals) !== sess.assessedSignature;
      };
      // "Last check running" is only claimed when there is something to check (or a check is still in flight);
      // otherwise stopping stays quiet. A last utterance drained by the sidecar after stop is picked up below.
      const claim = () => { if (!sess.finalRunning) { sess.finalRunning = true; finalizing.add(sess); log('final_start', { lines: sess.lines }); publish(sess); } };
      if (sess.inFlight || unassessed()) claim(); else publish(sess);
      const done = (async () => {
        // The last utterance only arrives once the sidecar has drained: wait for that (bounded by the host's kill
        // watchdog), not for a fixed time. Without a drain to wait for, the short fixed grace remains.
        if (drained && typeof drained.then === 'function') {
          const limit = sleep(sess, Math.max(0, drainTimeoutMs));
          await Promise.race([Promise.resolve(drained).then(() => {}, () => {}), limit.promise]);
          limit.clear();
        } else if (graceMs > 0) await sleep(sess, graceMs).promise;
        if (sess.flight) { try { await sess.flight; } catch (_) { /* Reported by the flight itself. */ } }
        if (!sess.cancelled && unassessed()) {
          claim();
          sess.lines = finalsOf(sess).filter((item) => item && item.isFinal && item.text).length;
          await run(sess, 'stop');
        }
        if (sess.finalRunning) log('final_done', { checks: sess.checks });
        sess.finalRunning = false; finalizing.delete(sess); stopping.delete(sess);
        sess.lastFinals = []; // The transcript buffer belongs to the host again; nothing keeps a copy.
        publish(sess);
      })();
      sess.finalPromise = done;
      return done;
    },
    /** Drop everything. With `keepFinishing`, only a recording still in progress is dropped (a failed start must not kill the previous note's last check). */
    cancel({ keepFinishing = false } = {}) {
      if (keepFinishing) { if (current && !current.ended) cancelSession(current); return; }
      if (current) cancelSession(current);
      for (const sess of [...finalizing, ...stopping]) cancelSession(sess);
    },
    /** For a renderer that (re)mounts: the whole display state, or `{ active: false }`. */
    getState() { return current ? publicOf(current) : { active: false, seq }; },
    /** How many buffered finals the planner still holds (a count, never content). */
    retainedFinals() { return current ? current.lastFinals.length : 0; },
    /** The planner's own session id for the recording in progress (or just stopped), or null. */
    sessionId() { return current && !current.cancelled ? current.sessionId : null; },
    finalPendingFor(sessionKey) { return [...stopping].some((sess) => deps.keyOf(sess.sessionId) === sessionKey); },
    /** Is the last check for this session file running right now (claimed)? */
    finalRunningFor(sessionKey) { return [...finalizing].some((sess) => deps.keyOf(sess.sessionId) === sessionKey); },
  };
}

module.exports = { createLiveChecklistPlanner, liveSessionId, noteSessionId, mapFinals, planWindow, planWithCarry, carryForward, rankOf, uniqueCriteria,
  STABLE_MS, MAX_WAIT_MS, LIMITS };
