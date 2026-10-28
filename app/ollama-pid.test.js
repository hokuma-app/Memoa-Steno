const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
// Exercise only the real persistence blocks, never load Electron or start Ollama.
const writer = source.match(/\/\/ Write PID file so quit handler can find the process\n([\s\S]*?)\n\s*ollamaProcess\.stderr/)[1];
const reader = source.match(/    const pidFile = [^\n]*ollama\.pid[^\n]*\n[\s\S]*?    } catch \(_\) {}/)[0];

function fixture(t) {
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'electron-ollama-pid-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const backend = path.join(root, 'Dummy.app', 'Contents', 'Resources', 'stenoai');
  fs.mkdirSync(path.join(backend, '_internal'), { recursive: true });
  fs.writeFileSync(path.join(backend, '_internal', 'signed-resource'), 'unchanged');
  const user = path.join(root, 'new', 'user-data');
  const kills = [];
  const context = { require, path, getUserDataDir: () => user, getBackendCwd: () => backend,
    ollamaPid: 424242, killProcessTree: (pid) => kills.push(pid) };
  return { root, backend, user, kills, context };
}

function assertBundleUntouched(backend) {
  assert.deepEqual(fs.readdirSync(path.join(backend, '_internal')), ['signed-resource']);
  assert.equal(fs.readFileSync(path.join(backend, '_internal', 'signed-resource'), 'utf8'), 'unchanged');
}

test('Electron creates a missing user-data parent and writes outside the bundle', (t) => {
  const { backend, user, context } = fixture(t);
  vm.runInNewContext(writer, context);
  assertBundleUntouched(backend);
  assert.equal(fs.readFileSync(path.join(user, 'ollama.pid'), 'utf8'), '424242');
});

test('shutdown reads and clears the canonical user PID without touching legacy bundle PID', (t) => {
  const { backend, user, context, kills } = fixture(t);
  fs.mkdirSync(user, { recursive: true });
  fs.writeFileSync(path.join(user, 'ollama.pid'), '424242');
  const legacy = path.join(backend, '_internal', 'ollama.pid');
  fs.writeFileSync(legacy, '123456');
  vm.runInNewContext(reader, context);
  assert.deepEqual(kills, [424242]);
  assert.equal(fs.existsSync(path.join(user, 'ollama.pid')), false);
  assert.equal(fs.readFileSync(legacy, 'utf8'), '123456');
});

test('Python frozen producer and Electron shutdown share the user-data PID', {
  skip: process.env.STENOAI_TEST_PYTHON ? false : 'Set STENOAI_TEST_PYTHON to a provisioned Python interpreter to run the interoperability test',
}, (t) => {
  const { backend, user, context, kills } = fixture(t);
  const result = spawnSync(process.env.STENOAI_TEST_PYTHON, ['-c',
    "import sys; from src.ollama_manager import _write_pid; sys.frozen = True; sys._MEIPASS = sys.argv[1]; _write_pid(424242)",
    path.join(backend, '_internal')], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8',
    env: { ...process.env, STENOAI_USER_DATA_DIR: user, PYTHONDONTWRITEBYTECODE: '1' },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  assertBundleUntouched(backend);
  vm.runInNewContext(reader, context);
  assert.deepEqual(kills, [424242]);
  assert.equal(fs.existsSync(path.join(user, 'ollama.pid')), false);
});
