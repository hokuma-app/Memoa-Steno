'use strict';
// Diagnostic build of 0.10.0 (own output folder; the replaced .local/veneta-0.10.0 stays untouched).
const base = require('./electron-builder.veneta-0100.cjs');
module.exports = {
  ...base,
  directories: { ...base.directories, output: '../.local/veneta-0.10.0-diag-2' },
  extraResources: base.extraResources.map(resource => resource.from === '../.local/veneta-0.10.0/backend/stenoai'
    ? { ...resource, from: '../.local/veneta-0.10.0-diag-2/backend/stenoai' } : resource),
};
