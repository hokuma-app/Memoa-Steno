import * as React from 'react';
import { IS_VENETA_MEMOAI } from '@/lib/productBrand';
import { productText as productT } from '@/i18n/product';

import { Calendar, ChevronLeft, ChevronRight, Plus, RefreshCw, Search, Square, X } from 'lucide-react';
import { cn, isMac } from '@/lib/utils';
import { MeetingsShell } from '@/components/MeetingsShell';
import { UpcomingCard } from '@/components/home/UpcomingCard';
import { PreviousRow } from '@/components/home/PreviousRow';
import { AudioRow, type AudioAction } from '@/components/home/AudioRow';
import { Button } from '@/components/ui/button';
import { AppIcon } from '@/components/ui/app-icon';
import { KbdKey } from '@/components/ui/kbd';
import { useMeetings } from '@/hooks/useMeetings';
import { useWatchedFolderAction, useWatchedFolders } from '@/hooks/useWatchedFolders';
import { useBlobAudioPlayback } from '@/hooks/useBlobAudioPlayback';
import { useRecording } from '@/hooks/useRecording';
import {
  useCalendarEvents,
  useGoogleCalendarAuth,
  useOutlookCalendarAuth,
} from '@/hooks/useCalendarEvents';
import { useFolders } from '@/hooks/useFolders';
import { useRecordHotkeySetting } from '@/hooks/useSettings';
import { ipc, type CalendarEvent, type Meeting, type WatchedFile } from '@/lib/ipc';
import { unwrap } from '@/lib/result';
import { ChecklistChoiceCard } from '@/modules/conversation-checklist/ChecklistChoiceCard';
import { t } from '@/i18n';
import { pickInProgressEvent } from '@/lib/calendar';
import { heroHeadline, heroSubtitle } from '@/lib/hero';
import { searchNotes } from '@/lib/noteSearch';
import { navigate } from '@/lib/router';
import { UI_LOCALE } from '@/lib/locale';

const SHORT_MONTH: Intl.DateTimeFormatOptions = { month: 'short' };
const SHORT_WEEKDAY: Intl.DateTimeFormatOptions = { weekday: 'short' };

interface HomeProps {
  mode: 'home' | 'meetings';
}

