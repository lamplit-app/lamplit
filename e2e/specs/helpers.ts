import { Locator, Page, expect } from '@playwright/test';
import type { PersistenceServer } from './persistence-server';

export const FAKE_API_URL = `http://localhost:${process.env.FAKE_API_PORT ?? 4310}/v1`;
export const FAKE_MODEL = 'fake/storyteller-large';

export const STORY_ID = 'story-under-test';
export const CHAPTER_ID = 'chapter-under-test';

/**
 * The scene a seeded chapter is opened on. One text for the whole suite, so
 * that a spec writing a scene of its own is saying the words in it matter — as
 * the palette specs' weather does, and as the “keeper” in this one does to the
 * lore that fires on it.
 */
export const SCENE = 'The keeper’s cottage, late afternoon, low tide. The door is unlatched.';

/**
 * Writes `settings.json` into the server's data folder, so specs start from a
 * connected app without walking the Connection modal every time. One spec does
 * walk it, which is what keeps this shape honest.
 *
 * On disk rather than in the browser, because the browser keeps nothing: the
 * app reads every document from the server when it starts.
 */
export async function seedConnectedSettings(
  server: PersistenceServer,
  apiKey = 'test-key',
  generation: Record<string, unknown> = {},
): Promise<void> {
  const settings = {
    connection: {
      provider: 'custom',
      baseUrl: FAKE_API_URL,
      apiKey,
      model: FAKE_MODEL,
      modelsCache: [{ id: FAKE_MODEL, name: 'Storyteller Large', ownedBy: 'fake' }],
    },
    generation: {
      maxContextTokens: 16384,
      maxResponseTokens: 800,
      temperature: 0.9,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      stop: [],
      ...generation,
    },
    ui: {
      theme: 'dark',
      bookStyleDialogue: true,
      fontSize: 18,
      showTokenCounts: true,
    },
    activeStoryId: STORY_ID,
  };
  await server.seed({ settings });
}

/**
 * A `ui` field written over the settings document already on disk, so a spec
 * can start from a setting a reader would have changed on the computer.
 */
export async function seedUi(
  server: PersistenceServer,
  patch: Record<string, unknown>,
): Promise<void> {
  const settings = (await server.document('settings')) ?? {};
  const ui = (settings['ui'] as Record<string, unknown>) ?? {};
  await server.seed({ settings: { ...settings, ui: { ...ui, ...patch } } });
}

/**
 * Turns developer mode on before the app starts.
 *
 * The context pill and the prompt preview behind it are only there when it is,
 * so any spec that reads the assembled prompt has to say so — and a spec that
 * does not is checking the app a writer actually sees.
 */
export async function seedDeveloperMode(server: PersistenceServer): Promise<void> {
  await seedUi(server, { developerMode: true });
}

/** Opens What the model sees, which developer mode's pill is the only way into. */
export async function openPromptPreview(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^context/ }).click();
  await expect(page.getByRole('heading', { name: 'What the model sees' })).toBeVisible();
  // The sheet grows into place, and anything measured or scrolled while it is
  // still growing is measured against geometry that is about to change — which
  // is how a click lands on the wrong element and a scroll ends up at the foot.
  await expect(page.locator('.mdc-dialog--opening')).toHaveCount(0);
}

/**
 * The blocks of the system message, top to bottom; the rest of the sheet is
 * not one. Read as text content rather than as rendered text, because the
 * headings are set in small capitals by the stylesheet.
 */
export async function promptBlocks(page: Page): Promise<string[]> {
  const names = await page
    .locator('mat-dialog-content .block')
    .filter({ has: page.locator('.handle, .why') })
    .locator('.name')
    .allTextContents();
  return names.map((name) => name.trim());
}

export interface SeedStory {
  title?: string;
  mode?: 'narrator' | 'roleplay';
  /** Absent is what a story written before casting was a choice looks like. */
  roleplay?: { casting: 'ensemble' | 'one-at-a-time'; activeCharacterId: string };
  persona?: { name: string; description: string };
  characters?: { id: string; name: string; description: string; enabled: boolean }[];
  storySoFar?: string;
  entries?: {
    id: string;
    title: string;
    category?: 'fact' | 'person' | 'place' | 'other';
    keys: string[];
    content: string;
    enabled?: boolean;
    alwaysOn?: boolean;
  }[];
  /** The opening chapter's scene. Empty means the composer stays shut. */
  scene?: string;
  chapterTitle?: string;
  /** Whether opening a chapter asks the model to choose the page it is read on. */
  autoTheme?: boolean;
  /** A page the chapter already has, as a chapter reread later would have. */
  palette?: string;
}

