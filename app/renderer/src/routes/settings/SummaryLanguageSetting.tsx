import { useSetSummaryLanguage, useSummaryLanguageSetting } from '@/hooks/useSettings';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t } from '@/i18n';
import { COMPACT_TRIGGER, SettingRow } from './primitives';
import { LANGUAGES_WHISPER, type LangOption } from './languages';

/** The choices for the summary language: "auto" follows the meeting's
 *  language (the behaviour before this setting existed), the rest pin one. */
export function summaryLanguageOptions(): LangOption[] {
  return LANGUAGES_WHISPER.map((option) =>
    option.value === 'auto' ? { value: 'auto', label: t('settingsSummaryLanguage.auto') } : option,
  );
}

/** Settings row for the language new summaries, titles and reports are
 *  written in. Separate from the interface language and the transcription
 *  language; only future summaries use it. */
export function SummaryLanguageSetting() {
  const setting = useSummaryLanguageSetting();
  const setLanguage = useSetSummaryLanguage();
  const options = summaryLanguageOptions();
  const persisted = setting.data?.summary_language ?? 'auto';
  const value = options.some((option) => option.value === persisted) ? persisted : 'auto';
  return (
    <SettingRow
      label={t('settingsSummaryLanguage.label')}
      description={t('settingsSummaryLanguage.description')}
    >
      <Select value={value} onValueChange={(next) => setLanguage.mutate(next)} disabled={!setting.data}>
        <SelectTrigger className={COMPACT_TRIGGER} data-testid="summary-language-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}
