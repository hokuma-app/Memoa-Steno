'use strict';

// Opt-in Veneta presentation. Keep the working Memoa test identity and storage.
const base = require('./electron-builder.memoa.cjs');
module.exports = {
  ...base,
  productName: 'Veneta MemoAi',
  extraMetadata: { ...base.extraMetadata, name: 'veneta-memoai', venetaMemoAi: true },
  directories: { ...base.directories, output: '../.local/veneta-interface' },
  files: [...base.files, '!dist-memoa*/**/*', '!dist-veneta*/**/*'],
  extraResources: base.extraResources.map((resource) => resource.from === '../dist/stenoai'
    ? { ...resource, from: '../.local/backend-memoa-r2/stenoai' } : resource),
  mac: {
    ...base.mac,
    icon: 'veneta-assets/app-icon.icns',
    extendInfo: {
      ...base.mac.extendInfo,
      NSMicrophoneUsageDescription: 'Veneta MemoAi gebruikt je microfoon om gesprekken op te nemen en te transcriberen.',
      NSAudioCaptureUsageDescription: 'Veneta MemoAi gebruikt systeemaudio om online gesprekken vast te leggen.',
      NSCalendarsFullAccessUsageDescription: 'Veneta MemoAi gebruikt je agenda om gesprekken te benoemen en deelnemers voor te stellen.',
      NSCalendarsUsageDescription: 'Veneta MemoAi gebruikt je agenda om gesprekken te benoemen en deelnemers voor te stellen.',
      NSLocalNetworkUsageDescription: 'Veneta MemoAi gebruikt het lokale netwerk voor AI-diensten die je zelf configureert.',
    },
  },
};
