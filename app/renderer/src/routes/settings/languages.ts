import { PARAKEET_LANGUAGE_CODES } from '@/lib/transcription-languages';
import { t } from '@/i18n';

export type LangOption = { value: string; label: string };

// Curated language list shown in Settings → Transcribe. Whisper supports
// all 14 (it covers 99 languages at the model level; the dropdown is just
// the tested curation). Chinese is split into Simplified (zh-Hans) and
// Traditional (zh-Hant): whisper.cpp always emits Simplified, so Traditional
// is a post-transcription OpenCC conversion (see src/chinese.py) — both map
// to whisper's "zh" for the actual ASR call.
export const LANGUAGES_WHISPER: LangOption[] = [
  { value: 'auto', label: t('settingsLanguages.autoDetect') },
  { value: 'en', label: t('settingsLanguages.english') },
  { value: 'es', label: t('settingsLanguages.spanish') },
  { value: 'fr', label: t('settingsLanguages.french') },
  { value: 'de', label: t('settingsLanguages.german') },
  { value: 'nl', label: t('settingsLanguages.dutch') },
  { value: 'pt', label: t('settingsLanguages.portuguese') },
  { value: 'ru', label: t('settingsLanguages.russian') },
  { value: 'ja', label: t('settingsLanguages.japanese') },
  { value: 'zh-Hans', label: t('settingsLanguages.chineseSimplified') },
  { value: 'zh-Hant', label: t('settingsLanguages.chineseTraditional') },
  { value: 'ko', label: t('settingsLanguages.korean') },
  { value: 'hi', label: t('settingsLanguages.hindi') },
  { value: 'ar', label: t('settingsLanguages.arabic') },
];
// Parakeet exposes the European subset (see transcription-languages.ts for
// why pinning matters even though the decoder is language-agnostic). Derived
// from the Whisper list so labels stay identical and the picker can't drift
// from the shared code set.
export const LANGUAGES_PARAKEET: LangOption[] = LANGUAGES_WHISPER.filter((l) =>
  PARAKEET_LANGUAGE_CODES.has(l.value),
);
