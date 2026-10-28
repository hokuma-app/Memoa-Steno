'use strict';

// Opt in with --config electron-builder.memoa.cjs. Never change production's
// package identity, backend resources, entitlements or existing afterPack hook.
const build = require('./package.json').build;

module.exports = {
  ...build,
  appId: 'local.memoa.test',
  productName: 'Memoa Test',
  extraMetadata: { ...build.extraMetadata, name: 'memoa-test', memoaTest: true },
  directories: { ...build.directories, output: 'dist-memoa' },
  files: [...build.files, '!dist-memoa/**/*'],
  // Do not claim Steno's shortcut protocol or meeting document association.
  protocols: [],
  publish: null,
  forceCodeSigning: true,
  mac: {
    ...build.mac,
    target: [{ target: 'dir', arch: ['arm64'] }],
    fileAssociations: [],
    identity: 'Memoa Test Local Signing',
    notarize: false,
    timestamp: 'none',
  },
};