export function Home({ mode }: HomeProps) {
  const welcomeText = IS_VENETA_MEMOAI ? productT('product.welcome') : t('home.welcomeToSteno');
  const meetings = useMeetings();
  const folders = useFolders();
  const calendar = useCalendarEvents();
  const recording = useRecording();
  // Default ON while loading / on error so the hero copy doesn't flicker the
  // ⌘⇧R hint off then on (back-compat: the shortcut ships enabled). Also
  // require registered !== false: when another app owns the accelerator the
  // shortcut doesn't actually work, so advertising it would strand the user
  // on dead instructions — fall back to the click-based copy instead.
  const recordHotkey = useRecordHotkeySetting();
  const hotkeyEnabled =
    (recordHotkey.data?.enabled ?? true) && recordHotkey.data?.registered !== false;

  // Audio from watched folders that is not a note yet sits in the same list
  // as the notes: waiting to be transcribed (or auto-transcribing, per the
  // folder's setting), syncing, processing or failed. A transcribed file is
  // its note, so it is not listed again; dismissed files fold away below.
  const watched = useWatchedFolders();
  const audioAction = useWatchedFolderAction();
  const audioPlayback = useBlobAudioPlayback(
    async (id: string) => unwrap(await ipc().watchedFolders.preview(id)).audioBase64,
  );
  const watchedFolderNames = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const f of watched.data?.folders ?? []) map.set(f.id, f.name);
    return map;
  }, [watched.data]);
  const autoFolderIds = React.useMemo(
    () => new Set((watched.data?.folders ?? []).filter((f) => f.autoTranscribe).map((f) => f.id)),
    [watched.data],
  );
  const { pendingAudio, dismissedAudio, newAudio, unavailableFolders } = React.useMemo(() => {
    const files = watched.data?.files ?? [];
    const pending = files.filter((f) => f.status !== 'done' && f.status !== 'dismissed');
    return {
      pendingAudio: pending,
      dismissedAudio: files.filter((f) => f.status === 'dismissed'),
      newAudio: pending.filter((f) => f.status === 'new'),
      unavailableFolders: (watched.data?.folders ?? []).filter((f) => !f.available),
    };
  }, [watched.data]);
  const [showDismissed, setShowDismissed] = React.useState(false);
  const runAudioAction = (type: AudioAction, ids: string[]) => audioAction.mutate({ type, ids });

  // Dismissed audio keeps the list up too: its toggle is the way to restore it.
  const emptyState = !meetings.data?.length && pendingAudio.length === 0 && dismissedAudio.length === 0;
  const isRecording = recording.status === 'recording' || recording.status === 'paused';
  // Empty-state CTA: start a new recording AND open the live-note editor
  // (/recording) so the user can write notes while it records; a previous note
  // keeps processing in the background queue. Coexistence still holds (the pill
  // follows on navigation) — the explicit action just lands them on the note.
  const onToggleRecording = () => {
    if (!isRecording) void recording.startRecording();
    navigate('/recording');
  };

  const folderName = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const f of folders.data ?? []) map.set(f.id, f.name);
    return map;
  }, [folders.data]);

  // 60-second tick so the upcoming filter below re-evaluates and
  // events whose end time has passed roll off the list without
  // waiting for the next calendar refetch (which could be many
  // minutes). Minute precision is plenty — events are minute-grained
  // at best. Gated on `mode === 'home'` so the timer doesn't run on
  // /meetings where this widget isn't rendered.
  const [upcomingTickMs, setUpcomingTickMs] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    if (mode !== 'home') return;
    // Refresh immediately on (re)entering Home, otherwise the hero copy
    // is whatever `upcomingTickMs` was when the user last navigated away
    // — potentially many minutes stale until the 60s interval fires.
    setUpcomingTickMs(Date.now());
    const id = setInterval(() => setUpcomingTickMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [mode]);

  // Landing on Home is a recording-intent signal — nudge main to re-warm the
  // Parakeet model so the first record isn't a cold load. Fire-and-forget;
  // main throttles + skips while recording, so calling on every Home entry is
  // safe.
  React.useEffect(() => {
    if (mode !== 'home') return;
    ipc().recording.hintWarmup();
  }, [mode]);

  // Today's relevant events: anything that overlaps with today AND
  // hasn't ended yet AND that the user is likely to attend. Includes
  // timed events for today and timed multi-day events (conference
  // sessions, calls spanning a day boundary) that started in the past
  // but are still ongoing — those are useful context the user might
  // want to glance at. All-day blocks (OOO, conference day) and declined
  // meetings are dropped — they crowd real meetings off the visible page.
  const upcomingToday = React.useMemo<CalendarEvent[]>(() => {
    if (!calendar.data || calendar.data.needsAuth) return [];
    // Use the tick as the time source so the memo is a pure function of
    // its deps (same inputs → same output) — rather than reading
    // Date.now() inside, which would leave upcomingTickMs as an
    // ostensibly-unused dep used only to trigger re-runs. 60s
    // staleness is well within tolerance for "has this event ended."
    const now = new Date(upcomingTickMs);
    const todayY = now.getFullYear();
    const todayM = now.getMonth();
    const todayD = now.getDate();
    // 00:00 tomorrow — events that start at or after this aren't "today."
    const startOfTomorrow = new Date(todayY, todayM, todayD + 1).getTime();
    const nowMs = now.getTime();
    return calendar.data.events
      .filter((e) => {
        const start = new Date(e.start).getTime();
        const end = new Date(e.end).getTime();
        if (Number.isNaN(start) || Number.isNaN(end)) return false;
        // Event must end after now (not in the past).
        if (end <= nowMs) return false;
        // Event must start before end-of-today (so it overlaps today).
        if (start >= startOfTomorrow) return false;
        // All-day blocks pose as 00:00 "meetings" and crowd out real ones.
        if (e.is_all_day === true) return false;
        // Declined: user said no — don't surface or auto-act on it.
        if (e.response_status === 'declined') return false;
        return true;
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }, [calendar.data, upcomingTickMs]);

  // First event of tomorrow that the user is likely to attend. Used for
  // the "Tomorrow peek" when today's carousel is empty — keeps the panel
  // useful at 6pm with a clear evening, instead of disappearing.
  const tomorrowPreview = React.useMemo<CalendarEvent | null>(() => {
    if (!calendar.data || calendar.data.needsAuth) return null;
    const now = new Date(upcomingTickMs);
    const startOfTomorrow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    ).getTime();
    const startOfDayAfter = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 2,
    ).getTime();
    const candidates = calendar.data.events
      .filter((e) => {
        const start = new Date(e.start).getTime();
        if (Number.isNaN(start)) return false;
        if (start < startOfTomorrow) return false;
        if (start >= startOfDayAfter) return false;
        if (e.is_all_day === true) return false;
        if (e.response_status === 'declined') return false;
        return true;
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    return candidates[0] || null;
  }, [calendar.data, upcomingTickMs]);

  // All-day events overlapping today that the user hasn't declined. Rendered
  // as a small clickable chip row so the user can see "OOO" / "Conference
  // Day" without these blocks crowding the timed carousel — and can click
  // a chip to record against that event's title.
  const allDayToday = React.useMemo<CalendarEvent[]>(() => {
    if (!calendar.data || calendar.data.needsAuth) return [];
    const now = new Date(upcomingTickMs);
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
    const startOfTomorrow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    ).getTime();
    return calendar.data.events.filter((e) => {
      if (e.is_all_day !== true) return false;
      if (e.response_status === 'declined') return false;
      const start = new Date(e.start).getTime();
      const end = new Date(e.end).getTime();
      if (Number.isNaN(start) || Number.isNaN(end)) return false;
      // Overlaps with today's local window.
      return start < startOfTomorrow && end > startOfToday;
    });
  }, [calendar.data, upcomingTickMs]);

  const [allDayExpanded, setAllDayExpanded] = React.useState(false);

  // Three meetings is the sweet spot — fits the visible card height without
  // crowding, matches Granola's pattern. Earlier-than-now events have
  // already been filtered out, so page 0 always shows "next up".
  const UPCOMING_PAGE_SIZE = 3;
  const upcomingPageCount = Math.max(
    1,
    Math.ceil(upcomingToday.length / UPCOMING_PAGE_SIZE),
  );
  const [upcomingPage, setUpcomingPage] = React.useState(0);
  // Clamp the page when the list shrinks underneath us — e.g. an event
  // ends and rolls off, or the user reloads the calendar with fewer
  // entries. Without this the user could be stuck on an empty page 3
  // after the count drops to 5.
  React.useEffect(() => {
    if (upcomingPage >= upcomingPageCount) {
      setUpcomingPage(Math.max(0, upcomingPageCount - 1));
    }
  }, [upcomingPage, upcomingPageCount]);
  const upcomingVisible = upcomingToday.slice(
    upcomingPage * UPCOMING_PAGE_SIZE,
    (upcomingPage + 1) * UPCOMING_PAGE_SIZE,
  );
  const canPagePrev = upcomingPage > 0;
  const canPageNext = upcomingPage < upcomingPageCount - 1;

  const previous = meetings.data ?? [];

  // Search applies only to /meetings (the All meetings list). Home keeps the
  // unfiltered Previous list since it's already chronologically grouped.
  const [search, setSearch] = React.useState('');
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const filtered = React.useMemo(() => {
    if (mode !== 'meetings') return previous;
    if (!search.trim()) return previous;
    return searchNotes(previous, search);
  }, [mode, previous, search]);
  const filteredAudio = React.useMemo(() => {
    const needle = mode === 'meetings' ? search.trim().toLowerCase() : '';
    if (!needle) return pendingAudio;
    return pendingAudio.filter((f) =>
      `${watchedFolderNames.get(f.folderId) ?? ''} ${f.relPath}`.toLowerCase().includes(needle));
  }, [mode, search, pendingAudio, watchedFolderNames]);
  const groups = React.useMemo(() => groupPrevious(filtered, filteredAudio), [filtered, filteredAudio]);

  // Calendar-connect nudge: most new users don't realise Steno can
  // surface their meetings until something tells them. Show a small
  // dismissible line on Home when calendar is unconnected; persist the
  // dismissal in localStorage so we don't nag the same person twice.
  const NUDGE_KEY = 'home.calendarNudge.dismissed';
  const [calendarNudgeDismissed, setCalendarNudgeDismissed] =
    React.useState<boolean>(() => {
      try {
        return localStorage.getItem(NUDGE_KEY) === 'true';
      } catch {
        return false;
      }
    });
  const showCalendarNudge =
    mode === 'home' &&
    calendar.data?.needsAuth === true &&
    !calendarNudgeDismissed;

  // Inline provider picker for the nudge. Collapsed by default — clicking
  // the message expands it to surface Google / Outlook buttons right
  // where the user is, so we don't make them hunt through Settings.
  const [calendarNudgeExpanded, setCalendarNudgeExpanded] =
    React.useState<boolean>(false);
  const googleAuth = useGoogleCalendarAuth();
  const outlookAuth = useOutlookCalendarAuth();

  // Which provider's OAuth handshake (if any) is currently in flight.
  // Tracks the most recently clicked provider so a Cancel after the user
  // somehow ended up with both pending hits the right one (defensive —
  // the UI normally swaps to the Cancel row on first click, so both-pending
  // shouldn't be reachable, but cheap to guard).
  const googlePending = googleAuth.connect.isPending;
  const outlookPending = outlookAuth.connect.isPending;
  const [lastStartedProvider, setLastStartedProvider] =
    React.useState<'google' | 'outlook' | null>(null);
  const pendingProvider: 'google' | 'outlook' | null = React.useMemo(() => {
    if (googlePending && outlookPending) return lastStartedProvider;
    if (googlePending) return 'google';
    if (outlookPending) return 'outlook';
    return null;
  }, [googlePending, outlookPending, lastStartedProvider]);
  const startConnect = (provider: 'google' | 'outlook') => {
    // In-flight guard: drop rapid duplicate clicks before React has
    // flushed isPending through to the disabled-button check. Without
    // this, two clicks within the React commit cycle both pass and
    // fire two mutate()s — the main-process startGoogleAuth /
    // startOutlookAuth call cancels the previous flow at the top, so
    // the user only sees one OAuth tab, but the renderer briefly ends
    // up with both connect mutations in flight and the Cancel row
    // gets confused about which provider it's cancelling.
    if (googlePending || outlookPending) return;
    setLastStartedProvider(provider);
    if (provider === 'google') googleAuth.connect.mutate();
    else outlookAuth.connect.mutate();
  };
  const onCancelPending = () => {
    if (pendingProvider === 'google') googleAuth.cancel.mutate();
    else if (pendingProvider === 'outlook') outlookAuth.cancel.mutate();
  };

  // Surface the most recent rejection message inline (e.g. "Auth denied",
  // "Timed out — no response from Google."). Filter out "Cancelled" since
  // user-initiated cancels don't need to be reported back to the user.
  // Prefer the error of the last-attempted provider so a stale error from
  // an earlier try-then-switch doesn't shadow the newer one.
  const errorOrder =
    lastStartedProvider === 'outlook'
      ? [outlookAuth.connect.error?.message, googleAuth.connect.error?.message]
      : [googleAuth.connect.error?.message, outlookAuth.connect.error?.message];
  const connectError = errorOrder.find((m) => m && m !== 'Cancelled');
  // Self-clear so a stale error doesn't sit in the UI forever once the
  // user has read it. 12s gives a comfortable read window for the longest
  // message we produce (the timeout line) without feeling sticky. No
  // separate X on the error row — the nudge already has one dismiss X
  // and stacking two looks like competing affordances; the user can also
  // clear by retrying (useMutation auto-resets) or wait out the timer.
  // Inlined reset calls + connectError-only deps: a useCallback closing
  // over `googleAuth.connect`/`outlookAuth.connect` would re-create each
  // render (React Query returns a fresh result object per render — only
  // the methods on it are referentially stable), which would restart
  // this timer on every render and the auto-clear would never fire.
  React.useEffect(() => {
    if (!connectError) return;
    const id = setTimeout(() => {
      googleAuth.connect.reset();
      outlookAuth.connect.reset();
    }, 12000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectError]);

  // Hide the nudge — and abort any in-flight handshake so we don't leak
  // a loopback server (and silently save tokens) after the user has said
  // "go away".
  const onDismissCalendarNudge = () => {
    if (pendingProvider === 'google') googleAuth.cancel.mutate();
    else if (pendingProvider === 'outlook') outlookAuth.cancel.mutate();
    try {
      localStorage.setItem(NUDGE_KEY, 'true');
    } catch {
      // Private mode / quota errors — just hide locally for this session.
    }
    setCalendarNudgeDismissed(true);
  };

  // Rendered both in the empty-state Welcome screen (brand-new users with
  // zero meetings — exactly who needs to discover calendar integration)
  // and in the regular Home above the Upcoming section. Empty state hides
  // the dismiss X — the nudge is the only secondary affordance there, so
  // letting users wipe it out leaves nothing to discover calendar from.
  const renderCalendarNudge = (withDismiss: boolean) =>
    showCalendarNudge ? (
      <div className="flex flex-col gap-1">
        <div
          className="flex items-center gap-3 text-xs"
          style={{ color: 'var(--fg-muted)' }}
        >
          {!calendarNudgeExpanded ? (
            <button
              type="button"
              onClick={() => setCalendarNudgeExpanded(true)}
              className="group -mx-1 flex flex-1 items-center gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-[color:var(--surface-hover)]"
              style={{ color: 'var(--fg-muted)' }}
            >
              <Calendar className="size-3.5 flex-shrink-0" />
              <span>{t('home.connectYourCalendarToSee')}</span>
              {!withDismiss && (
                <ChevronRight className="size-3 flex-shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5" />
              )}
            </button>
          ) : pendingProvider ? (
            <>
              <Calendar
                className="size-3.5 flex-shrink-0"
                style={{ color: 'var(--fg-muted)' }}
              />
              <span>
                {t('home.connectingTo')} {pendingProvider === 'google' ? t('home.google') : t('home.outlook')}
                …
              </span>
              <button
                type="button"
                onClick={onCancelPending}
                className="rounded px-2 py-0.5 transition-colors hover:bg-[color:var(--surface-hover)]"
                style={{ color: 'var(--fg-1)' }}
              >
                {t('home.cancel')}
              </button>
            </>
          ) : (
            <>
              <Calendar
                className="size-3.5 flex-shrink-0"
                style={{ color: 'var(--fg-muted)' }}
              />
              <span>{t('home.connect')}</span>
              <button
                type="button"
                onClick={() => startConnect('google')}
                className="rounded px-2 py-0.5 transition-colors hover:bg-[color:var(--surface-hover)]"
                style={{ color: 'var(--fg-1)' }}
              >
                {t('home.google')}
              </button>
              <button
                type="button"
                onClick={() => startConnect('outlook')}
                className="rounded px-2 py-0.5 transition-colors hover:bg-[color:var(--surface-hover)]"
                style={{ color: 'var(--fg-1)' }}
              >
                {t('home.outlook')}
              </button>
            </>
          )}
          {withDismiss && (
            <button
              type="button"
              onClick={onDismissCalendarNudge}
              aria-label={t('home.dismiss')}
              title={t('home.dismiss')}
              className="ml-auto rounded p-1 transition-colors hover:bg-[color:var(--surface-hover)]"
              style={{ color: 'var(--fg-muted)' }}
            >
              <X className="size-3" />
            </button>
          )}
        </div>
        {connectError && !pendingProvider && (
          <div
            className="pl-[1.625rem] text-xs"
            style={{ color: 'var(--fg-muted)' }}
          >
            {connectError}
          </div>
        )}
      </div>
    ) : null;
  const emptyStateCalendarNudge = renderCalendarNudge(false);
  const homeCalendarNudge = renderCalendarNudge(true);

  // Hero state inputs. All recompute on the existing 60s tick — no new
  // intervals. `inProgressEvent` uses the same matching window as the
  // backend's auto-detect (5 min early grace, 10 min late floor) so the
  // hero copy and the "Meeting detected" notification agree.
  const inProgressEvent = React.useMemo<CalendarEvent | null>(() => {
    if (!calendar.data || calendar.data.needsAuth) return null;
    return pickInProgressEvent(calendar.data.events, new Date(upcomingTickMs));
  }, [calendar.data, upcomingTickMs]);

  // `upcomingToday` is already all-day/declined/NaN-filtered and sorted by
  // start ascending, so the soonest still-future event is just the first one
  // that starts after now — no need to re-apply the guards here.
  const nextSoonEvent = React.useMemo<CalendarEvent | null>(
    () =>
      upcomingToday.find((e) => new Date(e.start).getTime() > upcomingTickMs) ??
      null,
    [upcomingToday, upcomingTickMs],
  );

  // Whether we have live calendar data to reason about. Distinguishes a
  // genuinely clear day (connected, no events) from "no calendar connected"
  // so the hero only claims "Clear day ahead" when it actually knows.
  const calendarConnected = !!calendar.data && !calendar.data.needsAuth;

  const heroState = React.useMemo(
    () => ({
      status: recording.status,
      sessionName: recording.sessionName,
      inProgressEvent,
      nextSoonEvent,
      tomorrowPreview,
      calendarConnected,
      now: upcomingTickMs,
      hotkeyEnabled,
    }),
    [
      recording.status,
      recording.sessionName,
      inProgressEvent,
      nextSoonEvent,
      tomorrowPreview,
      calendarConnected,
      upcomingTickMs,
      hotkeyEnabled,
    ],
  );
  const greeting = heroHeadline(heroState);
  const heroSub = heroSubtitle(heroState);
  const dateStr = new Date().toLocaleDateString(UI_LOCALE, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const renderAudioRow = (file: WatchedFile) => (
    <AudioRow
      key={file.id}
      file={file}
      folderName={watchedFolderNames.get(file.folderId) ?? ''}
      folderAuto={autoFolderIds.has(file.folderId)}
      busy={audioAction.isPending}
      isRecording={isRecording}
      onAction={(type) => runAudioAction(type, [file.id])}
      playState={audioPlayback.pendingKey === file.id ? 'loading' : audioPlayback.playingKey === file.id ? 'playing' : 'idle'}
      playFailed={audioPlayback.errorKey === file.id}
      onPlay={() => { void audioPlayback.toggle(file.id); }}
    />
  );

  return (
    <MeetingsShell
      activeSummaryFile={null}
      contentAlign={emptyState ? 'center' : 'top'}
    >
      {meetings.isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center text-[color:var(--fg-2)]">
          {t('home.loadingMeetings')}
        </div>
      ) : emptyState ? (
        <div className="flex flex-col items-center gap-8 text-center">
          <AppIcon size={56} />
          <div className="space-y-3">
            <h1
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 44,
                lineHeight: 1.1,
                letterSpacing: '-0.025em',
                color: 'var(--fg-1)',
              }}
            >
              {welcomeText}
            </h1>
            <p
              className="text-[17px] leading-[1.55]"
              style={{ color: 'var(--fg-2)' }}
            >
              {t('home.aiForYourConfidentialWorkflows')}
            </p>
            <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
              {t('home.alwaysGetConsentWhenTranscribing')}
            </p>
          </div>
          {!isRecording && <div className="w-full max-w-[560px] text-left"><ChecklistChoiceCard /></div>}
          <div className="flex flex-col items-center gap-3">
            <Button
              variant={isRecording ? 'destructive' : 'default'}
              onClick={onToggleRecording}
              className={cn('gap-2', IS_VENETA_MEMOAI && !isRecording && 'veneta-new-note')}
            >
              {isRecording ? <Square className="size-4" /> : <Plus className="size-4" />}
              {isRecording ? t('home.stopRecording') : t('home.newNote')}
            </Button>
            {hotkeyEnabled && (
              <p
                className="flex items-center gap-1.5 text-xs"
                style={{ color: 'var(--fg-muted)' }}
              >
                <span>{t('home.quickStart')}</span>
                <KbdKey>{isMac ? '⌘' : t('home.ctrl')}</KbdKey>
                <KbdKey>{isMac ? '⇧' : t('home.shift')}</KbdKey>
                <KbdKey>{t('home.r')}</KbdKey>
                <span>{t('home.fromAnywhere')}</span>
              </p>
            )}
          </div>
          {emptyStateCalendarNudge && (
            <div className="pt-8">{emptyStateCalendarNudge}</div>
          )}
        </div>
      ) : (
        <>
          {mode === 'home' && (
            <div className="mb-10">
              <div className="mb-1.5 flex items-end justify-between gap-6">
                <h1 className="home-hello">
                  {greeting}
                  <span className="faint">.</span>
                </h1>
                <div
                  className="pb-2 text-[13px] tabular-nums"
                  style={{ color: 'var(--fg-2)' }}
                >
                  {dateStr}
                </div>
              </div>
              <p
                className="max-w-[52ch] text-sm leading-[1.55]"
                style={{ color: 'var(--fg-2)' }}
              >
                {heroSub}
              </p>
            </div>
          )}

          {mode === 'home' && !isRecording && <ChecklistChoiceCard />}

          {homeCalendarNudge && (
            <div className="mb-8 w-fit">{homeCalendarNudge}</div>
          )}

          {upcomingToday.length > 0 && mode === 'home' && (() => {
            const groups: Record<string, typeof upcomingVisible> = {};
            
            const now = new Date(upcomingTickMs);
            const startOfTodayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

            for (const e of upcomingVisible) {
              const startMs = new Date(e.start).getTime();
              if (Number.isNaN(startMs)) continue;
              
              // Clamp events that started in the past (but are still ongoing) to today
              const effectiveDate = new Date(Math.max(startMs, startOfTodayMs));
              const key = `${effectiveDate.getFullYear()}-${effectiveDate.getMonth()}-${effectiveDate.getDate()}`;
              if (!groups[key]) groups[key] = [];
              groups[key].push(e);
            }

            return (
              <section className="mb-10">
                <SectionHead
                  title={t('home.comingUp')}
                  isSerif
                  count={upcomingToday.length}
                  action={
                    <div className="flex items-center gap-1.5">
                      {upcomingPageCount > 1 && (
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            className="inline-flex items-center rounded p-1 transition-colors hover:bg-[color:var(--surface-hover)] disabled:opacity-30 disabled:hover:bg-transparent"
                            title={t('home.previous')}
                            onClick={() => setUpcomingPage((p) => Math.max(0, p - 1))}
                            disabled={!canPagePrev}
                            style={{ color: 'var(--fg-2)' }}
                          >
                            <ChevronLeft className="size-[14px]" />
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center rounded p-1 transition-colors hover:bg-[color:var(--surface-hover)] disabled:opacity-30 disabled:hover:bg-transparent"
                            title={t('home.next')}
                            onClick={() => setUpcomingPage((p) => Math.min(upcomingPageCount - 1, p + 1))}
                            disabled={!canPageNext}
                            style={{ color: 'var(--fg-2)' }}
                          >
                            <ChevronRight className="size-[14px]" />
                          </button>
                        </div>
                      )}
                      <button
                        type="button"
                        className="inline-flex items-center rounded p-1 transition-colors hover:bg-[color:var(--surface-hover)] disabled:opacity-50"
                        title={t('home.checkForNewCalendarEvents')}
                        onClick={() => calendar.refetch()}
                        disabled={calendar.isFetching}
                        style={{ color: 'var(--fg-2)' }}
                      >
                        <RefreshCw className={`size-[14px] ${calendar.isFetching ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                  }
                />
                <AllDayInline
                  events={allDayToday}
                  expanded={allDayExpanded}
                  onToggle={() => setAllDayExpanded((v) => !v)}
                />
                <div 
                  className="rounded-[16px] bg-[color:var(--surface-raised)] border shadow-sm mt-3"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  {Object.entries(groups).map(([dateKey, group]) => {
                    const [y, m, d] = dateKey.split('-').map(Number);
                    const groupDate = new Date(y, m, d);
                    const day = groupDate.getDate();
                    const month = groupDate.toLocaleDateString(UI_LOCALE, SHORT_MONTH);
                    const weekday = groupDate.toLocaleDateString(UI_LOCALE, SHORT_WEEKDAY);
                    
                    return (
                      <div 
                        key={dateKey} 
                        className="flex p-5 pb-4 border-b border-dashed last:border-b-0"
                        style={{ borderColor: 'var(--border-subtle)' }}
                      >
                        {/* Date Column */}
                        <div className="w-[80px] flex-shrink-0 flex flex-col items-start pr-4 text-[color:var(--fg-2)] mt-0.5">
                          <div className="flex items-baseline gap-1.5 leading-none">
                             <span 
                               className="text-[26px] font-medium"
                               style={{ color: 'var(--fg-1)', fontFamily: 'var(--font-serif)', letterSpacing: '-0.02em' }}
                             >
                               {day}
                             </span>
                             <span className="text-[11px] font-semibold">{month}</span>
                          </div>
                          <span className="text-[11px] font-medium mt-1">{weekday}</span>
                        </div>
                        
                        {/* Events Column */}
                        <div className="flex-1 flex flex-col gap-1">
                          {group.map((event) => (
                            <UpcomingCard key={event.id} event={event} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })()}

          {upcomingToday.length === 0 && tomorrowPreview && mode === 'home' && (
            <section className="mb-10">
              <SectionHead title={t('home.tomorrow')} count={1} />
              <AllDayInline
                events={allDayToday}
                expanded={allDayExpanded}
                onToggle={() => setAllDayExpanded((v) => !v)}
              />
              <div 
                className="rounded-[16px] bg-[color:var(--surface-raised)] border shadow-sm p-2"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <UpcomingCard event={tomorrowPreview} />
              </div>
            </section>
          )}

          {upcomingToday.length === 0 && !tomorrowPreview && allDayToday.length > 0 && mode === 'home' && (
            <section className="mb-10">
              <SectionHead title={t('home.today')} count={allDayToday.length} />
              <AllDayInline
                events={allDayToday}
                expanded={allDayExpanded}
                onToggle={() => setAllDayExpanded((v) => !v)}
              />
            </section>
          )}

          <section>
            <SectionHead
              title={mode === 'meetings' ? t('home.allNotes') : t('home.previous')}
              count={mode === 'meetings' ? filtered.length : previous.length}
              action={
                mode === 'meetings' ? (
                  <div className="flex items-center gap-2">
                  {newAudio.length > 1 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-[26px] px-2.5 text-[12.5px]"
                      disabled={isRecording || audioAction.isPending}
                      title={isRecording ? t('watchedFolders.recordingBlocked') : undefined}
                      onClick={() => runAudioAction('transcribe', newAudio.map((f) => f.id))}
                      data-testid="transcribe-all-audio"
                    >
                      {t('watchedFolders.transcribeAll', { count: newAudio.length })}
                    </Button>
                  )}
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 size-[12px]"
                      style={{ color: 'var(--fg-muted)' }}
                    />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t('home.searchNotes')}
                      aria-label={t('home.searchNotes')}
                      className="h-[26px] w-[180px] rounded-md border-0 pl-7 pr-7 text-[12.5px] outline-none transition-colors focus:shadow-[inset_0_0_0_1px_hsl(var(--border))]"
                      style={{
                        background: 'rgba(27,27,25,0.04)',
                        color: 'var(--fg-1)',
                        fontFamily: 'var(--font-sans)',
                      }}
                    />
                    {search && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearch('');
                          searchInputRef.current?.focus();
                        }}
                        aria-label={t('home.clearSearch')}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex size-4 items-center justify-center rounded transition-colors hover:bg-[color:var(--surface-hover)]"
                        style={{ color: 'var(--fg-muted)' }}
                      >
                        <X className="size-[11px]" />
                      </button>
                    )}
                  </div>
                  </div>
                ) : undefined
              }
            />
            {audioAction.error && (
              <p role="alert" className="pb-2 text-[13px]" style={{ color: 'var(--fg-2)' }}>
                {audioAction.error.message}
              </p>
            )}
            {unavailableFolders.map((f) => (
              <p key={f.id} className="pb-2 text-[12.5px]" style={{ color: 'var(--fg-muted)' }}>
                {t('watchedFolders.unavailableNamed', { folder: f.name })}
              </p>
            ))}
            {groups.length === 0 && mode === 'meetings' && search.trim() ? (
              <div
                className="px-6 py-12 text-center text-[13px]"
                style={{ color: 'var(--fg-2)' }}
              >
                {t('home.noMeetingsMatch')}{search.trim()}&rdquo;.
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.label}>
                  <div
                    className="pb-2 pt-4 text-[11.5px] font-medium tracking-[0.02em]"
                    style={{ color: 'var(--fg-2)' }}
                  >
                    {g.label}
                  </div>
                  <div>
                    {g.items.map((item) =>
                      item.kind === 'note' ? (
                        <PreviousRow
                          key={item.meeting.session_info.summary_file}
                          meeting={item.meeting}
                          folderName={firstFolderName(item.meeting, folderName)}
                        />
                      ) : (
                        renderAudioRow(item.file)
                      ),
                    )}
                  </div>
                </div>
              ))
            )}
            {dismissedAudio.length > 0 && (
              <div className="pt-4">
                <button
                  type="button"
                  className="-mx-1 rounded px-1 py-0.5 text-xs transition-colors hover:bg-[color:var(--surface-hover)]"
                  style={{ color: 'var(--fg-muted)' }}
                  aria-expanded={showDismissed}
                  onClick={() => setShowDismissed((v) => !v)}
                  data-testid="dismissed-audio-toggle"
                >
                  {t('watchedFolders.dismissedCount', { count: dismissedAudio.length })}
                </button>
                {showDismissed && <div className="pt-1">{dismissedAudio.map(renderAudioRow)}</div>}
              </div>
            )}
          </section>
        </>
      )}
    </MeetingsShell>
  );
}

interface SectionHeadProps {
  title: string;
  count: number;
  action?: React.ReactNode;
  isSerif?: boolean;
}

function SectionHead({ title, count, action, isSerif }: SectionHeadProps) {
  return (
    <div
      className="mb-3.5 flex items-baseline justify-between pb-2.5"
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
    >
      <div className="flex items-baseline gap-2.5">
        <h2
          className={cn(
            isSerif ? "text-[22px]" : "text-sm font-medium tracking-[-0.005em]"
          )}
          style={{ color: 'var(--fg-1)', fontFamily: isSerif ? 'var(--font-serif)' : 'var(--font-sans)' }}
        >
          {title}
        </h2>
        <span
          className="text-[12.5px] tabular-nums"
          style={{ color: 'var(--fg-muted)' }}
        >
          {count}
        </span>
      </div>
      {action}
    </div>
  );
}


interface AllDayInlineProps {
  events: CalendarEvent[];
  expanded: boolean;
  onToggle: () => void;
}

function AllDayInline({ events, expanded, onToggle }: AllDayInlineProps) {
  if (events.length === 0) return null;
  return (
    <div className="mb-2 flex flex-col gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="-mx-1 self-start rounded px-1 py-0.5 text-xs transition-colors hover:bg-[color:var(--surface-hover)]"
        style={{ color: 'var(--fg-2)' }}
      >
        + {events.length} {t('home.allDayEvent')}{events.length === 1 ? '' : t('home.s')} {t('home.today2')}
      </button>
      {expanded && (
        // Render as full UpcomingCards so all-day events match the visual
        // language of the timed carousel below.
        <div 
          className="flex flex-col gap-1 rounded-[16px] bg-[color:var(--surface-raised)] border shadow-sm p-3 mt-1"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          {events.map((e) => (
            <UpcomingCard key={e.id} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}

function firstFolderName(
  m: Meeting,
  folderName: Map<string, string>,
): string | undefined {
  const id = m.folders?.[0] ?? m.session_info.folders?.[0];
  if (!id) return undefined;
  return folderName.get(id);
}

type ListItem =
  | { kind: 'note'; meeting: Meeting; at: string | undefined }
  | { kind: 'audio'; file: WatchedFile; at: string };

interface Group {
  label: string;
  items: ListItem[];
}

/** Notes and not-yet-transcribed audio, newest first, grouped by day. Audio
 *  is dated by when it was recorded, as its note will be. */
function groupPrevious(meetings: Meeting[], audio: WatchedFile[] = []): Group[] {
  const groups: Record<string, ListItem[]> = {};
  const order: string[] = [];
  const now = new Date();
  const items: ListItem[] = [
    ...meetings.map((meeting): ListItem => ({
      kind: 'note',
      meeting,
      at: meeting.session_info.processed_at ?? meeting.session_info.updated_at,
    })),
    ...audio.map((file): ListItem => ({ kind: 'audio', file, at: file.recordedAt })),
  ];
  const time = (item: ListItem) => new Date(item.at ?? 0).getTime() || 0;
  const sorted = items.sort((a, b) => time(b) - time(a));
  for (const item of sorted) {
    const label = item.at ? groupLabel(new Date(item.at), now) : t('home.earlier');
    if (!groups[label]) {
      groups[label] = [];
      order.push(label);
    }
    groups[label].push(item);
  }
  return order.map((label) => ({ label, items: groups[label] }));
}

function groupLabel(d: Date, now: Date): string {
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, now)) return t('home.today');
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return t('home.yesterday');
  const age = now.getTime() - d.getTime();
  if (age < 7 * 24 * 60 * 60 * 1000) {
    return d.toLocaleDateString(UI_LOCALE, { weekday: 'long' });
  }
  return d.toLocaleDateString(UI_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
}
