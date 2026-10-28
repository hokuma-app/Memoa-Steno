import { IS_VENETA_MEMOAI } from '@/lib/productBrand';

import { t } from '@/i18n';
import * as React from 'react';
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  ChevronLeft,
  Clock,
  FolderPlus,
  Mic,
  PencilLine,
  Volume2,
  X,
} from 'lucide-react';
import { MeetingsShell } from '@/components/MeetingsShell';
import { MeetingLanguageSelect } from '@/components/MeetingLanguageSelect';
import { ipc } from '@/lib/ipc';
import { useNavigate } from '@/lib/router';
import { useRecording } from '@/hooks/useRecording';
import { useLiveMeeting } from '@/hooks/useLiveMeeting';
import { UI_LOCALE } from '@/lib/locale';
import { isLiveRowStatus } from '@/lib/liveMeetingRow';
import { useCaptureCheckStore } from '@/hooks/captureCheckStore';
import { captureWarnings, type ChannelCheck } from '@/lib/captureCheck';

export function Recording() {
  const navigate = useNavigate();
  const recording = useRecording();
  const live = useLiveMeeting();

  // If we land on /recording with no active recording (e.g. cold reload after
  // it stopped), bounce back home so we don't leave the user on a dead page.
  // We only bounce when the session is genuinely gone: a recording/paused
  // status means one is active or just starting (via "Take Notes" from another
  // route, whose ~2s Parakeet warm-up leaves live.active briefly false) — never
  // bounce that, or the user gets kicked off the page they just opened and it
  // reads as a no-op needing a second tap. Status 'processing' is handled by
  // the global listener which redirects to /meetings/processing.
  //
  // 500ms grace period: during a normal stop, the optimistic cache write
  // briefly transitions status (idle ↔ processing) and live.active flips off
  // BEFORE navigate('/meetings/processing') completes its render. Without the
  // delay this effect raced the optimistic flow and bounced the user back
  // home — visible most reliably when the user had been typing notes (queue
  // poll cadence + cache updates landed in a different order). The delay
  // lets the transition settle before we make any bouncing decision.
  //
  // isLiveRowStatus is shared with the meetings list's live row, so the row that
  // sends the user here and this page can never disagree about whether a
  // session runs — they used to, and the row won.
  const hasSession = live.active || isLiveRowStatus(recording.status);
  React.useEffect(() => {
    if (recording.isLoading) return;
    if (hasSession) return;
    const t = setTimeout(() => {
      if (!recording.isLoading && !hasSession) {
        navigate('/');
      }
    }, 500);
    return () => clearTimeout(t);
  }, [recording.isLoading, hasSession, navigate]);

  const startedAt = live.startedAt ?? new Date();

  // Language for this meeting only; applied when the recording is processed.
  const [language, setLanguage] = React.useState('auto');
  React.useEffect(() => {
    void ipc().recording.getLanguage().then((res) => {
      if (res.success) setLanguage(res.language);
    });
  }, []);
  const chooseLanguage = (code: string) => {
    setLanguage(code);
    void ipc().recording.setLanguage(code);
  };

  return (
    <MeetingsShell activeSummaryFile={null} hideToolbar>
      <div
        data-testid="recording-page"
        className={`flex h-full min-h-0 flex-1 flex-col overflow-hidden${IS_VENETA_MEMOAI ? ' veneta-recording-layout' : ''}`}
        style={{ background: 'var(--page)' }}
      >
        <div className="veneta-recording-notes scrollbar-clean min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[760px] px-12 pb-40 pt-8">
            <header className="mb-8">
              <button
                type="button"
                onClick={() => navigate('/')}
                className="mb-6 inline-flex cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-2 py-1 text-[13px] transition-colors hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--fg-1)]"
                style={{ color: 'var(--fg-2)' }}
                aria-label="Back to home"
              >
                <ChevronLeft size={15} />
                Home
              </button>

              <EditableTitle
                value={live.title}
                onChange={live.setTitle}
                placeholder="New note"
              />

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Chip icon={<CalendarIcon size={11} />}>
                  {formatDate(startedAt)}
                </Chip>
                <Chip icon={<Clock size={11} />}>
                  Started {formatTime(startedAt)}
                </Chip>
                <Chip icon={<FolderPlus size={11} />} dashed>
                  Add to folder
                </Chip>
                <MeetingLanguageSelect
                  value={language}
                  onChange={chooseLanguage}
                  testId="recording-language-select"
                />
              </div>
            </header>

            <CaptureCheckPanel />

            <section>
              {IS_VENETA_MEMOAI ? (
                <h2 id="veneta-notes-heading" className="mb-3 flex items-center gap-2 text-[18px] font-semibold">
                  <PencilLine size={16} aria-hidden="true" />{t('recording.notesHeading')}
                </h2>
              ) : <div
                className="mb-2 inline-flex items-center gap-1.5 text-[13px]"
                style={{ color: 'var(--fg-2)' }}
              >
                <PencilLine size={13} />
                My notes
              </div>}
              <textarea
                aria-labelledby={IS_VENETA_MEMOAI ? 'veneta-notes-heading' : undefined}
                value={live.notes}
                onChange={(e) => live.setNotes(e.target.value)}
                placeholder={t('recording.notesPlaceholder')}
                spellCheck
                className="block w-full resize-none border-0 bg-transparent text-[15px] outline-none"
                style={{
                  color: 'var(--fg-1)',
                  fontFamily: 'var(--font-sans)',
                  lineHeight: 1.6,
                  minHeight: 320,
                }}
              />
            </section>
          </div>
        </div>
        {IS_VENETA_MEMOAI && <aside id="veneta-live-transcript-slot" aria-label={t('recording.transcriptHeading')} />}
      </div>
    </MeetingsShell>
  );
}

