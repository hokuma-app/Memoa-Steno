'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Read-only Veneta standard checklists shipped inside the app bundle. The files are data, never code:
// each one is validated with the same limits as user criteria (max 32 points, 24000 characters)
// and offered as a locked template. A file with no criteria yet is listed but cannot be chosen,
// so Veneta can deliver the real content with an update of that JSON file alone.
const MAX_FILES = 8;
const MAX_BYTES = 262144;
const MAX_CRITERIA = 32;
const MAX_CHARACTERS = 24000;
const ID = /^[a-zA-Z0-9-]{1,128}$/;
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const onlyKeys = (value, keys) => plain(value) && Object.keys(value).every((key) => keys.includes(key))
  && keys.every((key) => Object.hasOwn(value, key));

/** Same normalisation everywhere a name is compared, so "adviseur  GESPREK" is the standard's name too. */
const normalizeName = (name) => String(name).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

function validateStandard(value) {
  if (!onlyKeys(value, ['id', 'name', 'version', 'locked', 'criteria']) || value.locked !== true ||
      typeof value.id !== 'string' || !ID.test(value.id) || FORBIDDEN_IDS.has(value.id) ||
      typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120 ||
      !Number.isInteger(value.version) || value.version < 1 || !Array.isArray(value.criteria) || value.criteria.length > MAX_CRITERIA) {
    throw new Error('Ongeldige standaardchecklist.');
  }
  const ids = new Set(); let characters = 0;
  const criteria = value.criteria.map((item) => {
    if (!onlyKeys(item, ['id', 'label', 'required']) || typeof item.id !== 'string' || !item.id || item.id.length > 128 ||
        FORBIDDEN_IDS.has(item.id) || ids.has(item.id) || typeof item.label !== 'string' || !item.label.trim() ||
        typeof item.required !== 'boolean') throw new Error('Ongeldig standaardpunt.');
    ids.add(item.id); characters += item.label.length;
    return { id: item.id, label: item.label, required: item.required };
  });
  if (characters > MAX_CHARACTERS) throw new Error('Te veel standaardtekst.');
  return { id: value.id, name: value.name, version: value.version, locked: true, criteria, available: criteria.length > 0 };
}

function loadStandardChecklists(directory) {
  const standards = []; const invalid = [];
  let names;
  try {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return { standards, invalid: [path.basename(directory)] };
    names = fs.readdirSync(directory).filter((name) => name.endsWith('.json')).sort().slice(0, MAX_FILES);
  } catch (error) {
    if (error.code === 'ENOENT') return { standards, invalid };
    throw error;
  }
  const ids = new Set(); const seenNames = new Set();
  for (const name of names) {
    try {
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new Error('Onveilig bestand.');
      const standard = validateStandard(JSON.parse(fs.readFileSync(file, 'utf8')));
      const key = normalizeName(standard.name);
      if (ids.has(standard.id) || seenNames.has(key)) throw new Error('Dubbele standaard.');
      ids.add(standard.id); seenNames.add(key);
      standards.push(standard);
    } catch (_) { invalid.push(name); }
  }
  return { standards, invalid };
}

module.exports = { loadStandardChecklists, validateStandard, normalizeName };
