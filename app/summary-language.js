'use strict';

// Recommended summary language per product build.
//
// The summary language is its own setting (config key `summary_language`, see
// src/config.py get_summary_language), separate from the interface language
// and from the transcription language. The Veneta build recommends Dutch for
// users who have never chosen one; the default build recommends nothing and so
// keeps writing in the meeting's language.
//
// The recommendation reaches Python as an environment default that config.py
// reads ONLY while the user's config has no `summary_language` key. Nothing is
// written to disk here, so an explicit choice (including "auto") is never
// overwritten and existing notes are never regenerated.

const SUMMARY_LANGUAGE_DEFAULT_ENV = 'STENOAI_SUMMARY_LANGUAGE_DEFAULT';

function recommendedSummaryLanguage(metadata) {
  return metadata && metadata.venetaMemoAi === true ? 'nl' : null;
}

// Set once at startup on the main process environment, which every backend
// spawn inherits (getBackendEnv and backend-cli copy process.env). An
// operator-provided value wins so a test or a managed install can override it.
function applySummaryLanguageDefault(env, metadata) {
  const recommended = recommendedSummaryLanguage(metadata);
  if (recommended && !env[SUMMARY_LANGUAGE_DEFAULT_ENV]) env[SUMMARY_LANGUAGE_DEFAULT_ENV] = recommended;
  return env[SUMMARY_LANGUAGE_DEFAULT_ENV] || null;
}

module.exports = { SUMMARY_LANGUAGE_DEFAULT_ENV, applySummaryLanguageDefault, recommendedSummaryLanguage };
