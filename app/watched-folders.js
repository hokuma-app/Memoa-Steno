'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Watched recording folders (Settings → Integrations): folders another tool
// fills with audio — e.g. a phone voice recorder synced by Syncthing. Each
// file not yet transcribed shows in All notes, where the user picks what
// becomes a meeting; a folder can also auto-transcribe new files. The source files are
// never moved, renamed or deleted (a Syncthing receive-only folder flags any
// local change), so per-file state lives in watched-folders.json instead.

// A file must keep the same size and mtime for this long before it counts as
// complete. Syncthing already writes to a hidden temp file and renames it when
// done; this also covers tools that write in place.
const STABLE_MS = 10_000;
// fs.watch misses events on some volumes, so a slow poll backs it up.
const POLL_MS = 30_000;
const MAX_DEPTH = 4;

function isTempName(name) {
  return name.startsWith('.') || name.startsWith('~syncthing~')
    || /\.(tmp|part|partial|crdownload|download)$/i.test(name);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// Local wall-clock ISO without a zone, the shape the backend's
// datetime.now().isoformat() writes for a meeting's date.
function localIso(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function validDate(y, mo, d, h, mi, s) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const date = new Date(y, mo - 1, d, h, mi, s);
  return date.getMonth() === mo - 1 ? date : null;
}

// When the recording was made: from the filename when it carries a timestamp
// (Samsung "Spraak 261017_191302", "20261017_191302", "2026-10-17 19.13.02"),
// else the file's mtime, which Syncthing carries over from the phone.
function recordedAtFor(name, mtimeMs) {
  const long = name.match(/(?:^|\D)(\d{4})-?(\d{2})-?(\d{2})[ _T-]?(\d{2})[.:-]?(\d{2})[.:-]?(\d{2})(?:\D|$)/);
  if (long) {
    const d = validDate(...long.slice(1).map(Number));
    if (d) return localIso(d);
  }
  const short = name.match(/(?:^|\D)(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?:\D|$)/);
  if (short) {
    const [yy, ...rest] = short.slice(1).map(Number);
    const d = validDate(2000 + yy, ...rest);
    if (d) return localIso(d);
  }
  return localIso(new Date(mtimeMs));
}

const fileId = (absPath) => crypto.createHash('sha1').update(absPath).digest('hex').slice(0, 16);

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function createWatchedFolders({
  getUserDataDir,
  audioExtensions,
  // (filePath, { title, recordedAt, previousAudioFile }) → { audioFile, summaryFile }
  enqueue,
  noteExists,
  // Optional richer reader; retain noteExists for existing callers. Only a
  // completed note is success once the queue no longer owns the job.
  noteOutcome,
  isJobPending,
  isRecording,
  // (absPath) → Buffer of a short WAV for the inbox's play button.
  previewAudio = async () => { throw new Error('Preview unavailable'); },
  // Folders that must never be watched (StenoAI's own data would loop).
  forbiddenDirs = () => [getUserDataDir()],
  onChange = () => {},
  onLog = () => {},
  now = Date.now,
  watch = fs.watch,
  stableMs = STABLE_MS,
  pollMs = POLL_MS,
}) {
  const stateFile = () => path.join(getUserDataDir(), 'watched-folders.json');
  const extensions = new Set(audioExtensions.map((e) => e.toLowerCase()));
  // absPath → { size, mtimeMs, sinceMs }: when the current size/mtime was first
  // seen. In memory only; after a restart a file needs one more look.
  const observed = new Map();
  let entries = [];
  let signature = '';
  let watchers = [];
  let pollTimer = null;
  let rescanTimer = null;
  let debounceTimer = null;
  let scanning = null;
  let started = false;
  // Scans also write state and may enqueue automatically. Keep every state
  // transaction on the same lane, including across asynchronous copies.
  let mutations = Promise.resolve();
  function serialize(operation) {
    const result = mutations.then(operation);
    mutations = result.catch(() => {});
    return result;
  }

  function read() {
    try {
      const data = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
      return {
        folders: Array.isArray(data.folders) ? data.folders : [],
        files: data.files && typeof data.files === 'object' ? data.files : {},
      };
    } catch {
      return { folders: [], files: {} };
    }
  }

  function write(state) {
    const target = stateFile();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(`${target}.tmp`, target);
  }

  function walk(dir, depth, out) {
    let dirents;
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of dirents) {
      if (isTempName(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH) walk(full, depth + 1, out);
      } else if (entry.isFile() && extensions.has(path.extname(entry.name).slice(1).toLowerCase())) {
        out.push(full);
      }
    }
    return true;
  }

  function statusFor(record, stable) {
    if (record?.status === 'queued') {
      if (isJobPending(record.audioFile)) return 'processing';
      if (noteOutcome) return noteOutcome(record.summaryFile) === 'done' ? 'done' : 'failed';
      return noteExists(record.summaryFile) ? 'done' : 'failed';
    }
    if (record?.status === 'dismissed') return 'dismissed';
    return stable ? 'new' : 'syncing';
  }

  function titleFor(folder, recordedAt) {
    // "<label> — YYYY-MM-DD HH:MM" is a placeholder the backend replaces with
    // an AI title once notes exist (simple_recorder.py _AUTO_NAMED_PATTERN).
    return `${path.basename(folder.path)} — ${recordedAt.slice(0, 10)} ${recordedAt.slice(11, 16)}`;
  }

  async function queue(state, entry) {
    const folder = state.folders.find((f) => f.id === entry.folderId);
    const previous = state.files[entry.path];
    const { audioFile, summaryFile } = await enqueue(entry.path, {
      title: titleFor(folder, entry.recordedAt),
      recordedAt: entry.recordedAt,
      previousAudioFile: previous?.status === 'queued' ? previous.audioFile : undefined,
    });
    state.files[entry.path] = {
      ...previous, status: 'queued', audioFile, summaryFile, queuedAt: now(),
    };
    // A later failure in this batch must not lose already accepted jobs.
    write(state);
  }

  async function scanOnce() {
    const state = read();
    const t = now();
    const seen = new Set();
    let unstable = false;
    let dirty = false;
    const next = [];
    for (const folder of state.folders) {
      const files = [];
      folder.available = walk(folder.path, 0, files);
      for (const abs of files) {
        let stat;
        try {
          stat = fs.statSync(abs);
        } catch {
          continue;
        }
        seen.add(abs);
        const prev = observed.get(abs);
        if (!prev || prev.size !== stat.size || prev.mtimeMs !== stat.mtimeMs) {
          observed.set(abs, { size: stat.size, mtimeMs: stat.mtimeMs, sinceMs: t });
        }
        const stable = stat.size > 0 && t - observed.get(abs).sinceMs >= stableMs;
        if (!stable) unstable = true;
        if (!state.files[abs]) {
          state.files[abs] = { firstSeen: t };
          dirty = true;
        }
        const name = path.basename(abs);
        next.push({
          id: fileId(abs),
          folderId: folder.id,
          path: abs,
          name,
          relPath: path.relative(folder.path, abs),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          recordedAt: recordedAtFor(name, stat.mtimeMs),
          stable,
        });
      }
    }
    for (const abs of [...observed.keys()]) if (!seen.has(abs)) observed.delete(abs);
    // Forget files that left a folder we could read; an unmounted folder
    // keeps its records until it comes back.
    for (const abs of Object.keys(state.files)) {
      if (seen.has(abs)) continue;
      const owner = state.folders.find((f) => isInside(abs, f.path));
      if (!owner || owner.available) {
        delete state.files[abs];
        dirty = true;
      }
    }

    const recording = isRecording();
    for (const entry of next) {
      const folder = state.folders.find((f) => f.id === entry.folderId);
      const record = state.files[entry.path];
      if (!folder.auto || !entry.stable || record.status || recording) continue;
      // Only files that arrived after auto-transcribe was switched on.
      if (!(record.firstSeen > (folder.autoSince || 0))) continue;
      try {
        await queue(state, entry);
        dirty = true;
        onLog(`Watched folder: auto-transcribing ${entry.name}`);
      } catch (e) {
        onLog(`Watched folder: could not queue ${entry.name}: ${e.message}`);
      }
    }

    if (dirty) {
      const { folders, files } = state;
      write({ folders: folders.map(({ available: _a, ...f }) => f), files });
    }
    entries = next.map((entry) => {
      const record = state.files[entry.path];
      const status = statusFor(record, entry.stable);
      return { ...entry, status, ...(status === 'done' ? { summaryFile: record.summaryFile } : {}) };
    });
    const nextSignature = JSON.stringify([state.folders, entries.map((e) => [e.id, e.status, e.size])]);
    if (nextSignature !== signature) {
      signature = nextSignature;
      onChange();
    }
    if (started && unstable) {
      clearTimeout(rescanTimer);
      rescanTimer = setTimeout(() => { void scan(); }, stableMs + 500);
    }
    return state;
  }

  // One scan at a time; a request during a scan reuses it.
  function scan() {
    if (!scanning) {
      scanning = serialize(scanOnce).finally(() => { scanning = null; });
    }
    return scanning;
  }

  function closeWatchers() {
    for (const w of watchers) {
      try { w.close(); } catch { /* already closed */ }
    }
    watchers = [];
  }

  function rewatch() {
    closeWatchers();
    if (!started) return;
    for (const folder of read().folders) {
      try {
        const w = watch(folder.path, { recursive: true }, () => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => { void scan(); }, 1500);
        });
        w.on?.('error', () => {});
        watchers.push(w);
      } catch (e) {
        onLog(`Watched folder: cannot watch ${folder.path}: ${e.message}`);
      }
    }
  }

  async function list() {
    const state = await scanOnce();
    return {
      folders: state.folders.map((f) => ({
        id: f.id, path: f.path, name: path.basename(f.path), autoTranscribe: Boolean(f.auto), available: f.available !== false,
      })),
      files: entries.map(({ path: _p, stable: _s, ...e }) => e),
    };
  }

  async function addFolder(dirPath) {
    const real = await fs.promises.realpath(path.resolve(dirPath));
    if (!(await fs.promises.stat(real)).isDirectory()) throw new Error('Not a folder');
    for (const dir of forbiddenDirs()) {
      if (!dir) continue;
      let forbidden = path.resolve(dir);
      try { forbidden = fs.realpathSync(forbidden); } catch { /* not created yet */ }
      if (isInside(real, forbidden) || isInside(forbidden, real)) {
        throw new Error('StenoAI’s own data folder cannot be watched');
      }
    }
    const state = read();
    if (state.folders.some((f) => isInside(real, f.path) || isInside(f.path, real))) {
      throw new Error('This folder is already watched');
    }
    state.folders.push({ id: crypto.randomBytes(6).toString('hex'), path: real, auto: false });
    write(state);
    rewatch();
    return list();
  }

  async function removeFolder(id) {
    const state = read();
    const folder = state.folders.find((f) => f.id === id);
    if (!folder) throw new Error('Unknown folder');
    state.folders = state.folders.filter((f) => f.id !== id);
    for (const abs of Object.keys(state.files)) if (isInside(abs, folder.path)) delete state.files[abs];
    write(state);
    rewatch();
    return list();
  }

  async function setAutoTranscribe(id, enabled) {
    // Look first so every file already there counts as seen before the switch:
    // turning auto on must not transcribe a folder's backlog.
    if (enabled) await scanOnce();
    const state = read();
    const folder = state.folders.find((f) => f.id === id);
    if (!folder) throw new Error('Unknown folder');
    folder.auto = Boolean(enabled);
    folder.autoSince = enabled ? now() : undefined;
    write(state);
    return list();
  }

  function resolve(ids) {
    if (!Array.isArray(ids)) throw new Error('Invalid selection');
    return [...new Set(ids)].map((id) => {
      const entry = entries.find((e) => e.id === id);
      if (!entry) throw new Error('Recording not found');
      return entry;
    });
  }

  async function transcribe(ids) {
    await scanOnce();
    if (isRecording()) throw new Error('Stop the recording first');
    const picked = resolve(ids);
    const state = read();
    for (const entry of picked) {
      if (!['new', 'dismissed', 'failed'].includes(statusFor(state.files[entry.path], entry.stable))) continue;
      await queue(state, entry);
    }
    write(state);
    return list();
  }

  async function setDismissed(ids, dismissed) {
    await scanOnce();
    const picked = resolve(ids);
    const state = read();
    for (const entry of picked) {
      const record = state.files[entry.path] || { firstSeen: now() };
      if (dismissed && ['new', 'syncing', 'failed'].includes(entry.status)) {
        state.files[entry.path] = { firstSeen: record.firstSeen, status: 'dismissed' };
      } else if (!dismissed && entry.status === 'dismissed') {
        state.files[entry.path] = { firstSeen: record.firstSeen };
      }
    }
    write(state);
    return list();
  }

  // The first minutes as WAV, so a phone .m4a plays without a codec in the renderer.
  async function preview(id) {
    if (!entries.length) await scanOnce();
    const [entry] = resolve([id]);
    return { audioBase64: (await previewAudio(entry.path)).toString('base64') };
  }

  function start() {
    if (started) return;
    started = true;
    rewatch();
    pollTimer = setInterval(() => { void scan(); }, pollMs);
    pollTimer.unref?.();
    void scan();
  }

  function stop() {
    started = false;
    closeWatchers();
    clearInterval(pollTimer);
    clearTimeout(rescanTimer);
    clearTimeout(debounceTimer);
  }

  return {
    list: () => serialize(list),
    scan,
    addFolder: (dir) => serialize(() => addFolder(dir)),
    removeFolder: (id) => serialize(() => removeFolder(id)),
    setAutoTranscribe: (id, enabled) => serialize(() => setAutoTranscribe(id, enabled)),
    transcribe: (ids) => serialize(() => transcribe(ids)),
    dismiss: (ids) => serialize(() => setDismissed(ids, true)),
    restore: (ids) => serialize(() => setDismissed(ids, false)),
    preview: (id) => serialize(() => preview(id)),
    start,
    stop,
  };
}

module.exports = { createWatchedFolders, recordedAtFor, isTempName };
