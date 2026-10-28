'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { initializeMemoaTestProfile } = require('./memoa-test-profile');

function initialize(metadata, override) {
  const calls = [];
  const env = override ? { STENOAI_USER_DATA_DIR: override } : {};
  const app = {
    setName(name) { calls.push(['name', name]); },
    getPath(key) { assert.equal(key, 'appData'); return '/isolated/app-data'; },
    setPath(key, value) { calls.push([key, value]); },
  };
  initializeMemoaTestProfile({ app, metadata, env, mkdir() {} });
  return { calls, env };
}

function assertRoots(env, root) {
  assert.deepEqual(env, {
    STENOAI_USER_DATA_DIR: root,
    HF_HOME: path.join(root, 'models', 'huggingface'),
    HF_HUB_CACHE: path.join(root, 'models', 'huggingface', 'hub'),
    HUGGINGFACE_HUB_CACHE: path.join(root, 'models', 'huggingface', 'hub'),
    MEMOA_WHISPER_MODELS_DIR: path.join(root, 'models', 'whisper'),
    OLLAMA_MODELS: path.join(root, 'ollama', 'models'),
    OLLAMA_TMPDIR: path.join(root, 'ollama', 'tmp'),
  });
}

test('Veneta metadata preserves the immutable internal Memoa Test name and every existing root', () => {
  // Reviewed Electron 42.11.18 derives the macOS Keychain service/account from
  // app_name. Assert that input invariant, never access safeStorage or Keychain.
  const { calls, env } = initialize({ memoaTest: true, venetaMemoAi: true });
  assert.deepEqual(calls, [['name', 'Memoa Test'], ['userData', '/isolated/app-data/Memoa Test']]);
  assertRoots(env, '/isolated/app-data/Memoa Test');
  assert.deepEqual(env, initialize({ memoaTest: true }).env);
});

test('Veneta keeps an explicit user-data override verbatim and all caches beneath it', () => {
  const root = '/isolated/veneta/../owned-profile';
  const { calls, env } = initialize({ memoaTest: true, venetaMemoAi: true }, root);
  assert.deepEqual(calls, [['name', 'Memoa Test'], ['userData', root]]);
  assertRoots(env, root);
});

test('legacy Memoa package name remains compatible', () => {
  assert.deepEqual(initialize({ memoaTest: true }).calls[0], ['name', 'Memoa Test']);
});

function nativeMenu(metadata, name, platform = 'darwin') {
  const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const start = source.indexOf('const appMenu = Menu.buildFromTemplate(');
  assert.ok(start >= 0, 'production application-menu construction exists');
  const end = source.indexOf('Menu.setApplicationMenu(appMenu);', start);
  assert.ok(end > start, 'production application-menu installation exists');
  // Execute the actual production template, not a duplicate label expression.
  return vm.runInNewContext(source.slice(start, end) + '\nappMenu;', {
    app: { name }, process: { platform }, settingsItem: {}, helpSubmenu: {},
    Menu: { buildFromTemplate: (template) => template },
    require: (id) => { assert.equal(id, './package.json'); return metadata; },
  });
}

test('real native application-menu template uses Veneta display branding only for strict metadata', () => {
  assert.equal(nativeMenu({ venetaMemoAi: true }, 'Memoa Test')[0].label, 'Veneta MemoAi');
});

test('real native application-menu template preserves the old app.name fallback', () => {
  for (const value of [undefined, false, 'true', 1, null]) {
    const metadata = value === undefined ? {} : { venetaMemoAi: value };
    for (const name of ['Memoa Test', 'StenoAI', 'Other legacy name']) {
      assert.equal(nativeMenu(metadata, name)[0].label, name);
    }
  }
  for (const platform of ['win32', 'linux']) {
    assert.equal(nativeMenu({ venetaMemoAi: true }, 'Memoa Test', platform)[0].label, '&File');
  }
});

test('Veneta package retains test identity and signing while disabling upstream publication', () => {
  const config = require('./electron-builder.veneta.cjs');
  const base = require('./electron-builder.memoa.cjs');
  assert.equal(config.productName, 'Veneta MemoAi');
  assert.equal(config.appId, 'local.memoa.test');
  assert.equal(config.extraMetadata.memoaTest, true);
  assert.equal(config.extraMetadata.venetaMemoAi, true);
  assert.equal(config.mac.identity, base.mac.identity);
  assert.equal(config.mac.entitlements, base.mac.entitlements);
  assert.equal(config.mac.entitlementsInherit, base.mac.entitlementsInherit);
  assert.equal(config.forceCodeSigning, base.forceCodeSigning);
  assert.equal(config.publish, null);
  assert.deepEqual(config.protocols, []);
  assert.deepEqual(config.mac.fileAssociations, []);
  assert.equal(config.mac.notarize, false);
});
