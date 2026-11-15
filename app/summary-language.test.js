'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SUMMARY_LANGUAGE_DEFAULT_ENV, applySummaryLanguageDefault, recommendedSummaryLanguage } = require('./summary-language');

test('only the Veneta build recommends Dutch summaries', () => {
  assert.equal(recommendedSummaryLanguage({ venetaMemoAi: true }), 'nl');
  for (const metadata of [{}, { venetaMemoAi: 'true' }, null]) assert.equal(recommendedSummaryLanguage(metadata), null);
});

test('the recommendation is an environment default, never a config write, and an operator value wins', () => {
  const veneta = {};
  assert.equal(applySummaryLanguageDefault(veneta, { venetaMemoAi: true }), 'nl');
  assert.deepEqual(veneta, { [SUMMARY_LANGUAGE_DEFAULT_ENV]: 'nl' });
  const legacy = {};
  assert.equal(applySummaryLanguageDefault(legacy, {}), null);
  assert.deepEqual(legacy, {});
  const pinned = { [SUMMARY_LANGUAGE_DEFAULT_ENV]: 'en' };
  assert.equal(applySummaryLanguageDefault(pinned, { venetaMemoAi: true }), 'en');
});

test('the env name matches what src/config.py reads', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'config.py'), 'utf8');
  assert.match(source, new RegExp(`SUMMARY_LANGUAGE_DEFAULT_ENV = "${SUMMARY_LANGUAGE_DEFAULT_ENV}"`));
});
