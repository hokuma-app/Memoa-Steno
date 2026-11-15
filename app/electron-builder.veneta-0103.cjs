'use strict';
// Independent 0.10.3 test package: retain the 0.10.2 identity and data root, but never overwrite its build.
const base = require('./electron-builder.veneta-summary.cjs');
module.exports = {
  ...base,
  directories: { ...base.directories, output: '../.local/veneta-0.10.3' },
  extraResources: base.extraResources.map((resource) => resource.from === '../.local/veneta-summary-folding/backend/stenoai'
    ? { ...resource, from: '../.local/veneta-0.10.3/backend/stenoai' } : resource),
};
