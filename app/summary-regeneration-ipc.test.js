'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ts = require('typescript');
const { makeLineReader } = require('./backend-stream');
const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const file = ts.createSourceFile('main.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const registration = file.statements.find(statement => ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.arguments[0]?.text === 'generate-report-meeting');
const watchdog = file.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'makeInactivityWatchdog');
function setup() {
  let handler; let args; const jobs = new Map();
  const proc = new EventEmitter(); proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter();
  vm.runInNewContext(watchdog.getText(file) + '\n' + registration.getText(file), {
    ipcMain: { handle: (_channel, callback) => { handler = callback; } },
    validateMeetingFilePath: async () => ({ realPath: '/synthetic/canonical.json' }),
    require, Buffer, activeReprocessJobs: jobs,
    spawn: (_backend, input) => { args = input; return proc; },
    getBackendPath: () => '/synthetic/backend', getBackendCwd: () => '/synthetic',
    getAiEnv: () => ({}), getBackendEnv: () => ({}),
    makeLineReader, setTimeout: () => 1, clearTimeout: () => {}, TRANSCRIBE_INACTIVITY_MS: 1000,
    activeInactivityWatchdogs: new Set(), systemSuspendedForWatchdogs: false,
    sendDebugLog() {}, forwardDiagnosticStdout() {}, mainWindow: null, console: { log() {} },
  });
  return { call: detail => handler({}, '/synthetic/alias.json', 'custom-template', detail), proc, jobs, args: () => args };
}
test('custom per-run regeneration is cancellable through its existing queue job and uses canonical transcript path', async () => {
  const state = setup(); const promise = state.call('balanced');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(Array.from(state.args()), ['generate-report', '/synthetic/canonical.json', 'custom-template', '--summary-detail', 'balanced']);
  assert.equal(state.jobs.get('/synthetic/alias.json').proc, state.proc);
  state.proc.emit('close', 0);
  assert.equal((await promise).success, true);
  assert.equal(state.jobs.size, 0);
});
test('invalid report length fails before spawn', async () => {
  const state = setup();
  assert.equal((await state.call('invalid')).success, false);
  assert.equal(state.args(), undefined);
});
