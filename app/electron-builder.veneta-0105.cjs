'use strict';
// Separate 0.10.5 test package; never overwrite the prior 0.10.4 candidate.
const base = require('./electron-builder.veneta-0104.cjs');
module.exports = {
  ...base,
  directories: { ...base.directories, output: '../.local/veneta-0.10.5' },
  extraResources: base.extraResources.map((resource) => resource.from === '../.local/veneta-0.10.4/backend/stenoai'
    ? { ...resource, from: '../.local/veneta-0.10.5/backend/stenoai' } : resource),
};