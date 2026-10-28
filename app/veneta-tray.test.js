'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

// Decode real non-interlaced 8-bit RGBA PNG pixels without Electron or installs.
function readPng(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  assert.equal(bytes[24], 8);
  assert.equal(bytes[25], 6, 'RGBA alpha channel');
  assert.equal(bytes[28], 0, 'non-interlaced');
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  const data = zlib.inflateSync(Buffer.concat(chunks));
  const pixels = Buffer.alloc(width * height * 4);
  const stride = width * 4;
  for (let y = 0; y < height; y++) {
    const filter = data[y * (stride + 1)];
    assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const a = x >= 4 ? pixels[i - 4] : 0;
      const b = y ? pixels[i - stride] : 0;
      const c = x >= 4 && y ? pixels[i - stride - 4] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = [0, a, b, Math.floor((a + b) / 2), pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      pixels[i] = (data[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  return { width, height, pixels };
}

for (const scale of [1, 2]) {
  test(`real Veneta PNGs retain alpha, black V, yellow tile and recording-only red badge at ${scale}x`, () => {
    const suffix = scale === 2 ? '@2x' : '';
    const normal = readPng(path.join(__dirname, 'assets', `trayIconVeneta${suffix}.png`));
    const recording = readPng(path.join(__dirname, 'assets', `trayIconVenetaRecording${suffix}.png`));
    for (const image of [normal, recording]) {
      assert.equal(image.width, 18 * scale);
      assert.equal(image.height, 18 * scale);
      let transparent = 0, yellow = 0, black = 0, red = 0;
      for (let i = 0; i < image.pixels.length; i += 4) {
        const [r, g, b, a] = image.pixels.subarray(i, i + 4);
        if (a === 0) transparent++;
        if (a === 255 && r === 255 && g === 217 && b === 0) yellow++;
        if (a === 255 && r < 10 && g < 10 && b < 10) black++;
        if (a === 255 && r > 180 && g < 80 && b < 80) red++;
      }
      assert.ok(transparent > 0, 'transparent outside tile');
      assert.ok(yellow > 30 * scale * scale, 'original #FFD900');
      assert.ok(black > 5 * scale * scale, 'original black V');
      assert.equal(red > 0, image === recording, 'distinct recording-only badge');
    }
    // Badge must not replace the original V: upper two thirds stay identical.
    assert.deepEqual(recording.pixels.subarray(0, recording.width * 4 * 11 * scale),
      normal.pixels.subarray(0, normal.width * 4 * 11 * scale));
  });
}

test('both scales ship through the existing assets filter with Electron @2x sibling naming', () => {
  const resource = require('./electron-builder.veneta.cjs').extraResources.find(item => item.from === 'assets');
  assert.ok(resource);
  assert.equal(resource.to, 'assets');
  assert.ok(resource.filter.includes('trayIcon*.png'));
  for (const stem of ['trayIconVeneta', 'trayIconVenetaRecording']) {
    for (const suffix of ['', '@2x']) assert.ok(fs.existsSync(path.join(__dirname, 'assets', `${stem}${suffix}.png`)));
  }
});

function productionTray(metadata, isPackaged = false) {
  const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const start = source.indexOf('function getTrayIconPath(');
  const end = source.indexOf('function showAndFocusWindow(', start);
  assert.ok(start >= 0 && end > start);
  const images = [];
  const context = vm.createContext({
    app: { isPackaged }, path, __dirname,
    process: { platform: 'darwin', resourcesPath: '/isolated/resources' },
    require(id) { assert.equal(id, './package.json'); return metadata; },
    nativeImage: { createFromPath(file) {
      const image = { file, template: undefined, setTemplateImage(value) { this.template = value; } };
      images.push(image);
      return image;
    } },
    Tray: class {
      constructor(image) { this.image = image; }
      setImage(image) { this.image = image; }
      setToolTip(value) { this.tooltip = value; }
    },
    tray: null, updateTrayMenu() {},
  });
  vm.runInContext(source.slice(start, end), context);
  return { context, images };
}

for (const packaged of [false, true]) {
  test(`production tray selects Veneta normal/recording assets (${packaged ? 'packaged' : 'dev'})`, () => {
    const { context } = productionTray({ venetaMemoAi: true }, packaged);
    const root = packaged ? '/isolated/resources' : __dirname;
    assert.equal(context.getTrayIconPath(false), path.join(root, 'assets', 'trayIconVeneta.png'));
    assert.equal(context.getTrayIconPath(true), path.join(root, 'assets', 'trayIconVenetaRecording.png'));
  });
}

test('strict Veneta metadata keeps original colors in actual create and update functions', () => {
  const { context, images } = productionTray({ venetaMemoAi: true });
  context.createTray();
  context.updateTrayIcon(true);
  context.updateTrayIcon(false);
  assert.deepEqual(images.map(image => image.template), [false, false, false]);
  assert.deepEqual(images.map(image => path.basename(image.file)),
    ['trayIconVeneta.png', 'trayIconVenetaRecording.png', 'trayIconVeneta.png']);
});

test('non-boolean/missing Veneta flags retain legacy paths and template behavior', () => {
  for (const value of [undefined, false, 'true', 'false', 1, null]) {
    for (const packaged of [false, true]) {
      const { context, images } = productionTray({ venetaMemoAi: value }, packaged);
      const root = packaged ? '/isolated/resources' : __dirname;
      assert.equal(context.getTrayIconPath(false), path.join(root, 'assets', 'trayIconTemplate.png'));
      assert.equal(context.getTrayIconPath(true), path.join(root, 'assets', 'trayIconRecordingTemplate.png'));
      context.createTray();
      context.updateTrayIcon(true);
      context.updateTrayIcon(false);
      assert.deepEqual(images.map(image => image.template), [true, true, true]);
    }
  }
});

test('update without an existing tray creates no native image', () => {
  const { context, images } = productionTray({ venetaMemoAi: true });
  context.updateTrayIcon(true);
  assert.equal(images.length, 0);
});
