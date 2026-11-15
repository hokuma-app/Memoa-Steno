import { test, expect } from '../fixtures/electron';
import { ui, uiPart, uiText } from '../fixtures/ui-copy';

const ENV = { STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1' };

test('general questions work with meeting context selected even without live transcription', async ({ launchApp }) => {
  const { page, app } = await launchApp({ mockIpc: true, fakeAudio: true, env: { ...ENV, STENOAI_E2E_MOCK_ENGINE: 'whisper' } });
  await page.evaluate(() => window.stenoai.recording.start('Note'));
  const composer = page.locator('[data-ask-bar]');
  await expect(composer.getByRole('button', { name: uiPart('chat.context.label', { context: uiText('chat.scope.meeting') }) })).toBeVisible();
  await composer.getByPlaceholder(uiPart('chat.general.placeholder')).fill('Hi');
  await composer.getByRole('button', { name: ui('askBar.send'), exact: true }).click();
  await expect(composer.locator('ol')).toHaveCount(1);
  const request = await app.evaluate(() => (global as any).__mockIpcCalls.filter((c: any) => c.channel === 'chat-context-stream').at(-1).args[1]);
  expect(request.scope).toBe('live');
  expect(request.question).toBe('Hi');
  await expect(page.getByTestId('transcription-pill')).toBeVisible();
  await composer.getByRole('button', { name: uiPart('chat.context.label', { context: uiText('chat.scope.meeting') }) }).click();
  await expect(page.getByText(uiPart('chat.context.hint'))).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('chat-context-picker.png'), animations: 'disabled' });
});

test('live chat formats loose lists, keeps follow-ups, and allows general questions', async ({ launchApp }) => {
  const { page, app } = await launchApp({ mockIpc: true, fakeAudio: true, env: ENV });
  await page.evaluate(() => window.stenoai.recording.start('Note'));
  const composer = page.locator('[data-ask-bar]');
  const input = composer.getByRole('textbox');
  await expect(input).toBeEnabled();
  await input.fill('What did we decide?');
  await composer.getByRole('button', { name: ui('askBar.send'), exact: true }).click();
  await expect(composer.locator('ol')).toHaveCount(1);
  await expect(composer.locator('ol > li')).toHaveCount(3);
  await page.screenshot({ path: test.info().outputPath('live-chat.png') });
  expect(await composer.locator('ol').evaluate((el) => getComputedStyle(el).listStyleType)).toBe('decimal');
  await input.fill('Who owns that?');
  await composer.getByRole('button', { name: ui('askBar.send'), exact: true }).click();
  await expect(composer.locator('ol')).toHaveCount(2);
  const calls = await app.evaluate(() => (global as any).__mockIpcCalls.filter((c: any) => c.channel === 'chat-context-stream'));
  expect(calls[0].args[1].scope).toBe('live');
  expect(calls[1].args[1].history).toHaveLength(2);
  await composer.getByRole('button', { name: uiPart('chat.context.label', { context: uiText('chat.scope.meeting') }) }).click();
  await page.getByRole('button', { name: ui('chat.scope.general'), exact: true }).click();
  await input.fill('Explain DNS');
  await composer.getByRole('button', { name: ui('askBar.send'), exact: true }).click();
  await expect(composer.locator('ol')).toHaveCount(3);
  const general = await app.evaluate(() => (global as any).__mockIpcCalls.filter((c: any) => c.channel === 'chat-context-stream').at(-1).args[1]);
  expect(general.scope).toBe('general');
  expect(general.history).toEqual([]);
  await expect(page.getByTestId('transcription-pill')).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-ask-bar]').getByRole('button', { name: uiPart('chat.context.label', { context: uiText('chat.scope.general') }) })).toBeVisible();
  await composer.getByRole('button', { name: uiPart('chat.context.label', { context: uiText('chat.scope.general') }) }).click();
  await expect(page.getByText(ui('chat.context.heading'), { exact: true })).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#/chat'; });
  await expect(page.getByText(ui('chat.context.heading'), { exact: true })).toHaveCount(0);
});

test('draft and answer survive transcript expansion and stopping the recording', async ({ launchApp }) => {
  const { page, app } = await launchApp({ mockIpc: true, fakeAudio: true, env: { ...ENV, STENOAI_E2E_HOLD_CHAT: '1' } });
  await page.evaluate(() => window.stenoai.recording.start('Note'));
  const composer = page.locator('[data-ask-bar]');
  const input = composer.getByRole('textbox');
  await expect(input).toBeEnabled();
  await input.fill('Keep this draft');
  await page.getByTestId('transcription-pill').getByRole('button', { name: uiPart('askBar.showTranscript') }).click();
  await page.getByRole('button', { name: uiPart('liveTranscriptBar.minimizeTranscript') }).click();
  await expect(input).toHaveValue('Keep this draft');
  await composer.getByRole('button', { name: ui('askBar.send'), exact: true }).click();
  await expect(composer.getByRole('button', { name: ui('watchedFolders.stopPreview'), exact: true })).toBeVisible();
  const before = await page.evaluate(() => window.stenoai.chat.load());
  const key = before.success ? before.data?.sessions[0].summaryFile : null;
  await page.getByTestId('transcription-pill').getByRole('button', { name: uiPart('mainToolbar.stopRecording') }).click();
  await app.evaluate(() => (global as any).__finishChat());
  await expect.poll(async () => {
    const saved = await page.evaluate(() => window.stenoai.chat.load());
    return saved.success ? saved.data?.sessions[0].messages.length : 0;
  }).toBe(2);
  const saved = await page.evaluate(() => window.stenoai.chat.load());
  expect(saved.success && saved.data?.sessions[0].summaryFile).toBe(key);
  // A new recording with the same display name gets its own conversation.
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.evaluate(() => window.stenoai.recording.start('Note'));
  await expect(composer.locator('ol')).toHaveCount(0);
});

