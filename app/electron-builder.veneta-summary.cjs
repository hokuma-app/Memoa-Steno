'use strict';
const base = require('./electron-builder.veneta-modules.cjs');
module.exports = {
  ...base,
  directories: { ...base.directories, output: '../.local/veneta-summary-folding' },
  extraResources: base.extraResources.map(resource => resource.from === '../.local/veneta-product-modules/backend/stenoai'
    ? { ...resource, from: '../.local/veneta-summary-folding/backend/stenoai' } : resource),
};
