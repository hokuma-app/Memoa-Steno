'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function bootstrap(metadata, env = {}) {
  const calls = [];
  const app = {
    setName: (name) => calls.push(['name', name]),
    getPath: (key) => { assert.equal(key, 'appData'); return '/isolated/Application Support'; },
    setPath: (key, value) => calls.push([key, value]),
  };
  const modulePath = path.join(__dirname, 'memoa-test-profile.js');
  assert.ok(fs.existsSync(modulePath), 'Memoa Test bootstrap must exist');
  const enabled = require(modulePath).initializeMemoaTestProfile({ app, metadata, env, mkdir: () => {} });
  return { enabled, calls, env };
}

test('explicit test metadata isolates Electron, safeStorage name and inherited backend root', () => {
  const result = bootstrap({ memoaTest: true });
  const root = '/isolated/Application Support/Memoa Test';
  assert.equal(result.enabled, true);
  assert.deepEqual(result.calls, [['name', 'Memoa Test'], ['userData', root]]);
  assert.equal(result.env.STENOAI_USER_DATA_DIR, root);
});

test('production metadata is inert, including an existing e2e override', () => {
  for (const metadata of [{}, { name: 'memoa-test' }, { memoaTest: 'true' }, { memoaTest: false }]) {
    const env = {
      STENOAI_USER_DATA_DIR: '/e2e', OLLAMA_MODELS: '/existing',
      HF_HOME: '/shared/hf', HF_HUB_CACHE: '/shared/hub',
      HUGGINGFACE_HUB_CACHE: '/shared/legacy-hub', MEMOA_WHISPER_MODELS_DIR: '/shared/whisper',
    };
    const before = { ...env };
    const result = bootstrap(metadata, env);
    assert.equal(result.enabled, false);
    assert.deepEqual(result.calls, []);
    assert.deepEqual(env, before);
  }
});

test('test-owned Ollama model and temporary cache roots cannot inherit production paths', () => {
  const { env } = bootstrap({ memoaTest: true }, {
    STENOAI_USER_DATA_DIR: '/e2e', OLLAMA_MODELS: '/production/models', OLLAMA_TMPDIR: '/production/cache',
  });
  assert.equal(env.OLLAMA_MODELS, path.join('/e2e', 'ollama', 'models'));
  assert.equal(env.OLLAMA_TMPDIR, path.join('/e2e', 'ollama', 'tmp'));
});

test('test-owned ASR caches override every inherited HuggingFace and Whisper root', () => {
  const { env } = bootstrap({ memoaTest: true }, {
    STENOAI_USER_DATA_DIR: '/e2e', HF_HOME: '/production/hf',
    HF_HUB_CACHE: '/production/hub', HUGGINGFACE_HUB_CACHE: '/production/legacy-hub',
    MEMOA_WHISPER_MODELS_DIR: '/production/whisper',
  });
  assert.equal(env.HF_HOME, path.join('/e2e', 'models', 'huggingface'));
  assert.equal(env.HF_HUB_CACHE, path.join(env.HF_HOME, 'hub'));
  assert.equal(env.HUGGINGFACE_HUB_CACHE, env.HF_HUB_CACHE);
  assert.equal(env.MEMOA_WHISPER_MODELS_DIR, path.join('/e2e', 'models', 'whisper'));
});

test('main bootstraps before all other modules and ready hooks', () => {
  const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const early = source.slice(0, source.indexOf('// safeStorage'));
  const calls = [];
  vm.runInNewContext(early + '\nif (!IS_MEMOA_TEST) throw new Error("test profile not enabled");', {
    require: (id) => {
      if (id === 'electron') return { app: {} };
      if (id === './package.json') return { memoaTest: true };
      if (id === './memoa-test-profile') return {
        initializeMemoaTestProfile: ({ metadata }) => { calls.push(metadata.memoaTest); return true; },
      };
      throw new Error(`Unexpected early import: ${id}`);
    },
  });
  assert.deepEqual(calls, [true]);
  assert.match(source, /if \(!app\.isPackaged && !IS_MEMOA_TEST\)/);
});

function mainFunction(name) {
  const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  const end = source.indexOf('\n}', start) + 2;
  const declaration = source.slice(Math.max(0, start - 6), start) === 'async ' ? start - 6 : start;
  return source.slice(declaration, end);
}

