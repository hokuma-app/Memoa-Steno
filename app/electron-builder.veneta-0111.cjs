'use strict';
// Separate 0.11.1 test package; keep earlier candidates untouched.
const base = require('./electron-builder.veneta-0107.cjs');
module.exports = {
  ...base,
  directories: { ...base.directories, output: '../.local/veneta-0.11.1' },
  extraResources: base.extraResources.map((resource) => resource.from === '../.local/veneta-0.10.7/backend/stenoai'
    ? { ...resource, from: '../.local/veneta-0.11.1/backend/stenoai' } : resource),
};
