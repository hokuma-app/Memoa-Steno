'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWatchedFolders, recordedAtFor, isTempName } = require('./watched-folders');

function harness({ recording = false, enqueueHook } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'watched-')));
  const userData = path.join(root, 'userdata');
  const phone = path.join(root, 'phone');
  fs.mkdirSync(userData);
  fs.mkdirSync(phone);
  let clock = 1_000_000;
  const queued = [];
  const pending = new Set();
  const notes = new Set();
  const state = { recording };
  const wf = createWatchedFolders({
    getUserDataDir: () => userData,
    audioExtensions: ['m4a', 'wav'],
    enqueue: async (filePath, opts) => {
      if (enqueueHook) await enqueueHook(filePath, opts);
      const audioFile = path.join(userData, `copy-${queued.length}.m4a`);
      queued.push({ filePath, ...opts, audioFile });
      pending.add(audioFile);
      return { audioFile, summaryFile: `${audioFile}_summary.md` };
    },
    noteExists: (f) => notes.has(f),
    isJobPending: (f) => pending.has(f),
    isRecording: () => state.recording,
    previewAudio: async (p) => Buffer.from(`wav:${path.basename(p)}`),
    now: () => clock,
    stableMs: 10_000,
  });
  const write = (name, bytes = 'audio') => fs.writeFileSync(path.join(phone, name), bytes);
  const tick = (ms) => { clock += ms; };
  return { wf, phone, userData, queued, pending, notes, state, write, tick };
}

test('recordedAtFor reads Samsung and long timestamps, else mtime', () => {
  assert.strictEqual(recordedAtFor('Spraak 261017_191302.m4a', 0), '2026-10-17T19:13:02');
  assert.strictEqual(recordedAtFor('REC_20261017_191302.wav', 0), '2026-10-17T19:13:02');
  assert.strictEqual(recordedAtFor('2026-10-17 19.13.02.m4a', 0), '2026-10-17T19:13:02');
  const mtime = new Date(2026, 0, 2, 3, 4, 5).getTime();
  assert.strictEqual(recordedAtFor('interview.m4a', mtime), '2026-01-02T03:04:05');
  assert.strictEqual(recordedAtFor('Spraak 261399_999999.m4a', mtime), '2026-01-02T03:04:05');
});

test('Syncthing temp and hidden files are skipped', () => {
  assert.ok(isTempName('.syncthing.Spraak.m4a.tmp'));
  assert.ok(isTempName('~syncthing~Spraak.m4a.tmp'));
  assert.ok(isTempName('Spraak.m4a.part'));
  assert.ok(!isTempName('Spraak 261017_191302.m4a'));
});

test('a file is "syncing" until unchanged for the stable window, then "new"', async () => {
  const h = harness();
  await h.wf.addFolder(h.phone);
  h.write('Spraak 261017_191302.m4a');
  h.write('.syncthing.other.m4a.tmp');
  let listing = await h.wf.list();
  assert.strictEqual(listing.files.length, 1);
  assert.strictEqual(listing.files[0].status, 'syncing');
  h.tick(10_000);
  listing = await h.wf.list();
  assert.strictEqual(listing.files[0].status, 'new');
  assert.strictEqual(listing.files[0].recordedAt, '2026-10-17T19:13:02');
  assert.ok(!('path' in listing.files[0]), 'absolute paths stay in main');
});

test('a growing file stays "syncing"', async () => {
  const h = harness();
  await h.wf.addFolder(h.phone);
  h.write('a.m4a', 'x');
  await h.wf.list();
  h.tick(10_000);
  h.write('a.m4a', 'xx');
  assert.strictEqual((await h.wf.list()).files[0].status, 'syncing');
});

test('manual transcribe queues with a placeholder title and recording date, then shows done', async () => {
  const h = harness();
  await h.wf.addFolder(h.phone);
  h.write('Spraak 261017_191302.m4a');
  await h.wf.list();
  h.tick(10_000);
  const [file] = (await h.wf.list()).files;
  let listing = await h.wf.transcribe([file.id]);
  assert.strictEqual(h.queued.length, 1);
  assert.strictEqual(h.queued[0].title, 'phone — 2026-10-17 19:13');
  assert.strictEqual(h.queued[0].recordedAt, '2026-10-17T19:13:02');
  assert.strictEqual(listing.files[0].status, 'processing');
  // Finished: job gone and the note exists.
  h.pending.clear();
  h.notes.add(`${h.queued[0].audioFile}_summary.md`);
  listing = await h.wf.list();
  assert.strictEqual(listing.files[0].status, 'done');
  assert.ok(fs.existsSync(path.join(h.phone, 'Spraak 261017_191302.m4a')), 'source untouched');
});

