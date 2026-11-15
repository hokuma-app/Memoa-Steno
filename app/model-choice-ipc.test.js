'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { registerModelChoiceIpc } = require('./model-choice-ipc');

function setup({ answer = () => '{"success":true}', busy = false, ram } = {}) {
  const handlers = new Map();
  const calls = [];
  registerModelChoiceIpc({
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
    runPythonScript: async (script, args) => { calls.push(args); return answer(args); },
    totalRamGb: () => ram,
    isBusy: () => busy,
  });
  return { call: (channel, ...args) => handlers.get(channel)({}, ...args), calls, handlers };
}

test('registers exactly the four new channels', () => {
  const { handlers } = setup();
  assert.deepEqual([...handlers.keys()].sort(), ['model-choice-preview', 'model-choice-set', 'model-choice-test', 'model-choices']);
});

test('model-choices forwards the backend payload and adds this machine\'s memory when known', async () => {
  const { call, calls } = setup({ answer: () => '{"success":true,"installed":[]}', ram: 16 });
  assert.deepEqual(await call('model-choices'), { success: true, installed: [], total_ram_gb: 16 });
  assert.deepEqual(calls, [['model-choices']]);
});

test('choosing validates the function and the name before the CLI is reached', async () => {
  const { call, calls } = setup();
  for (const [fn, name] of [['transcribe', 'a:1'], ['summary', 5], ['checklist', 'x'.repeat(201)], ['checklist', 'a\nb'], ['checklist', null]]) {
    const result = await call('model-choice-set', fn, name);
    assert.equal(result.success, false);
  }
  assert.deepEqual(calls, []);
  await call('model-choice-set', 'summary_fold', 'gemma4:e4b-it-qat');
  await call('model-choice-set', 'checklist', '');
  assert.deepEqual(calls, [['set-function-model', 'summary_fold', 'gemma4:e4b-it-qat'], ['set-function-model', 'checklist', '']]);
});

test('a backend refusal on a non-zero exit comes back as a reason, not a crash', async () => {
  const handlers = new Map();
  registerModelChoiceIpc({
    ipcMain: { handle: (c, f) => handlers.set(c, f) },
    runPythonScript: async () => { throw Object.assign(new Error('exit 1'), { stdout: '{"success": false, "reason": "cloud"}\n' }); },
  });
  assert.deepEqual(await handlers.get('model-choice-set')({}, 'checklist', 'x:cloud'), { success: false, reason: 'cloud' });
  const dead = new Map();
  registerModelChoiceIpc({ ipcMain: { handle: (c, f) => dead.set(c, f) }, runPythonScript: async () => { throw new Error('spawn failed'); } });
  assert.deepEqual(await dead.get('model-choices')({}), { success: false, reason: 'failed' });
});

test('preview refuses empty and non-string names without a backend call', async () => {
  const { call, calls } = setup();
  assert.equal((await call('model-choice-preview', '')).reason, 'empty');
  assert.equal((await call('model-choice-preview', 7)).reason, 'invalid');
  assert.deepEqual(calls, []);
  await call('model-choice-preview', 'hf.co/org/repo:Q4_K_M');
  assert.deepEqual(calls, [['model-add-preview', 'hf.co/org/repo:Q4_K_M']]);
});

test('the trial runs only on an explicit call, one at a time, and never while the app is busy', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { call, calls } = setup({ answer: async () => { await gate; return '{"success":true,"valid":true}'; } });
  const first = call('model-choice-test', 'checklist');
  assert.equal((await call('model-choice-test', 'summary')).reason, 'busy');
  release();
  assert.equal((await first).valid, true);
  assert.deepEqual(calls, [['test-model-function', 'checklist']]);
  assert.equal((await call('model-choice-test', 'transcribe')).reason, 'invalid_function');
  const busy = setup({ busy: true });
  assert.equal((await busy.call('model-choice-test', 'summary')).reason, 'busy');
  assert.deepEqual(busy.calls, []);
});
