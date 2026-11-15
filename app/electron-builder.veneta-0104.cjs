'use strict';
// Separate 0.10.4 test package; never overwrite the earlier 0.10.3 build.
const base = require('./electron-builder.veneta-0103.cjs');
module.exports = {
  ...base,
  directories: { ...base.directories, output: '../.local/veneta-0.10.4' },
  extraResources: base.extraResources.map((resource) => resource.from === '../.local/veneta-0.10.3/backend/stenoai'
    ? { ...resource, from: '../.local/veneta-0.10.4/backend/stenoai' } : resource),
};
