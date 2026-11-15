'use strict';
// Separate 0.10.6 test package; keep earlier candidates untouched.
const base = require('./electron-builder.veneta-0105.cjs');
module.exports = {
  ...base,
  directories: { ...base.directories, output: '../.local/veneta-0.10.6' },
  extraResources: base.extraResources.map((resource) => resource.from === '../.local/veneta-0.10.5/backend/stenoai'
    ? { ...resource, from: '../.local/veneta-0.10.6/backend/stenoai' } : resource),
};
