import { version } from '../../../package.json';
import { t } from '@/i18n';

// Release preparation updates this list alongside the public changelog.
// The renderer build binds the content to package.json's version.
export const RELEASE_VERSION = version;
type ReleaseHighlight = {
  id: string;
  title: string;
  description: string;
  action: string;
  route: string;
  visual?: 'agents' | 'chart';
};
export const RELEASE_HIGHLIGHTS: readonly ReleaseHighlight[] = [
  {
    id: 'agents',
    title: t('releaseHighlights.yourMeetingNotesInYour'),
    description:
      t('releaseHighlights.connectClaudeCodeOrCodex'),
    action: t('releaseHighlights.tryAgents'),
    route: '/agents',
    visual: 'agents',
  },
  {
    id: 'charts',
    title: t('releaseHighlights.seeTheNumbersInYour'),
    description:
      t('releaseHighlights.askChatForABar'),
    action: t('releaseHighlights.openChat'),
    route: '/chat',
    visual: 'chart',
  },
  {
    id: 'speaker-models',
    title: t('releaseHighlights.chooseWhenToAddIndividual'),
    description:
      t('releaseHighlights.onMacosSpeakerModelsAre'),
    action: t('releaseHighlights.openAiSettings'),
    route: '/settings?tab=ai',
  },
];

export const WHATS_NEW_COPY = {
  title: t('releaseHighlights.whatSNewInSteno'),
  subtitle: t('releaseHighlights.aQuickLookAtThis'),
  settingsLabel: t('releaseHighlights.whatSNew'),
  settingsDescription: t('releaseHighlights.exploreTheHighlightsOfThis'),
  view: t('releaseHighlights.viewHighlights'),
  done: t('releaseHighlights.done'),
  fullNotes: t('releaseHighlights.fullReleaseNotes'),
  linkError: t('releaseHighlights.couldNotOpenTheRelease'),
};

export const LAST_SEEN_RELEASE_KEY = 'steno-last-seen-release';
export const CHANGELOG_URL = `https://github.com/stenolabs/stenoai/releases/tag/v${RELEASE_VERSION}`;

/** Stable releases only. Downgrades and same-version restarts stay quiet. */
export function isUnseenRelease(current: string, seen: string | null): boolean {
  const parts = (value: string) =>
    /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null;
  const next = parts(current);
  if (!next) return false;
  const previous = seen ? parts(seen) : null;
  if (!previous) return true;
  for (let i = 0; i < next.length; i++) {
    if (next[i] !== previous[i]) return next[i] > previous[i];
  }
  return false;
}
