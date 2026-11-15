'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createChecklistRunner } = require('./veneta-checklist-runner');

test('CLI transport uses a private JSON file, no content in argv, and removes its own request after completion', async (t) => {
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'veneta-runner-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let requestFile;
  const request = { revision: 'v1', privateText: 'Confidential meeting text' };
  const runner = createChecklistRunner({ getUserDataDir: () => root, getBackendPath: () => 'owned-backend',
    getBackendCwd: () => root, killProcessTree() {}, spawn(executable, args) {
      assert.equal(executable, 'owned-backend'); assert.equal(args[0], 'checklist-evaluate');
      assert.equal(args.length, 2); requestFile = args[1];
      assert.equal(args.join(' ').includes(request.privateText), false);
      assert.deepEqual(JSON.parse(fs.readFileSync(requestFile)), request);
      if (process.platform !== 'win32') assert.equal(fs.statSync(requestFile).mode & 0o777, 0o600);
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 424242;
      queueMicrotask(() => { child.stdout.emit('data', Buffer.from('{"revision":"v1","assessments":[]}')); child.emit('close', 0); });
      return child;
    } });
  assert.deepEqual(await runner(request), { revision: 'v1', assessments: [] });
  assert.equal(fs.existsSync(requestFile), false);
});

test('timeout kills only the owned child and never returns raw backend diagnostics', async (t) => {
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'veneta-timeout-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const kills = [];
  const runner = createChecklistRunner({ getUserDataDir: () => root, getBackendPath: () => 'owned', getBackendCwd: () => root,
    timeoutMs: 15, killProcessTree: (pid) => kills.push(pid), spawn() {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 424242;
      queueMicrotask(() => child.stderr.emit('data', Buffer.from('a private provider error')));
      return child;
    } });
  await assert.rejects(runner({}), (error) => !error.message.includes('private provider'));
  assert.deepEqual(kills, [424242]);
  assert.deepEqual(fs.readdirSync(path.join(root, 'veneta-modules', 'requests')), []);
});

function failingBackend(root, stdout, code = 1) {
  return createChecklistRunner({ getUserDataDir: () => root, getBackendPath: () => 'owned', getBackendCwd: () => root,
    killProcessTree() {}, spawn() {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 424242;
      queueMicrotask(() => { child.stdout.emit('data', Buffer.from(stdout)); child.emit('close', code); });
      return child;
    } });
}

test('a failed backend run hands only a whitelisted content-free reason to the host', async (t) => {
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'veneta-reason-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const reason of ['server_unreachable', 'server_start_failed', 'model_missing', 'model_not_local', 'timeout', 'invalid_answer', 'empty_answer', 'not_json', 'wrong_shape', 'truncated', 'provider_not_local']) {
    const body = JSON.stringify({ revision: 'v1', assessments: [], error: 'Vaste tekst', reason });
    await assert.rejects(failingBackend(root, body)({}), (error) => error.reason === reason && !error.message.includes('Vaste'));
  }
  const hostile = JSON.stringify({ revision: 'v1', assessments: [], error: 'x', reason: 'secret transcript text' });
  await assert.rejects(failingBackend(root, hostile)({}), (error) => error.reason === 'failed' && !JSON.stringify(error).includes('secret'));
  await assert.rejects(failingBackend(root, 'not json')({}), (error) => error.reason === 'failed');
});

test('the runner deadline covers two bounded local model rounds and reports a timeout reason', async (t) => {
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'veneta-deadline-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runner = createChecklistRunner({ getUserDataDir: () => root, getBackendPath: () => 'owned', getBackendCwd: () => root,
    timeoutMs: 15, killProcessTree() {}, spawn() {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 424242;
      return child;
    } });
  await assert.rejects(runner({}), (error) => error.reason === 'timeout');
  assert.ok(createChecklistRunner.DEFAULT_TIMEOUT_MS >= 2 * 150000 + 30000);
});

test('the agenda chair uses the same private transport with its own fixed backend command; other commands are refused', async (t) => {
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'veneta-agenda-runner-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const seen = [];
  const runner = createChecklistRunner({ getUserDataDir: () => root, getBackendPath: () => 'owned', getBackendCwd: () => root, killProcessTree() {},
    command: 'agenda-analyze', spawn(_executable, args) {
      seen.push(args[0]);
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 424243;
      queueMicrotask(() => { child.stdout.emit('data', Buffer.from('{"revision":"a1","currentItem":null,"findings":[]}')); child.emit('close', 0); });
      return child;
    } });
  assert.deepEqual(await runner({ revision: 'a1' }), { revision: 'a1', currentItem: null, findings: [] });
  assert.deepEqual(seen, ['agenda-analyze']);
  assert.throws(() => createChecklistRunner({ getUserDataDir: () => root, getBackendPath: () => 'owned', getBackendCwd: () => root,
    killProcessTree() {}, spawn() {}, command: 'pull' }));
});