/** Seeds one story with one chapter, the state most specs want to start from. */
export async function seedStory(server: PersistenceServer, options: SeedStory = {}): Promise<void> {
  const story = {
    id: STORY_ID,
    title: options.title ?? 'The Lighthouse',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    mode: options.mode ?? 'narrator',
    narrator: { useDefault: true, prompt: '' },
    characters: options.characters ?? [],
    ...(options.roleplay ? { roleplay: options.roleplay } : {}),
    persona: options.persona ?? { name: '', description: '' },
    style: { dialogueOnOwnLine: true, replyLength: 'medium' },
    world: {
      storySoFar: options.storySoFar ?? '',
      entries: (options.entries ?? []).map((entry) => ({
        category: 'fact',
        enabled: true,
        alwaysOn: false,
        ...entry,
      })),
      scan: { depth: 4, caseSensitive: false, matchWholeWords: false },
    },
    activeChapterId: CHAPTER_ID,
    chapterCounter: 1,
    autoTheme: options.autoTheme ?? false,
  };
  const chapter = {
    id: CHAPTER_ID,
    storyId: STORY_ID,
    number: 1,
    title: options.chapterTitle ?? '',
    scene: options.scene ?? '',
    status: 'writing',
    summary: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [],
    ...(options.palette ? { palette: options.palette } : {}),
  };
  await server.seed({
    [`story:${STORY_ID}`]: story,
    [`chapter:${CHAPTER_ID}`]: chapter,
  });
}

/**
 * Waits for the chapter under test to reach disk.
 *
 * A reload now starts again from the server, so a spec that reloads has to let
 * the write land first. The app says the same thing with the "Saving…" pill in
 * the top bar; this is the version that cannot race it.
 */
export async function waitForSaved(server: PersistenceServer, messageCount: number): Promise<void> {
  await expect
    .poll(async () => {
      const chapter = await server.document('chapters', CHAPTER_ID);
      return (chapter?.['messages'] as unknown[] | undefined)?.length ?? 0;
    })
    .toBe(messageCount);
}

export function messages(page: Page): Locator {
  return page.locator('article[data-role]');
}

export function userMessages(page: Page): Locator {
  return page.locator('article[data-role="user"]');
}

export function assistantMessages(page: Page): Locator {
  return page.locator('article[data-role="assistant"]');
}

/**
 * The box the story is written in: a prose editor, not a textarea. The
 * author's field under it is still a textarea, and is not this.
 */
export function composer(page: Page): Locator {
  return proseEditor(page.locator('li-composer'));
}

/** The editable surface of a prose editor inside `scope`: the composer's, or a message's. */
export function proseEditor(scope: Locator): Locator {
  return scope.locator('li-prose-editor [contenteditable]');
}

/**
 * Writes into a prose editor the way a writer would, replacing what was there.
 * Keystroke by keystroke, so the input rules see them; Shift+Enter for a
 * newline, because Enter is Send in the composer. Focused rather than clicked,
 * as `fill()` was: a box under the chapter panel's scrim can still be written
 * into, and a click would wait for the scrim to go.
 */
export async function fillProse(editor: Locator, text: string): Promise<void> {
  await editor.focus();
  await editor.press('ControlOrMeta+a');
  await editor.press('Backspace');
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    if (index) await editor.press('Shift+Enter');
    if (line) await editor.pressSequentially(line);
  }
}

/**
 * A chapter that cannot be written into has no box at all — only the reason
 * and the way out of it.
 */
export async function expectComposerHidden(page: Page, reason: RegExp): Promise<void> {
  await expect(composer(page)).toHaveCount(0);
  await expect(page.locator('li-composer').getByRole('button', { name: reason })).toBeVisible();
}

