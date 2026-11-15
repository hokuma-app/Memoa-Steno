'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MOCK = path.join(__dirname, 'e2e-model-choice-mock.js');
const CATALOG = path.join(__dirname, '..', 'src', 'data', 'model_catalog.json');

/**
 * The packaged app keeps this file inside app.asar, where `../src/data` does not exist (the repo
 * layout is gone). The stub must then read the catalogue the backend ships, so the T1 on a package
 * shows the same list as in development. This test lays out a package: the mock without a sibling
 * `src`, and the catalogue only under <resources>/stenoai/_internal/src/data.
 */
function packagedLayout() {
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mock-package-'));
  const asar = path.join(root, 'Resources', 'app.asar');
  fs.mkdirSync(asar, { recursive: true });
  fs.copyFileSync(MOCK, path.join(asar, 'e2e-model-choice-mock.js'));
  const shipped = path.join(root, 'Resources', 'stenoai', '_internal', 'src', 'data');
  fs.mkdirSync(shipped, { recursive: true });
  fs.copyFileSync(CATALOG, path.join(shipped, 'model_catalog.json'));
  return { root, mock: path.join(asar, 'e2e-model-choice-mock.js'), resources: path.join(root, 'Resources') };
}

test('the stub lists models from the catalogue shipped with the packaged backend', async () => {
  const layout = packagedLayout();
  const userData = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mock-userdata-'));
  const before = { user: process.env.STENOAI_USER_DATA_DIR, res: process.resourcesPath };
  process.env.STENOAI_USER_DATA_DIR = userData;
  Object.defineProperty(process, 'resourcesPath', { value: layout.resources, configurable: true, writable: true });
  try {
    const { runPythonScript } = require(layout.mock);
    const result = JSON.parse(await runPythonScript('unused', ['model-choices']));
    assert.strictEqual(result.success, true);
    const shipped = JSON.parse(fs.readFileSync(CATALOG, 'utf8')).models;
    assert.strictEqual(result.catalog.length, shipped.length);
  } finally {
    if (before.user === undefined) delete process.env.STENOAI_USER_DATA_DIR; else process.env.STENOAI_USER_DATA_DIR = before.user;
    Object.defineProperty(process, 'resourcesPath', { value: before.res, configurable: true, writable: true });
    fs.rmSync(layout.root, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('the stub still reads the repository catalogue in development', async () => {
  const userData = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mock-userdata-'));
  const before = process.env.STENOAI_USER_DATA_DIR;
  process.env.STENOAI_USER_DATA_DIR = userData;
  try {
    const { runPythonScript } = require(MOCK);
    const result = JSON.parse(await runPythonScript('unused', ['model-choices']));
    assert.strictEqual(result.success, true);
    assert.ok(result.catalog.length > 0);
  } finally {
    if (before === undefined) delete process.env.STENOAI_USER_DATA_DIR; else process.env.STENOAI_USER_DATA_DIR = before;
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('the stub: the agenda follows the checklist until it has its own choice (0.11.0)', async () => {
  const userData = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mock-userdata-'));
  const before = process.env.STENOAI_USER_DATA_DIR;
  process.env.STENOAI_USER_DATA_DIR = userData;
  try {
    const { runPythonScript } = require(MOCK);
    const list = async () => JSON.parse(await runPythonScript('unused', ['model-choices'])).functions.agenda;
    assert.deepStrictEqual(await list(), { choice: '', effective: 'gemma4:e2b-it-qat' });
    await runPythonScript('unused', ['set-function-model', 'checklist', 'stub-extra:1b']);
    assert.deepStrictEqual(await list(), { choice: '', effective: 'stub-extra:1b' });
    await runPythonScript('unused', ['set-function-model', 'agenda', 'gemma4:e2b-it-qat']);
    assert.deepStrictEqual(await list(), { choice: 'gemma4:e2b-it-qat', effective: 'gemma4:e2b-it-qat' });
  } finally {
    if (before === undefined) delete process.env.STENOAI_USER_DATA_DIR; else process.env.STENOAI_USER_DATA_DIR = before;
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
