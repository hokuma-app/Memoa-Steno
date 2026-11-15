import { t } from '@/i18n';
export const STENO_SKILL_URL = 'https://github.com/stenolabs/stenoai/tree/main/skills/steno';
export const STENO_AGENTS_DOCS_URL = 'https://github.com/stenolabs/stenoai/blob/main/docs/features/agents.mdx';

export const AGENTS_COPY = {
  nav: t('agentSkills.agents'),
  title: t('agentSkills.yourNotesInYourAgent'),
  intro:
    t('agentSkills.giveYourAgentTheContext'),
  skill: t('agentSkills.theStenoSkill'),
  setup: t('agentSkills.copyTheInstallPromptAnd'),
  copy: t('agentSkills.copyInstallPrompt'),
  viewPrompt: t('agentSkills.viewInstallPrompt'),
  copied: t('agentSkills.copied'),
  copyError: t('agentSkills.couldNotCopySelectAnd'),
  docs: t('agentSkills.setupInstructions'),
  docsError: t('agentSkills.couldNotOpenTheInstructions'),
  privacy:
    t('agentSkills.theSkillReadsYourLocal'),
  tryIt: t('agentSkills.afterInstallingTryAsking'),
  example: t('agentSkills.useTheStenoSkillTo'),
};

export const AGENT_SKILLS = [
  {
    id: 'claude',
    name: 'Claude Code',
    invocation: '/steno',
    docs: `${STENO_AGENTS_DOCS_URL}#claude-code`,
    prompt: `Install the Steno skill from ${STENO_SKILL_URL} into my personal Claude Code skills directory (~/.claude/skills/steno). Include the whole folder, including scripts and references. If it already exists, ask before replacing it. Then explain how to use /steno with my local meeting notes.`,
  },
  {
    id: 'codex',
    name: 'Codex',
    invocation: '$steno',
    docs: `${STENO_AGENTS_DOCS_URL}#codex`,
    prompt: `$skill-installer install the Steno skill from ${STENO_SKILL_URL}. Include the whole folder, including scripts and references. If it already exists, ask before replacing it. Then explain how to use $steno with my local meeting notes.`,
  },
] as const;
