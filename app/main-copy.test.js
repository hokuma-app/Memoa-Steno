'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EN, NL, createMainText, createMenuRoles, isVenetaBuild } = require('./main-copy');
const { buildNoteReadyNotificationOptions, buildTranscriptReadyBody, buildCaptureErrorBody } = require('./notification-copy');
const { describeUpdateError } = require('./update-error-copy');

const placeholders = (value) => [...value.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((match) => match[1]).sort();
const dutch = createMainText(true);
const english = createMainText(false);

test('every main-process English key has a Dutch translation with the same parameters', () => {
  assert.deepEqual(Object.keys(EN).filter((key) => !(key in NL)), []);
  assert.deepEqual(Object.keys(NL).filter((key) => !(key in EN)), []);
  for (const key of Object.keys(EN)) {
    assert.deepEqual(placeholders(NL[key]), placeholders(EN[key]), key);
    assert.ok(NL[key].trim(), key);
  }
});

test('Dutch main-process copy never names the upstream app as the product', () => {
  for (const [key, value] of Object.entries(NL)) {
    assert.doesNotMatch(value, /\bStenoAI\b|\bSteno\b/, key);
  }
});

test('only strict Veneta metadata selects Dutch', () => {
  assert.equal(isVenetaBuild({ venetaMemoAi: true }), true);
  for (const metadata of [{}, { venetaMemoAi: 'true' }, { venetaMemoAi: 1 }, null, undefined]) {
    assert.equal(isVenetaBuild(metadata), false);
  }
  assert.equal(english('tray.open'), 'Open StenoAI');
  assert.equal(dutch('tray.open'), 'Veneta MemoAi openen');
  assert.throws(() => english('tray.unknown'), /Unknown main-process copy key/);
});

test('notifications are Dutch in the Veneta build', () => {
  assert.deepEqual(buildNoteReadyNotificationOptions({ title: 'Weekstart' }, dutch), {
    title: 'Notitie klaar', body: 'Weekstart', iconType: 'success', outcome: 'success',
  });
  assert.equal(buildNoteReadyNotificationOptions({ hardFailure: true, title: 'Weekstart' }, dutch).body,
    'Veneta MemoAi kon "Weekstart" niet verwerken.');
  assert.equal(buildNoteReadyNotificationOptions({ failed: true }, dutch).title, 'Transcriptie mislukt');
  assert.equal(buildTranscriptReadyBody('Weekstart', dutch), '"Weekstart" samenvatten?');
  assert.equal(buildCaptureErrorBody({ name: 'NotAllowedError', platform: 'darwin' }, dutch),
    'Veneta MemoAi heeft geen toestemming om de microfoon te gebruiken, dus de opname is niet gestart. Geef toegang via Systeeminstellingen > Privacy en beveiliging > Microfoon.');
  assert.equal(buildCaptureErrorBody({ name: 'NotAllowedError', platform: 'linux' }, dutch),
    'Veneta MemoAi heeft geen toestemming om de microfoon te gebruiken, dus de opname is niet gestart.');
});

test('updater messages are Dutch in the Veneta build and keep their stickiness', () => {
  assert.deepEqual(describeUpdateError('EACCES: permission denied', { phase: 'install', platform: 'darwin' }, dutch), {
    message: "Veneta MemoAi heeft geen toestemming om de update te installeren. Zet Veneta MemoAi in je map Programma's.",
    sticky: true,
  });
  assert.equal(describeUpdateError('ENOSPC', {}, dutch).message, 'Er is niet genoeg schijfruimte om de update te downloaden.');
  assert.deepEqual(describeUpdateError('ENOSPC', {}, english), describeUpdateError('ENOSPC', {}));
});

test('default menu roles stay bare; Veneta roles carry Dutch labels', () => {
  const legacy = createMenuRoles(false);
  assert.deepEqual(legacy.item('quit'), { role: 'quit' });
  assert.deepEqual(legacy.editMenu, { role: 'editMenu' });
  assert.equal(legacy.helpLabel, undefined);
  const veneta = createMenuRoles(true);
  assert.deepEqual(veneta.item('quit'), { role: 'quit', label: 'Stop Veneta MemoAi' });
  for (const menu of [veneta.fileMenu, veneta.editMenu, veneta.viewMenu, veneta.windowMenu]) {
    for (const item of menu.submenu) assert.ok(item.type === 'separator' || item.label, JSON.stringify(item));
  }
});
