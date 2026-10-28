'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(build = require('./package.json').build) {
  const filename = path.join(__dirname, 'electron-builder.memoa.cjs');
  assert.ok(fs.existsSync(filename), 'Memoa Test packaging config must exist');
  const sandbox = { module: { exports: {} }, require: (id) => {
    assert.equal(id, './package.json');
    return { build };
  } };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox);
  return sandbox.module.exports;
}

test('test package identity is explicit, arm64-only, separately output and unpublished', () => {
  const config = load();
  assert.equal(config.appId, 'local.memoa.test');
  assert.equal(config.productName, 'Memoa Test');
  assert.equal(config.extraMetadata.name, 'memoa-test');
  assert.equal(config.extraMetadata.memoaTest, true);
  assert.equal(config.directories.output, 'dist-memoa');
  assert.equal(JSON.stringify(config.mac.target), JSON.stringify([{ target: 'dir', arch: ['arm64'] }]));
  assert.equal(config.publish, null);
  assert.equal(JSON.stringify(config.protocols), '[]');
  assert.equal(JSON.stringify(config.mac.fileAssociations), '[]');
  assert.ok(config.files.includes('!dist-memoa/**/*'));
});

test('signing requires the existing stable local certificate without notarization or timestamp', () => {
  const config = load();
  assert.equal(config.forceCodeSigning, true);
  assert.equal(config.mac.identity, 'Memoa Test Local Signing');
  assert.equal(config.mac.notarize, false);
  assert.equal(config.mac.timestamp, 'none');
  assert.equal(config.mac.hardenedRuntime, true);
});

test('base backend, entitlements, afterPack and future settings survive without mutation', () => {
  const base = structuredClone(require('./package.json').build);
  base.afterPack = 'existing-after-pack.cjs';
  base.extraMetadata = { retained: true };
  base.mac.futureOption = 'retained';
  const before = JSON.stringify(base);
  const config = load(base);
  assert.equal(config.afterPack, base.afterPack);
  assert.equal(config.extraResources, base.extraResources);
  assert.equal(config.mac.extraResources, base.mac.extraResources);
  assert.equal(config.mac.entitlements, base.mac.entitlements);
  assert.equal(config.mac.entitlementsInherit, base.mac.entitlementsInherit);
  assert.equal(config.mac.futureOption, 'retained');
  assert.equal(config.extraMetadata.retained, true);
  assert.equal(config.directories.buildResources, base.directories.buildResources);
  assert.equal(JSON.stringify(base), before);
});