const CAPTURE_WARNING_COPY = {
  'mic-flat':
    'No sound from your microphone. Check the microphone chosen in Settings and that StenoAI may use it (System Settings → Privacy & Security → Microphone).',
  'system-unavailable':
    'System audio is not being recorded, only your microphone. Allow StenoAI under System Settings → Privacy & Security → Screen & System Audio Recording, then start a new recording.',
} as const;

/**
 * Pre-flight capture check (first 20 s): a level meter per channel, then a
 * warning for a silent microphone or a failed system-audio capture.
 * A silent but acquired system channel is normal for in-person meetings. Fed by useSystemAudioCapture through captureCheckStore.
 */
function CaptureCheckPanel() {
  const state = useCaptureCheckStore((s) => s.state);
  const dismissed = useCaptureCheckStore((s) => s.dismissed);
  const dismiss = useCaptureCheckStore((s) => s.dismiss);
  if (!state) return null;
  const warnings = dismissed ? [] : captureWarnings(state);
  if (!state.checking && warnings.length === 0) return null;
  return (
    <div className="-mt-4 mb-6 space-y-2" data-testid="capture-check">
      {state.checking && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px]" style={{ color: 'var(--fg-2)' }}>
          <span style={{ color: 'var(--fg-muted)' }}>{t('recording.checking_audio')}</span>
          <LevelMeter icon={<Mic size={12} />} label={t('recording.microphone')} channel={state.mic} />
          <LevelMeter icon={<Volume2 size={12} />} label={t('recording.system_audio')} channel={state.system} />
        </div>
      )}
      {warnings.length > 0 && (
        <div
          role="alert"
          data-testid="capture-check-warning"
          className="flex items-start gap-2 rounded-md px-3 py-2 text-[13px] leading-[1.45]"
          style={{
            color: 'var(--fg-1)',
            background: 'var(--surface-raised)',
            border: '1px solid var(--danger, #b42318)',
          }}
        >
          <AlertTriangle size={14} className="mt-[3px] shrink-0" style={{ color: 'var(--danger, #b42318)' }} />
          <div className="flex-1 space-y-1">
            {warnings.map((w) => (
              <p key={w}>{CAPTURE_WARNING_COPY[w]}</p>
            ))}
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t('recording.dismiss_audio_warning')}
            className="cursor-pointer rounded border-0 bg-transparent p-0.5 hover:bg-[color:var(--surface-hover)]"
            style={{ color: 'var(--fg-2)' }}
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

function LevelMeter({ icon, label, channel }: { icon: React.ReactNode; label: string; channel: ChannelCheck }) {
  const inactive = channel.status === 'off' || channel.status === 'unavailable';
  return (
    <span className="inline-flex items-center gap-1.5" data-testid={`capture-meter-${label === 'Microphone' ? 'mic' : 'system'}`}>
      {icon}
      {label}
      {inactive ? (
        <span style={{ color: 'var(--fg-muted)' }}>{channel.status === 'off' ? t('recording.off') : t('recording.not_captured')}</span>
      ) : (
        <span
          className="relative inline-block h-[5px] w-[72px] overflow-hidden rounded-full"
          style={{ background: 'var(--border-subtle)' }}
          role="meter"
          aria-label={t('recording.label_level', { label: label })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(channel.level * 100)}
        >
          <span
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${Math.round(channel.level * 100)}%`,
              background: channel.status === 'flat' ? 'var(--danger, #b42318)' : 'var(--fg-1)',
              transition: 'width 90ms linear',
            }}
          />
        </span>
      )}
    </span>
  );
}

interface EditableTitleProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}

function EditableTitle({ value, onChange, placeholder }: EditableTitleProps) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      className="w-full border-0 bg-transparent p-0 text-[34px] outline-none"
      style={{
        fontFamily: 'var(--font-serif)',
        letterSpacing: '-0.02em',
        color: 'var(--fg-1)',
        lineHeight: 1.15,
      }}
    />
  );
}

function Chip({
  icon,
  children,
  dashed = false,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  dashed?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px]"
      style={{
        color: 'var(--fg-2)',
        border: dashed
          ? '1px dashed var(--border-subtle)'
          : '1px solid var(--border-subtle)',
        background: dashed ? 'transparent' : 'var(--surface-raised)',
      }}
    >
      {icon}
      {children}
    </span>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(UI_LOCALE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatTime(d: Date): string {
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}
