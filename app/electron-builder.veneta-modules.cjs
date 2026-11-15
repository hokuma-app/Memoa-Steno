'use strict';
// New module packages never replace the phase-1 artifact or reuse its older Python backend.
const base = require('./electron-builder.veneta.cjs');
module.exports = {
  ...base,
  directories: { ...base.directories, output: '../.local/veneta-product-modules' },
  extraResources: base.extraResources.map((resource) => resource.from === '../.local/backend-memoa-r2/stenoai'
    ? { ...resource, from: '../.local/veneta-product-modules/backend/stenoai' } : resource),
};
