'use strict';
// Exercise the signed package in an owned profile, with no models or real capture.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require('../app/node_modules/playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, '.local/veneta-verification');
  const application = process.env.VENETA_PACKAGE_PATH || path.join(root, '.local/veneta-interface/mac-arm64/Veneta MemoAi.app');
  const executablePath = path.join(application, 'Contents/MacOS/Veneta MemoAi');
  fs.accessSync(executablePath, fs.constants.X_OK);
  fs.mkdirSync(output, { recursive: true });
  const data = fs.mkdtempSync(path.join(process.env.TMPDIR, 'veneta-packaged-smoke-'));
  const electron = await _electron.launch({
    executablePath, cwd: path.join(root, 'app'),
    env: { ...process.env, STENOAI_E2E: '1', STENOAI_E2E_HEADLESS: '1',
      STENOAI_E2E_MOCK_IPC: '1', STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1',
      STENOAI_USER_DATA_DIR: data, HF_HUB_OFFLINE: '1' },
  });
  try {
    const page = await electron.firstWindow();
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForSelector('#root > *', { timeout: 30000 });
    await page.waitForFunction(() => document.fonts.check('16px "Titillium Web"'));
    const state = await electron.evaluate(({ app, Menu }) => ({
      name: app.getName(), userData: app.getPath('userData'), packaged: app.isPackaged,
      menuLabel: Menu.getApplicationMenu()?.items[0]?.label,
      hfHome: process.env.HF_HOME, hfHub: process.env.HF_HUB_CACHE,
      whisperModels: process.env.MEMOA_WHISPER_MODELS_DIR,
    }));
    assert.equal(state.name, 'Memoa Test');
    assert.equal(state.menuLabel, 'Veneta MemoAi');
    assert.equal(state.userData, data);
    assert.equal(state.packaged, true);
    assert.equal(state.hfHome, path.join(data, 'models/huggingface'));
    assert.equal(state.hfHub, path.join(state.hfHome, 'hub'));
    assert.equal(state.whisperModels, path.join(data, 'models/whisper'));
    const renderer = await page.evaluate(() => ({
      title: document.title, product: document.documentElement.dataset.product,
      font: getComputedStyle(document.body).fontFamily,
      yellow: getComputedStyle(document.documentElement).getPropertyValue('--veneta-yellow').trim(),
      bridge: typeof window.stenoai === 'object',
    }));
    assert.equal(renderer.title, 'Veneta MemoAi');
    assert.equal(renderer.product, 'veneta-memoai');
    assert.match(renderer.font, /Titillium Web/);
    assert.equal(renderer.yellow.toUpperCase(), '#FFD900');
    assert.equal(renderer.bridge, true);
    await page.screenshot({ path: path.join(output, 'packaged-light.png') });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.screenshot({ path: path.join(output, 'packaged-dark.png') });
    const result = { ...state, renderer, mode: 'Signed packaged UI, isolated mock IPC; no recording or models' };
    fs.writeFileSync(path.join(output, 'package-smoke.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await electron.close();
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