export async function send(page: Page, text: string): Promise<void> {
  await fillProse(composer(page), text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

/**
 * Waits for the turn to finish: the composer's Stop is only up while streaming.
 * Exactly that name — a message being read aloud offers "Stop reading", which
 * is a different button about a different thing.
 */
export async function waitForTurn(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeHidden({
    timeout: 20_000,
  });
}

/**
 * Answers the review sheet a close puts up: the summary the model offered,
 * rewritten as the writer's own, and the button that ends the chapter.
 *
 * Its own function because the sheet has two ways in — the Close chapter
 * button, and New chapter, which closes this one on the way.
 */
export async function confirmClose(page: Page, summary: string): Promise<void> {
  const review = page.getByRole('dialog');
  const written = review.locator('textarea');
  // The model's summary arrives after the sheet does, and filling the box
  // before it lands is a race the model wins.
  await expect(written).not.toBeEmpty();
  await written.fill(summary);
  await review.getByRole('button', { name: 'Close the chapter' }).click();
}

/** Closes the chapter being written, from the button that offers it. */
export async function closeChapter(page: Page, summary: string): Promise<void> {
  await page.getByRole('button', { name: 'Close chapter' }).click();
  await confirmClose(page, summary);
}

/** Writes the scene the sheet on screen is asking for, and opens the chapter. */
export async function openChapter(page: Page, scene: string): Promise<void> {
  const sheet = page.getByRole('dialog');
  await sheet.locator('textarea.scene').fill(scene);
  await sheet.getByRole('button', { name: 'Open the chapter' }).click();
}

/** The panel beside the page: the scene, the narrator, the persona and the cast. */
export function chapterPanel(page: Page): Locator {
  return page.locator('li-chapter-panel');
}

/** One of the panel's sections, by the name it is marked with. */
export function panelSection(page: Page, name: string): Locator {
  return chapterPanel(page).locator(`[data-section="${name}"]`);
}

/** Idempotent: a reload brings the panel back open, because it remembers. */
export async function openPanel(page: Page): Promise<void> {
  const handle = page.getByRole('button', { name: 'Open the chapter panel' });
  if (await handle.count()) await handle.click();
  await expect(
    chapterPanel(page).getByRole('button', { name: 'Close the chapter panel' }),
  ).toBeVisible();
}

/**
 * What the page is actually drawn on, whoever put it there. Read off the body
 * rather than out of the custom property: the property is a `light-dark()` pair
 * until something overrides it, and these specs compare the two states.
 */
export function pageColour(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

/**
 * Opens Preferences, which arrives with Reading already open.
 *
 * Behind the ⋯ menu rather than named on the bar: it is the app being set up
 * rather than the story being written. Ctrl+, opens the same sheet, and
 * `preferences.spec.ts` is where that is checked; every other spec that wants
 * the sheet comes through the menu, the way a reader would.
 */
export async function openPreferences(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: /^Preferences/ }).click();
  await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible();
}

/** Flips the book-style switch under Preferences → Reading and closes the sheet. */
export async function setBookStyle(page: Page, on: boolean): Promise<void> {
  await openPreferences(page);
  const toggle = page.getByRole('switch', { name: 'Dialogue on its own line' });
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
  await page.keyboard.press('Escape');
  await expect(toggle).toBeHidden();
}

/**
 * Hovering is what reveals a message's actions. They live in the right margin
 * at this width; below the measure, or on a touch screen, the same names are
 * behind the ⋯ under the message, which `actFromMenu` reaches instead.
 */
export async function act(message: Locator, name: string | RegExp): Promise<void> {
  await message.hover();
  await message.getByRole('button', { name }).click();
}

/** The same actions, from the ⋯ the narrow layout puts under the message. */
export async function actFromMenu(
  page: Page,
  message: Locator,
  name: string | RegExp,
): Promise<void> {
  await message.getByRole('button', { name: 'Message actions' }).click();
  await page.getByRole('menuitem', { name }).click();
}

/** Collects the request bodies the app sends, for prompt assertions. */
export async function captureRequests(page: Page): Promise<Record<string, any>[]> {
  const bodies: Record<string, any>[] = [];
  await page.route('**/chat/completions', async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.continue();
  });
  return bodies;
}

/** The system message of the last request, which is where the prompt lives. */
export function systemOf(body: Record<string, any> | undefined): string {
  const message = (body?.['messages'] ?? []).find((m: { role: string }) => m.role === 'system');
  return message?.content ?? '';
}

/**
 * The system messages sent *between* the turns. The first system message is
 * the prompt itself; anything after it is the app telling the model that the
 * cast changed at that point in the chapter.
 */
export function notesOf(body: Record<string, any> | undefined): string[] {
  return ((body?.['messages'] ?? []) as { role: string; content: string }[])
    .filter((m) => m.role === 'system')
    .slice(1)
    .map((m) => m.content);
}