test('Chat tab renders numbered answers while recording continues', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true, fakeAudio: true, env: ENV });
  await page.evaluate(() => window.stenoai.recording.start('Note'));
  await page.evaluate(() => { window.location.hash = '#/chat'; });
  const input = page.getByRole('textbox').first();
  await input.fill('What are the priorities?');
  await input.press('Enter');
  await expect(page.locator('.chat-bubble ol')).toHaveCount(1);
  await expect(page.locator('.chat-bubble ol > li')).toHaveCount(3);
  await expect(page.getByTestId('transcription-pill')).toBeVisible();
});

test('an answer keeps its original conversation and scope after switching history', async ({ launchApp }) => {
  const { page, app } = await launchApp({ mockIpc: true, env: { STENOAI_E2E_HOLD_CHAT: '1' } });
  await page.evaluate(() => window.stenoai.chat.save({ sessions: [
    { id: 'general', name: 'General chat', summaryFile: '__global__', scopeFolderId: '__general__', messages: [], createdAt: 1, updatedAt: 1 },
    { id: 'notes', name: 'Notes chat', summaryFile: '__global__', scopeFolderId: null, messages: [], createdAt: 2, updatedAt: 2 },
  ] }));
  await page.reload();
  await page.evaluate(() => { window.location.hash = '#/chat/general'; });
  await expect(page.getByRole('button', { name: uiPart('chat.context.label', { context: uiText('chat.scope.general') }) })).toBeVisible();
  await page.getByRole('textbox').first().fill('Explain DNS');
  await page.getByRole('textbox').first().press('Enter');
  await expect(page.getByText(ui('chatConversation.thinking'), { exact: true })).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#/chat/notes'; });
  await expect(page.getByRole('button', { name: uiPart('chat.context.label', { context: uiText('folderScopePicker.allNotes') }) })).toBeVisible();
  await expect(page.getByText(ui('chatConversation.thinking'), { exact: true })).toHaveCount(0);
  await app.evaluate(() => (global as any).__finishChat());
  await expect.poll(async () => {
    const saved = await page.evaluate(() => window.stenoai.chat.load());
    return saved.success ? saved.data?.sessions.find((s) => s.id === 'general')?.messages.at(-1)?.role : null;
  }).toBe('assistant');
  const saved = await page.evaluate(() => window.stenoai.chat.load());
  expect(saved.success && saved.data?.sessions.find((s) => s.id === 'general')?.messages.at(-1)?.context).toBe('__general__');
  expect(saved.success && saved.data?.sessions.find((s) => s.id === 'notes')?.messages).toEqual([]);
});

test('a failed scope save cannot change the newly viewed conversation', async ({ launchApp }) => {
  const { page, app } = await launchApp({ mockIpc: true });
  await page.evaluate(() => window.stenoai.chat.save({ sessions: [
    { id: 'first', name: 'First chat', summaryFile: '__global__', scopeFolderId: null, messages: [], createdAt: 1, updatedAt: 1 },
    { id: 'second', name: 'Second chat', summaryFile: '__global__', scopeFolderId: '__general__', messages: [], createdAt: 2, updatedAt: 2 },
  ] }));
  await page.reload();
  await page.evaluate(() => { window.location.hash = '#/chat/first'; });
  await page.getByRole('button', { name: uiPart('chat.context.label', { context: uiText('folderScopePicker.allNotes') }) }).click();
  await app.evaluate(() => { (global as any).__holdNextChatSave = true; });
  await page.getByRole('button', { name: ui('chat.scope.general'), exact: true }).click();
  await expect.poll(() => app.evaluate(() => typeof (global as any).__failChatSave)).toBe('function');
  await page.evaluate(() => { window.location.hash = '#/chat/second'; });
  await expect(page.getByRole('button', { name: uiPart('chat.context.label', { context: uiText('chat.scope.general') }) })).toBeVisible();
  await app.evaluate(() => (global as any).__failChatSave());
  // Saving another message flushes the rollback before asserting the selected
  // scope on the second conversation and its dispatched request.
  await page.getByRole('textbox').first().fill('Explain DNS');
  await page.getByRole('textbox').first().press('Enter');
  await expect(page.locator('.chat-bubble ol')).toHaveCount(1);
  const request = await app.evaluate(() => (global as any).__mockIpcCalls.filter((c: any) => c.channel === 'chat-context-stream').at(-1).args[1]);
  expect(request.scope).toBe('general');
});