test('test build cannot initialize, schedule, manually kick or install upstream updates', async () => {
  const context = {
    IS_MEMOA_TEST: true, IS_E2E: false, IS_CUSTOM_BUILD: false,
    app: { isPackaged: true }, sendDebugLog() {},
    isOSUpdateEligible: () => true, currentSystemVersionSafe: () => '27.0',
    process: { platform: 'darwin' }, MIN_MACOS_FOR_AUTOUPDATE: '14.4',
    autoInstallFired: false,
  };
  const functions = ['setupAutoUpdater', 'autoUpdateOSEligible', 'startIdleAutoInstallChecker', 'maybeAutoInstallWhenIdle'];
  vm.createContext(context);
  vm.runInContext(functions.map(mainFunction).join('\n'), context);
  assert.equal(context.autoUpdateOSEligible(), false);
  context.setupAutoUpdater(); // no autoUpdater/timer object supplied: touching either fails
  context.startIdleAutoInstallChecker();
  await context.maybeAutoInstallWhenIdle();
  const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const manual = source.slice(source.indexOf("ipcMain.on('install-update'"), source.indexOf('// ── Auto-detect meetings'));
  let install;
  vm.runInNewContext(manual, { ...context, ipcMain: { on: (_name, fn) => { install = fn; } } });
  install();
  assert.match(source, /if \(!IS_MEMOA_TEST && !IS_E2E && !IS_CUSTOM_BUILD && app\.isPackaged && osEligible\)/);
});

test('production updater eligibility and initialization are not disabled by the test profile', () => {
  const context = {
    IS_MEMOA_TEST: false, IS_E2E: false, IS_CUSTOM_BUILD: false,
    app: { isPackaged: true }, sendDebugLog() {},
    isOSUpdateEligible: () => true, currentSystemVersionSafe: () => '27.0',
    process: { platform: 'darwin' }, MIN_MACOS_FOR_AUTOUPDATE: '14.4',
    autoUpdater: { on() {} },
  };
  vm.createContext(context);
  vm.runInContext(['autoUpdateOSEligible', 'setupAutoUpdater'].map(mainFunction).join('\n'), context);
  assert.equal(context.autoUpdateOSEligible(), true);
  // This fixture stops at the first scheduled check, proving production gets
  // past test/custom/e2e gates and still enables downloads and quit-install.
  assert.throws(() => context.setupAutoUpdater(), /setTimeout is not defined/);
  assert.equal(context.autoUpdater.autoDownload, true);
  assert.equal(context.autoUpdater.autoInstallOnAppQuit, true);
});

test('test runtime does not claim Steno shortcuts and uses its own microphone identity', () => {
  const context = { IS_MEMOA_TEST: true, process: { platform: 'darwin' } };
  vm.createContext(context);
  vm.runInContext(mainFunction('registerShortcutProtocolClient'), context);
  assert.equal(context.registerShortcutProtocolClient(), false);
  const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  assert.match(source, /const STENO_BUNDLE_ID = IS_MEMOA_TEST \? 'local\.memoa\.test' : 'com\.stenoai\.recorder';/);
});

test('isolated roots survive the real backend spawn wrapper, even with explicit extra env', async () => {
  const { spawn } = require('./backend-cli');
  const env = bootstrap({ memoaTest: true }, { STENOAI_USER_DATA_DIR: '/e2e/child-root' }).env;
  const child = spawn(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], { env });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  const code = await new Promise((resolve, reject) => { child.on('close', resolve); child.on('error', reject); });
  assert.equal(code, 0);
  const inherited = JSON.parse(output);
  for (const key of ['STENOAI_USER_DATA_DIR', 'OLLAMA_MODELS', 'OLLAMA_TMPDIR',
    'HF_HOME', 'HF_HUB_CACHE', 'HUGGINGFACE_HUB_CACHE', 'MEMOA_WHISPER_MODELS_DIR']) {
    assert.equal(inherited[key], env[key]);
  }
});

test('an existing STENOAI_USER_DATA_DIR wins without normalization or migration', () => {
  const result = bootstrap({ memoaTest: true }, { STENOAI_USER_DATA_DIR: '/e2e/own-root' });
  assert.equal(result.env.STENOAI_USER_DATA_DIR, '/e2e/own-root');
  assert.deepEqual(result.calls, [['name', 'Memoa Test'], ['userData', '/e2e/own-root']]);
});

test('first launch creates the new data directory before Electron setPath', () => {
  const parent = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'memoa-first-launch-'));
  const expected = path.join(parent, 'Memoa Test');
  assert.equal(fs.existsSync(expected), false);
  let configured;
  require('./memoa-test-profile').initializeMemoaTestProfile({
    metadata: { memoaTest: true }, env: {},
    app: {
      setName() {}, getPath: () => parent,
      setPath: (_key, value) => {
        assert.equal(fs.existsSync(value), true, 'Electron rejects nonexistent directories');
        configured = value;
      },
    },
  });
  assert.equal(configured, expected);
});
