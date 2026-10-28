'use strict';
// Exercise the signed packaged UI with mock IPC, no recording or model download.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require('../app/node_modules/playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, '.local');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'memoa-packaged-smoke-'));
  const application = process.env.MEMOA_PACKAGE_PATH || path.join(root, 'app/dist-memoa/mac-arm64/Memoa Test.app');
  const executablePath = path.join(application, 'Contents/MacOS/Memoa Test');
  const electron = await _electron.launch({
    executablePath, cwd: path.join(root, 'app'),
    env: { ...process.env, STENOAI_E2E: '1', STENOAI_E2E_HEADLESS: '1',
      STENOAI_E2E_MOCK_IPC: '1', STENOAI_USER_DATA_DIR: data,
      STENOAI_UI_LANGUAGE: 'en', HF_HUB_OFFLINE: '1', HF_HOME: path.join(data, 'models') },
  });
  try {
    const page = await electron.firstWindow();
    await page.waitForSelector('#root > *', { timeout: 30000 });
    const state = await electron.evaluate(({ app }) => ({
      name: app.getName(), userData: app.getPath('userData'), packaged: app.isPackaged,
      hfHome: process.env.HF_HOME, hfHub: process.env.HF_HUB_CACHE,
      legacyHfHub: process.env.HUGGINGFACE_HUB_CACHE,
      whisperModels: process.env.MEMOA_WHISPER_MODELS_DIR,
    }));
    assert.equal(state.name, 'Memoa Test');
    assert.equal(state.userData, data);
    assert.equal(state.packaged, true);
    assert.equal(state.hfHome, path.join(data, 'models', 'huggingface'));
    assert.equal(state.hfHub, path.join(state.hfHome, 'hub'));
    assert.equal(state.legacyHfHub, state.hfHub);
    assert.equal(state.whisperModels, path.join(data, 'models', 'whisper'));
    const renderer = await page.evaluate(() => ({
      title: document.title, rendered: document.querySelector('#root').textContent.trim().length > 0,
      bridge: typeof window.stenoai === 'object',
    }));
    assert.equal(renderer.rendered, true);
    assert.equal(renderer.bridge, true);
    await page.screenshot({ path: path.join(output, 'memoa-packaged-smoke.png') });
    const result = { ...state, renderer, mode: 'packaged UI, mock IPC; no recording or models' };
    fs.writeFileSync(path.join(output, 'memoa-packaged-smoke.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await electron.close();
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
