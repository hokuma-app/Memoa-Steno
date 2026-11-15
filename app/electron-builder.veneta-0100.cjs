'use strict';
const base = require('./electron-builder.veneta-summary.cjs');
module.exports = {
  ...base,
  directories: { ...base.directories, output: '../.local/veneta-0.10.0' },
  extraResources: base.extraResources.map(resource => resource.from === '../.local/veneta-summary-folding/backend/stenoai'
    ? { ...resource, from: '../.local/veneta-0.10.0/backend/stenoai' } : resource),
};
