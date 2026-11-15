import { t } from '@/i18n';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LANGUAGES_WHISPER } from '@/routes/settings/languages';

// One meeting's language. "auto" here means "use the Settings default", so
// the global choice stays the single source for every other meeting.
const OPTIONS = LANGUAGES_WHISPER.map((l) =>
  l.value === 'auto' ? { value: 'auto', label: t('meetingLanguageSelect.defaultSettings') } : l,
);

export function MeetingLanguageSelect({
  value,
  onChange,
  disabled,
  testId = 'meeting-language-select',
}: {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-8 w-[200px] text-[13px]" data-testid={testId} aria-label={t('meetingLanguageSelect.meeting_language')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map((l) => (
          <SelectItem key={l.value} value={l.value}>
            {l.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
