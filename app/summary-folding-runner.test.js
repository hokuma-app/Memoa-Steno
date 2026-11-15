'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createSummaryFoldRunner } = require('./summary-folding-runner');
test('the quiet fold runner sends source only over stdin and parses bounded output', async () => {
  const child = new EventEmitter(); child.pid = 123;
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  let sent; let command;
  child.stdin.end = data => { sent = data; queueMicrotask(() => { child.stdout.emit('data', Buffer.from('{"schemaVersion":1}')); child.emit('close', 0); }); };
  const run = createSummaryFoldRunner({ getBackendPath: () => '/fixture/backend', getBackendCwd: () => '/fixture', getEnv: () => ({ FIXTURE: '1' }), spawn: (...args) => { command = args; return child; }, killProcessTree: () => {} });
  assert.deepEqual(await run({ full: 'SYNTHETIC_PRIVATE_SOURCE' }), { schemaVersion: 1 });
  assert.deepEqual(command[1], ['summary-fold', '--progress']);
  assert.equal(JSON.stringify(command).includes('SYNTHETIC_PRIVATE_SOURCE'), false);
  assert.equal(JSON.parse(sent).full, 'SYNTHETIC_PRIVATE_SOURCE');
  assert.deepEqual(command[2].env, { FIXTURE: '1' });
});
test('oversized input never spawns a process', async () => {
  let calls = 0;
  const run = createSummaryFoldRunner({ spawn: () => { calls++; } });
  await assert.rejects(run({ full: 'x'.repeat(262145) }), /De detailniveaus/);
  assert.equal(calls, 0);
});
test('timeout, excessive output and process failures reveal no private diagnostics', async () => {
  for (const failure of ['timeout', 'output', 'stderr', 'exit']) {
    const child = new EventEmitter(); child.pid = 123;
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    let killed = 0;
    child.stdin.end = () => queueMicrotask(() => {
      if (failure === 'output') child.stdout.emit('data', Buffer.alloc(1048577));
      if (failure === 'stderr') child.stderr.emit('data', 'PRIVATE_DIAGNOSTIC'.repeat(5000));
      if (failure === 'exit') { child.stderr.emit('data', 'PRIVATE_DIAGNOSTIC'); child.emit('close', 1); }
    });
    const run = createSummaryFoldRunner({ getBackendPath: () => '/fixture', getBackendCwd: () => '/fixture', getEnv: () => ({}), spawn: () => child, killProcessTree: pid => { assert.equal(pid, 123); killed++; }, timeoutMs: 10 });
    await assert.rejects(run({}), error => error.message === 'De detailniveaus konden niet worden voorbereid.');
    if (failure !== 'exit') assert.equal(killed, 1);
  }
});
function fakeChild() {
  const child = new EventEmitter(); child.pid = 321;
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  return child;
}
test('0.9.1: progress counters reach the host, other stderr stays private and argv stays content-free', async () => {
  const child = fakeChild(); let command; const seen = [];
  child.stdin.end = () => queueMicrotask(() => {
    child.stderr.emit('data', Buffer.from('{"progress":{"done":1,"total":3}}\nPRIVATE_DIAGNOSTIC\n{"progress":{"done":'));
    child.stderr.emit('data', Buffer.from('3,"total":3}}\n{"progress":{"done":9,"total":2}}\n'));
    child.stdout.emit('data', Buffer.from('{"schemaVersion":1}')); child.emit('close', 0);
  });
  const run = createSummaryFoldRunner({ getBackendPath: () => '/fixture', getBackendCwd: () => '/fixture', getEnv: () => ({}), spawn: (...args) => { command = args; return child; }, killProcessTree: () => {} });
  assert.deepEqual(await run({ full: 'SYNTHETIC_PRIVATE_SOURCE' }, { onProgress: p => seen.push(p) }), { schemaVersion: 1 });
  assert.deepEqual(command[1], ['summary-fold', '--progress']);
  assert.deepEqual(seen, [{ done: 1, total: 3 }, { done: 3, total: 3 }]);
});
test('0.9.1: failures carry a content-free reason for the interface', async () => {
  const cases = [
    ['{"error":"x","reason":"invalid_structure"}', 1, 'invalid_structure'],
    ['{"error":"x","reason":"provider_unavailable"}', 1, 'provider_unavailable'],
    ['{"error":"x","reason":"too_long"}', 1, 'too_long'],
    ['{"error":"x","reason":"<script>PRIVATE</script>"}', 1, 'failed'],
    ['not json PRIVATE', 1, 'failed'],
  ];
  for (const [stdout, code, reason] of cases) {
    const child = fakeChild();
    child.stdin.end = () => queueMicrotask(() => { child.stdout.emit('data', Buffer.from(stdout)); child.emit('close', code); });
    const run = createSummaryFoldRunner({ getBackendPath: () => '/f', getBackendCwd: () => '/f', getEnv: () => ({}), spawn: () => child, killProcessTree: () => {} });
    await assert.rejects(run({}), error => error.reason === reason && !error.message.includes('PRIVATE'));
  }
  const tooLarge = createSummaryFoldRunner({ spawn: () => assert.fail('no spawn') });
  await assert.rejects(tooLarge({ full: 'x'.repeat(262145) }), error => error.reason === 'too_long');
});
test('0.9.1: local models get a longer bounded budget; silence ends the run as a timeout, progress keeps it alive', async () => {
  const defaults = createSummaryFoldRunner({ spawn: () => {} });
  assert.ok(defaults.timeouts.totalMs >= 600000 && defaults.timeouts.totalMs <= 1800000);
  assert.ok(defaults.timeouts.idleMs >= 180000 && defaults.timeouts.idleMs <= defaults.timeouts.totalMs);
  const child = fakeChild(); let killed = 0;
  child.stdin.end = () => {
    setTimeout(() => child.stderr.emit('data', Buffer.from('{"progress":{"done":1,"total":2}}\n')), 30);
    setTimeout(() => { child.stdout.emit('data', Buffer.from('{"ok":1}')); child.emit('close', 0); }, 60);
  };
  const run = createSummaryFoldRunner({ getBackendPath: () => '/f', getBackendCwd: () => '/f', getEnv: () => ({}), spawn: () => child, killProcessTree: () => { killed++; }, idleTimeoutMs: 45, timeoutMs: 1000 });
  assert.deepEqual(await run({}), { ok: 1 });
  assert.equal(killed, 0);
  const silent = fakeChild(); silent.stdin.end = () => {};
  const stalled = createSummaryFoldRunner({ getBackendPath: () => '/f', getBackendCwd: () => '/f', getEnv: () => ({}), spawn: () => silent, killProcessTree: () => { killed++; }, idleTimeoutMs: 20, timeoutMs: 1000 });
  await assert.rejects(stalled({}), error => error.reason === 'timeout');
  assert.equal(killed, 1);
});
