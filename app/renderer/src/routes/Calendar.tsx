import { t } from '@/i18n';
import * as React from 'react';
import { MeetingsShell } from '@/components/MeetingsShell';
import { UpcomingCard } from '@/components/home/UpcomingCard';
import { useAppleCalendar, useCalendarEvents } from '@/hooks/useCalendarEvents';
import { navigate } from '@/lib/router';
import { UI_LOCALE } from '@/lib/locale';
import type { CalendarEvent } from '@/lib/ipc';

const DAYS_AHEAD = 7;

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Upcoming meetings for the next week, one group per day. Each meeting is the
 *  same card as on Home: click for details; only explicit actions start notes. */
export function Calendar() {
  const calendar = useCalendarEvents();
  const apple = useAppleCalendar();
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const days = React.useMemo(() => {
    if (!calendar.data || calendar.data.needsAuth) return [];
    const now = new Date(nowMs);
    const horizon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + DAYS_AHEAD).getTime();
    const groups = new Map<string, { date: Date; timed: CalendarEvent[]; allDay: CalendarEvent[] }>();
    for (const e of calendar.data.events) {
      if (e.response_status === 'declined') continue;
      const start = new Date(e.start);
      const end = new Date(e.end).getTime();
      if (Number.isNaN(start.getTime()) || Number.isNaN(end) || end <= nowMs) continue;
      if (start.getTime() >= horizon) continue;
      // Ongoing meetings that started before today still belong to today.
      const shown = start.getTime() < nowMs ? now : start;
      const key = dayKey(shown);
      if (!groups.has(key)) {
        groups.set(key, {
          date: new Date(shown.getFullYear(), shown.getMonth(), shown.getDate()),
          timed: [],
          allDay: [],
        });
      }
      const group = groups.get(key)!;
      (e.is_all_day ? group.allDay : group.timed).push(e);
    }
    return [...groups.values()]
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((g) => ({
        ...g,
        timed: g.timed.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()),
      }));
  }, [calendar.data, nowMs]);

  const today = new Date(nowMs);
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const label = (d: Date) =>
    dayKey(d) === dayKey(today)
      ? t('calendar.today')
      : dayKey(d) === dayKey(tomorrow)
        ? t('calendar.tomorrow')
        : d.toLocaleDateString(UI_LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <MeetingsShell activeSummaryFile={null}>
      <div className="mx-auto w-full max-w-[760px] py-10" style={{ color: 'var(--fg-1)' }}>
        <h1
          className="text-[32px] leading-tight tracking-tight"
          style={{ fontFamily: 'var(--font-serif)' }}
        >{t('sidebar.calendar')}</h1>

        {calendar.isLoading ? (
          <p className="mt-6 text-sm" style={{ color: 'var(--fg-2)' }}>{t('calendar.loading_meetings')}</p>
        ) : apple.status.data?.enabled && apple.status.data.authorization !== 'full' ? (
          <p className="mt-6 text-sm" style={{ color: 'var(--fg-2)' }}>{t('calendar.apple_calendar_is_on_but_stenoai_doesn')}{' '}
            <button
              type="button"
              className="underline"
              disabled={apple.connect.isPending}
              onClick={() => apple.connect.mutate()}
            >
              {apple.connect.isPending ? t('calendar.waiting_for_permission') : t('calendar.allow_access')}
            </button>
          </p>
        ) : !calendar.data || calendar.data.needsAuth ? (
          <p className="mt-6 text-sm" style={{ color: 'var(--fg-2)' }}>{t('calendar.no_calendar_connected')}{' '}
            <button
              type="button"
              className="underline"
              onClick={() => navigate('/settings?tab=general')}
            >{t('calendar.connect_one_in_settings')}</button>
            .
          </p>
        ) : days.length === 0 ? (
          <p className="mt-6 text-sm" style={{ color: 'var(--fg-2)' }}>{t('calendar.no_meetings', { days: DAYS_AHEAD })}</p>
        ) : (
          <div className="mt-8 flex flex-col gap-8">
            {days.map((day) => (
              <section key={dayKey(day.date)}>
                <h2
                  className="mb-2 text-[13px] font-semibold tracking-[0.01em]"
                  style={{ color: 'var(--fg-2)' }}
                >
                  {label(day.date)}
                </h2>
                {day.allDay.length > 0 && (
                  <p className="mb-1 text-[12px]" style={{ color: 'var(--fg-muted)' }}>{t('calendar.all_day')}{day.allDay.map((e) => e.title).join(' · ')}
                  </p>
                )}
                <div className="flex flex-col">
                  {day.timed.map((e) => (
                    <UpcomingCard key={e.id} event={e} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </MeetingsShell>
  );
}
