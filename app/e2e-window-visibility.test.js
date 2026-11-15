'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { mayExposeMainWindow, mayExposeWindow, e2eActivationPolicy } = require('./e2e-window-visibility');

test('normal application windows may be shown', () => {
  assert.strictEqual(mayExposeMainWindow({ isE2EHeadless: false }), true);
});

test('headless E2E windows may never be shown or focused', () => {
  assert.strictEqual(mayExposeMainWindow({ isE2EHeadless: true }), false);
});

test('the notification toast, native dialogs and the dock follow the same rule', () => {
  assert.strictEqual(mayExposeWindow({ isE2EHeadless: false }), true);
  assert.strictEqual(mayExposeWindow({ isE2EHeadless: true }), false);
  assert.strictEqual(mayExposeWindow(), true);
});

test('headless E2E on macOS runs as an accessory app: no dock icon, no activation', () => {
  assert.strictEqual(e2eActivationPolicy({ isE2EHeadless: true, platform: 'darwin' }), 'accessory');
});

test('production and visible E2E runs keep the normal activation policy', () => {
  assert.strictEqual(e2eActivationPolicy({ isE2EHeadless: false, platform: 'darwin' }), null);
  assert.strictEqual(e2eActivationPolicy({ isE2EHeadless: true, platform: 'linux' }), null);
  assert.strictEqual(e2eActivationPolicy({ isE2EHeadless: true, platform: 'win32' }), null);
});
