'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('module build has its own output and freshly built backend but preserves the tested application identity', () => {
  const file = path.join(__dirname, 'electron-builder.veneta-modules.cjs');
  assert.equal(fs.existsSync(file), true, 'The module package configuration is missing');
  const base = require('./electron-builder.veneta.cjs');
  const modules = require(file);
  assert.equal(modules.appId, base.appId);
  assert.equal(modules.appId, 'local.memoa.test');
  assert.equal(modules.productName, 'Veneta MemoAi');
  assert.equal(modules.extraMetadata.memoaTest, true);
  assert.deepEqual(modules.protocols, []);
  assert.equal(modules.publish, null);
  assert.equal(modules.extraMetadata.venetaMemoAi, true);
  assert.equal(modules.directories.output, '../.local/veneta-product-modules');
  assert.ok(modules.extraResources.some((item) => item.from === '../.local/veneta-product-modules/backend/stenoai'));
  assert.ok(!modules.extraResources.some((item) => item.from.includes('backend-memoa-r2')));
  assert.equal(base.directories.output, '../.local/veneta-interface');
});

test('build plan rebuilds Python before the renderer and packages only the separately selected module configuration', () => {
  const file = path.resolve(__dirname, '../custom/build-veneta-modules.cjs');
  assert.equal(fs.existsSync(file), true, 'The module build runner is missing');
  const { buildPlan } = require(file);
  const plan = buildPlan();
  assert.equal(path.basename(plan[0].command), 'pyinstaller');
  assert.ok(plan[0].args.includes('stenoai.spec'));
  assert.ok(plan[0].args.includes('.local/veneta-product-modules/backend'));
  assert.deepEqual(plan[1].args, ['run', 'build:renderer']);
  assert.ok(plan[2].args.includes('electron-builder.veneta-modules.cjs'));
  assert.ok(plan[2].args.includes('never'));
});

test('summary folding packages a fresh backend separately without changing prior artifacts or identity', () => {
  const plan = require('../custom/build-veneta-summary.cjs').buildPlan();
  assert.ok(plan[0].args.includes('.local/veneta-summary-folding/backend'));
  assert.ok(plan[2].args.includes('electron-builder.veneta-summary.cjs'));
  const config = require('./electron-builder.veneta-summary.cjs');
  assert.equal(config.appId, 'local.memoa.test');
  assert.equal(config.directories.output, '../.local/veneta-summary-folding');
  assert.ok(config.extraResources.some(r => r.from === '../.local/veneta-summary-folding/backend/stenoai'));
  assert.ok(!config.extraResources.some(r => r.from.includes('veneta-product-modules/backend')));
});