test('a failed job can be retried and reuses its earlier copy', async () => {
  const h = harness();
  await h.wf.addFolder(h.phone);
  h.write('a.m4a');
  await h.wf.list();
  h.tick(10_000);
  const [file] = (await h.wf.list()).files;
  await h.wf.transcribe([file.id]);
  h.pending.clear();
  assert.strictEqual((await h.wf.list()).files[0].status, 'failed');
  await h.wf.transcribe([file.id]);
  assert.strictEqual(h.queued[1].previousAudioFile, h.queued[0].audioFile);
});

test('dismiss hides a file without touching it; restore brings it back', async () => {
  const h = harness();
  await h.wf.addFolder(h.phone);
  h.write('a.m4a');
  await h.wf.list();
  h.tick(10_000);
  const [file] = (await h.wf.list()).files;
  assert.strictEqual((await h.wf.dismiss([file.id])).files[0].status, 'dismissed');
  assert.strictEqual((await h.wf.restore([file.id])).files[0].status, 'new');
  assert.ok(fs.existsSync(path.join(h.phone, 'a.m4a')));
});

test('auto-transcribe skips the backlog and queues only files that arrive later, once complete', async () => {
  const h = harness();
  const { folders } = await h.wf.addFolder(h.phone);
  h.write('old.m4a');
  h.tick(1);
  await h.wf.setAutoTranscribe(folders[0].id, true);
  h.tick(10_000);
  await h.wf.scan();
  assert.strictEqual(h.queued.length, 0, 'backlog stays in the inbox');

  h.tick(1);
  h.write('new.m4a');
  await h.wf.scan();
  assert.strictEqual(h.queued.length, 0, 'not complete yet');
  h.tick(10_000);
  await h.wf.scan();
  assert.deepStrictEqual(h.queued.map((q) => path.basename(q.filePath)), ['new.m4a']);
  await h.wf.scan();
  assert.strictEqual(h.queued.length, 1, 'queued once');
});

test('auto-transcribe waits while a recording is in progress', async () => {
  const h = harness({ recording: true });
  const { folders } = await h.wf.addFolder(h.phone);
  await h.wf.setAutoTranscribe(folders[0].id, true);
  h.tick(1);
  h.write('new.m4a');
  await h.wf.scan();
  h.tick(10_000);
  await h.wf.scan();
  assert.strictEqual(h.queued.length, 0);
  h.state.recording = false;
  await h.wf.scan();
  assert.strictEqual(h.queued.length, 1);
  await assert.rejects(() => { h.state.recording = true; return h.wf.transcribe([]); }, /Stop the recording/);
});

test('StenoAI data, nested and duplicate folders are refused', async () => {
  const h = harness();
  await assert.rejects(() => h.wf.addFolder(h.userData), /own data folder/);
  await h.wf.addFolder(h.phone);
  await assert.rejects(() => h.wf.addFolder(h.phone), /already watched/);
  fs.mkdirSync(path.join(h.phone, 'sub'));
  await assert.rejects(() => h.wf.addFolder(path.join(h.phone, 'sub')), /already watched/);
});

test('removing a folder forgets it and its files', async () => {
  const h = harness();
  const { folders } = await h.wf.addFolder(h.phone);
  h.write('a.m4a');
  const listing = await h.wf.removeFolder(folders[0].id);
  assert.deepStrictEqual(listing, { folders: [], files: [] });
  assert.ok(fs.existsSync(path.join(h.phone, 'a.m4a')));
});

test('preview returns the transcoded audio for a listed file only', async () => {
  const h = harness();
  await h.wf.addFolder(h.phone);
  h.write('a.m4a');
  const [file] = (await h.wf.list()).files;
  const { audioBase64 } = await h.wf.preview(file.id);
  assert.strictEqual(Buffer.from(audioBase64, 'base64').toString(), 'wav:a.m4a');
  await assert.rejects(() => h.wf.preview('../../etc/passwd'), /not found/);
});

async function ready(h, names = ['a.m4a']) {
  await h.wf.addFolder(h.phone);
  for (const name of names) h.write(name);
  await h.wf.list();
  h.tick(10_000);
  return (await h.wf.list()).files;
}

test('concurrent manual requests reserve a file once', async () => {
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = harness({ enqueueHook: async () => { entered(); await gate; } });
  const [file] = await ready(h);
  const first = h.wf.transcribe([file.id]);
  await started;
  const second = h.wf.transcribe([file.id]);
  await new Promise(setImmediate);
  release();
  await Promise.all([first, second]);
  assert.strictEqual(h.queued.length, 1);
});

