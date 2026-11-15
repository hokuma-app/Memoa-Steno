import { t } from '@/i18n';
// Templated preset prompts surfaced two ways:
//   1. Chip row at the bottom of the /chat entry page (always visible).
//   2. Popover triggered by typing '/' as the first character in either
//      composer (entry page or /chat/<id> conversation page).
// Edit the list here; both call sites pick it up automatically.
export interface ChatPreset {
  label: string;
  prompt: string;
  description: string;
}

export const CHAT_COMPOSER_LABEL = t('chatPresets.askAboutYourNotes');

export const PRESETS: ChatPreset[] = [
  {
    label: t('chatPresets.chartMyNotes'),
    prompt: t('chatPresets.createABarChartOf'),
    description: t('chatPresets.visualizesNumbersSupportedByYour'),
  },
  {
    label: t('chatPresets.listRecentTodos'),
    prompt: t('chatPresets.listMyActionItemsFrom'),
    description: t('chatPresets.pullsOutstandingToDosFrom'),
  },
  {
    label: t('chatPresets.coachMe'),
    prompt: t('chatPresets.coachMeOnMyRecent'),
    description: t('chatPresets.looksForPatternsAndSuggests'),
  },
  {
    label: t('chatPresets.writeWeeklyRecap'),
    prompt: t('chatPresets.writeARecapOfThis'),
    description: t('chatPresets.summaryOfTheWeekAcross'),
  },
  {
    label: t('chatPresets.blindSpots'),
    prompt: t('chatPresets.whatBlindSpotsHaveCome'),
    description: t('chatPresets.surfacesThemesYouMayHave'),
  },
];

export const PRESET_COLORS = ['#3B82F6', '#10B981', '#F97316', '#A855F7', '#EAB308'];

/** Slash glyph used as the leading icon on every preset chip + popover
 *  row. Reinforces the "/" keyboard shortcut. Defaults to plain grey but 
 *  accepts a color prop to render a tinted background for visual variety. */
export function PresetGlyph({ color = 'var(--fg-2)', size = 18 }: { color?: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex flex-shrink-0 items-center justify-center rounded-md font-mono font-semibold leading-none"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.7),
        color,
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
      }}
    >
      /
    </span>
  );
}
