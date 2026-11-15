import { test, expect } from "../fixtures/electron";
import { ui, uiPart, uiSource } from '../fixtures/ui-copy';

test("Agents exposes both install prompts and opens the selected setup guide", async ({
  launchApp,
}, testInfo) => {
  const { page, app } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_OPEN_EXTERNAL: "1" },
  });
  await app.evaluate(({ shell }) => {
    const state = globalThis as unknown as { openedUrls: string[] };
    state.openedUrls = [];
    shell.openExternal = async (url) => {
      state.openedUrls.push(url);
    };
  });
  await page.evaluate(() => {
    window.location.hash = "#/chat";
  });
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: uiPart('agentSkills.yourNotesInYourAgent') }),
  ).toBeVisible();
  for (const name of ["Claude Code", "Codex"]) {
    const card = page.getByRole("region", { name, exact: true });
    await card.getByRole("button", { name: uiPart('agentSkills.copyInstallPrompt') }).click();
    await expect(
      card.getByRole("button", { name: ui('meetingDetail.copied'), exact: true }),
    ).toBeVisible();
    const text = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(text).toContain(
      "https://github.com/stenolabs/stenoai/tree/main/skills/steno",
    );
    expect(text).toContain(
      name === "Codex" ? "$skill-installer" : "~/.claude/skills/steno",
    );
    await card.getByRole("button", { name: uiPart('agentSkills.setupInstructions') }).click();
  }
  await expect
    .poll(() =>
      app.evaluate(
        () => (globalThis as unknown as { openedUrls: string[] }).openedUrls,
      ),
    )
    .toEqual([
      "https://github.com/stenolabs/stenoai/blob/main/docs/features/agents.mdx#claude-code",
      "https://github.com/stenolabs/stenoai/blob/main/docs/features/agents.mdx#codex",
    ]);
  await app.evaluate(({ shell }) => {
    shell.openExternal = async () => {
      throw new Error("Browser unavailable");
    };
  });
  const codex = page.getByRole("region", { name: "Codex", exact: true });
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new Error("Clipboard unavailable");
    };
  });
  await codex
    .getByRole("button", { name: new RegExp(`${uiSource('agentSkills.copyInstallPrompt')}|${uiSource('meetingDetail.copied')}`) })
    .click();
  await expect(codex.locator("details")).toHaveAttribute("open", "");
  await expect(codex.getByRole('button', { name: ui('agentSkills.copyInstallPrompt'), exact: true })).toBeVisible();
  await codex.getByRole("button", { name: uiPart('agentSkills.setupInstructions') }).click();
  await expect(codex.getByRole("status")).toHaveText(
    ui('agentSkills.couldNotOpenTheInstructions'),
  );
  await expect(codex.locator("details")).toHaveAttribute("open", "");
  await page.screenshot({ path: testInfo.outputPath("agents.png") });
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page.getByRole("textbox").press("/");
  await expect(
    page.getByRole("button", { name: new RegExp(uiSource('chatPresets.chartMyNotes')) }).first(),
  ).toBeVisible();
});
