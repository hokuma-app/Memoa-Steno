'use strict';
// 0.11.0: the MemoAi toast sits at the normal window level, never takes focus and never surfaces in headless E2E.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TOAST_AUTO_CLOSE_MS, toastWindowOptions, showToast } = require('./notification-window');
const { mayExposeWindow } = require('./e2e-window-visibility');

const display = { workArea: { x: 0, y: 25 }, workAreaSize: { width: 1440, height: 875 } };

test('toast options: hidden at creation, no focus, first click counts, normal window level', () => {
  const options = toastWindowOptions({ ...display, preload: '/x/preload.js' });
  assert.equal(options.show, false, 'shown only with showInactive, so the app is not brought forward');
  assert.equal(options.focusable, false);
  assert.equal(options.acceptFirstMouse, true);
  assert.equal(options.alwaysOnTop, false, 'not above every other window');
  assert.equal(options.skipTaskbar, true);
  assert.deepEqual([options.x, options.y, options.width, options.height], [1015, 26, 400, 70]);
  assert.deepEqual(options.webPreferences, { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: '/x/preload.js' });
  assert.equal(TOAST_AUTO_CLOSE_MS, 15000);
});

test('showing a toast: showInactive only, never always-on-top, all desktops or over full-screen apps', () => {
  const calls = [];
  const win = {
    showInactive: () => calls.push('showInactive'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
    setAlwaysOnTop: (...args) => calls.push(['setAlwaysOnTop', ...args]),
    setVisibleOnAllWorkspaces: (...args) => calls.push(['setVisibleOnAllWorkspaces', ...args]),
  };
  assert.equal(showToast(win, { mayExpose: mayExposeWindow({ isE2EHeadless: false }) }), true);
  assert.deepEqual(calls, ['showInactive']);
  calls.length = 0;
  assert.equal(showToast(win, { mayExpose: mayExposeWindow({ isE2EHeadless: true }) }), false, 'headless E2E: never on screen');
  assert.deepEqual(calls, []);
});

test('main.js builds the toast from these helpers and no longer raises it to the screen-saver level', () => {
  const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const start = source.indexOf('class Notification extends EventEmitter');
  const body = source.slice(start, source.indexOf('\n}\n', start));
  assert.ok(start > 0);
  assert.match(body, /new BrowserWindow\(toastWindowOptions\(/);
  assert.match(body, /showToast\(win, \{ mayExpose: mayExposeWindow\(\{ isE2EHeadless: IS_E2E_HEADLESS \}\) \}\)/);
  assert.match(body, /TOAST_AUTO_CLOSE_MS/);
  assert.doesNotMatch(body, /setAlwaysOnTop|setVisibleOnAllWorkspaces|screen-saver|visibleOnFullScreen/);
});