test('automatic and manual requests share reservations without losing folder changes', async () => {
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = harness({ enqueueHook: async () => { entered(); await gate; } });
  const { folders } = await h.wf.addFolder(h.phone);
  await h.wf.setAutoTranscribe(folders[0].id, true);
  h.tick(1);
  h.write('a.m4a');
  const [file] = (await h.wf.list()).files;
  h.tick(10_000);
  const automatic = h.wf.scan();
  await started;
  const manual = h.wf.transcribe([file.id]);
  const disable = h.wf.setAutoTranscribe(folders[0].id, false);
  release();
  await Promise.all([automatic, manual, disable]);
  assert.strictEqual(h.queued.length, 1);
  const persisted = JSON.parse(fs.readFileSync(path.join(h.userData, 'watched-folders.json'), 'utf8'));
  assert.strictEqual(persisted.folders[0].auto, false);
  assert.strictEqual(persisted.files[path.join(h.phone, 'a.m4a')].status, 'queued');
});

test('duplicate ids in one selection enqueue once', async () => {
  const h = harness();
  const [file] = await ready(h);
  await h.wf.transcribe([file.id, file.id]);
  assert.strictEqual(h.queued.length, 1);
});

test('partial batch failure persists successful reservations and releases the failed one', async () => {
  let fail = true;
  const h = harness({ enqueueHook: async (p) => {
    if (fail && path.basename(p) === 'b.m4a') throw new Error('copy failed');
  } });
  const files = await ready(h, ['a.m4a', 'b.m4a']);
  await assert.rejects(h.wf.transcribe(files.map((f) => f.id)), /copy failed/);
  assert.deepStrictEqual((await h.wf.list()).files.map((f) => f.status), ['processing', 'new']);
  fail = false;
  await h.wf.transcribe(files.map((f) => f.id));
  assert.deepStrictEqual(h.queued.map((q) => path.basename(q.filePath)), ['a.m4a', 'b.m4a']);
});

// Execute the actual main-process watcher registration without launching Electron.
// Real files and the real watcher prove the outcome callback is wired, not just mocked.
function mainBoundary() {
  const h = harness();
  const recordings = path.join(h.userData, 'recordings');
  fs.mkdirSync(recordings);
  const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const start = source.indexOf('const watchedFolders = require(');
  const end = source.indexOf("require('./watched-folders-ipc')", start);
  const context = {
    require, fs, path, getUserDataDir: () => h.userData,
    IMPORT_AUDIO_EXTENSIONS: ['m4a', 'wav'],
    resolveRecordingsDir: () => recordings, getOutputDir: () => h.userData,
    summaryFileForAudio: (audio) => path.join(h.userData, `${path.basename(audio)}_summary.md`),
    copyImportIntoRecordings: async () => { throw new Error('Retry must reuse audio'); },
    addToProcessingQueue: (audio) => {
      h.queued.push(audio);
      context.processingQueue.push({ audioFile: audio });
    },
    currentProcessingJob: null, processingQueue: [], currentRecordingProcess: null,
    systemAudioRecordingActive: false, mainWindow: null, sendDebugLog: () => {},
  };
  const wf = require('vm').runInNewContext(`${source.slice(start, end)}; watchedFolders`, context);
  return { ...h, wf, context, recordings };
}

test('main boundary rejects an error summary and retries the existing audio', async () => {
  const h = mainBoundary();
  await h.wf.addFolder(h.phone);
  h.write('a.m4a');
  const audio = path.join(h.recordings, 'copy.m4a');
  fs.writeFileSync(audio, 'preserved audio');
  const summary = h.context.summaryFileForAudio(audio);
  fs.writeFileSync(summary, '---\ntranscription_failed: true\nreprocessable: true\n---\n## Summary\nFailed');
  const statePath = path.join(h.userData, 'watched-folders.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.files[path.join(h.phone, 'a.m4a')] = { status: 'queued', audioFile: audio, summaryFile: summary };
  fs.writeFileSync(statePath, JSON.stringify(state));
  h.context.currentProcessingJob = { audioFile: audio };
  assert.strictEqual((await h.wf.list()).files[0].status, 'processing', 'active job wins over stale error artifact');
  h.context.currentProcessingJob = null;
  const [file] = (await h.wf.list()).files;
  assert.strictEqual(file.status, 'failed');
  assert.ok(!file.summaryFile, 'failure is not exposed as a completed note');
  await h.wf.transcribe([file.id]);
  assert.deepStrictEqual(h.queued, [audio]);
  assert.strictEqual(fs.readFileSync(audio, 'utf8'), 'preserved audio');
});

test('unknown ids are rejected', async () => {
  const h = harness();
  await assert.rejects(() => h.wf.transcribe(['nope']), /not found/);
  await assert.rejects(() => h.wf.transcribe('nope'), /Invalid selection/);
});
