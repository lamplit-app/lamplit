import { BrowserContext, Locator, Page, expect, test } from '@playwright/test';
import {
  captureRequests,
  composer,
  FAKE_API_URL,
  fillProse,
  openPreferences,
  systemOf,
  waitForTurn,
} from './helpers';
import { IS_BUILT, PersistenceServer } from './persistence-server';

/**
 * The whole app, once, in narrator mode, from nothing.
 *
 * Nothing is seeded: an empty data folder, a browser that has never seen the
 * app, and the production build served by the real persistence server. Every
 * stage is walked through the interface the way a person would, and checked
 * against the JSON files on disk rather than against the screen — because the
 * screen can be right while the file is wrong, and the file is what survives.
 *
 * Stages run in order and share one page, so this reads as one sitting rather
 * than as fifteen unrelated tests. A failure part-way through stops the rest,
 * which is the point: stage 7 means nothing if stage 3 did not happen.
 */

const TITLE = 'The Lantern Room';
const PERSONA = 'A marine biologist, thirty-one, back on the island after nine years.';

const SCENE_1 =
  'The lantern room, an hour before dusk, rain on the seaward glass. The door at the bottom ' +
  'of the stairs was unlocked from the inside, and Mara did not unlock it.';

const STORY_SO_FAR =
  'Mara came back to Ash Head for a fortnight of survey work and has not been inside her ' +
  'father’s lighthouse since she was twenty-two.';

const LORE_KEY = 'tomas';
const LORE_FACT =
  'Kept the light for nineteen years before Mara’s father. Left the island in 1971.';

test.describe('a story from nothing, told by a narrator', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!IS_BUILT, 'the app has not been built — run `npm run e2e`, which builds it first');

  let server: PersistenceServer;
  let context: BrowserContext;
  let page: Page;
  let requests: Record<string, any>[];
  let storyId: string;
  let chapter1: string;
  let chapter2: string;

  test.beforeAll(async ({ browser }) => {
    server = await PersistenceServer.create();
    await server.start();
    // A browser with nothing in it, pointed at a server with nothing in it.
    context = await browser.newContext();
    page = await context.newPage();
    requests = await captureRequests(page);
    await page.goto(server.url);
  });

  test.afterAll(async () => {
    await context?.close();
    await server?.dispose();
  });

  /** The system prompt of the most recent request. */
  const lastSystem = () => systemOf(requests[requests.length - 1]);

  /**
   * Shuts a modal by its own button. Escape saves and closes too — world.spec
   * covers that — but it only reaches the dialog when focus is still inside it,
   * and half of these stages have just blurred a field to commit what they
   * typed.
   */
  const close = async (dialog: Locator) => {
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
  };

  /** Developer mode's one door into the assembled prompt. Absent until then. */
  const contextPill = () => page.locator('li-composer').getByRole('button', { name: /^context/ });

  test('1 · opens on the connection, and will not be waved away', async () => {
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: /somewhere to send the story/ })).toBeVisible();

    // It insists: Escape does nothing, and the way on stays dark.
    await expect(sheet.getByRole('button', { name: 'Done' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(sheet.getByRole('heading', { name: /somewhere to send the story/ })).toBeVisible();
  });

  test('2 · takes an endpoint, lists its models, and proves the round trip', async () => {
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Provider').selectOption('custom');
    await sheet.getByLabel('Endpoint URL').fill(FAKE_API_URL);

    await sheet.getByRole('button', { name: 'Fetch models' }).click();
    await expect(sheet.getByText('3 models', { exact: true })).toBeVisible();

    await sheet.getByLabel('Model', { exact: true }).selectOption('fake/storyteller-large');

    await sheet.getByRole('button', { name: 'Test' }).click();
    await expect(sheet.getByText(/The model answered/)).toBeVisible({ timeout: 20_000 });

    const done = sheet.getByRole('button', { name: 'Done' });
    await expect(done).toBeEnabled();
    await done.click();

    // Settings reached disk before the next question was even asked.
    await expect
      .poll(async () => (await server.document<any>('settings'))?.['connection']?.model)
      .toBe('fake/storyteller-large');
  });

  test('3 · asks who tells it and who you play, and files the answers', async () => {
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: 'Your first story' })).toBeVisible();

    await sheet.getByLabel('Title').fill(TITLE);
    await sheet.getByLabel('Name').fill('Mara');
    await sheet.getByRole('textbox').last().fill(PERSONA);
    // Narrator is the default; clicking it is what a person would do anyway.
    await sheet.getByRole('button', { name: /^Narrator/ }).click();
    await sheet.getByRole('button', { name: 'Write the first scene' }).click();

    // The app made a story for itself at startup, so the file is already
    // there: what this waits for is the answers landing in it.
    [storyId] = await server.ids('stories');
    await expect
      .poll(async () => (await server.document<any>('stories', storyId))?.['title'])
      .toBe(TITLE);
    const story = await server.document<any>('stories', storyId);
    expect(story?.['mode']).toBe('narrator');
    expect(story?.['persona']).toEqual({ name: 'Mara', description: PERSONA });
  });

  test('4 · will not open the chapter until the scene is written', async () => {
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: /Chapter 1 — the scene/ })).toBeVisible();

    const open = sheet.getByRole('button', { name: 'Open the chapter' });
    await expect(open).toBeDisabled();
    await sheet.locator('textarea.scene').fill('   ');
    await expect(open).toBeDisabled();

    await sheet.locator('textarea.scene').fill(SCENE_1);
    await expect(open).toBeEnabled();
    await open.click();

    await expect(composer(page)).toBeEnabled();
    [chapter1] = await server.ids('chapters');
    await expect
      .poll(async () => (await server.document<any>('chapters', chapter1))?.['scene'])
      .toBe(SCENE_1);
  });

  test('5 · the first turn carries the narrator, the persona and the scene', async () => {
    await fillProse(composer(page), 'I climb, counting the steps.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await waitForTurn(page);

    const system = lastSystem();
    expect(system).toContain('You are the narrator of an ongoing story');
    expect(system).toContain(`The user plays Mara: ${PERSONA}`);
    expect(system).toContain('Chapter 1');
    expect(system).toContain(SCENE_1);
    // The scene is the last thing before the conversation, closest to it.
    expect(system.indexOf(SCENE_1)).toBeGreaterThan(system.indexOf('The user plays Mara'));

    await expect(page.locator('article[data-role]')).toHaveCount(2);
    await expect
      .poll(async () =>
        ((await server.document<any>('chapters', chapter1))?.['messages'] ?? []).map(
          (m: { role: string }) => m.role,
        ),
      )
      .toEqual(['user', 'assistant']);
  });

  test('6 · the story so far is written down, and is always sent', async () => {
    await page.getByRole('button', { name: 'World', exact: true }).click();
    const world = page.getByRole('dialog');
    await world.locator('li-editor-field textarea').first().fill(STORY_SO_FAR);
    await close(world);

    await expect
      .poll(async () => (await server.document<any>('stories', storyId))?.['world']?.storySoFar)
      .toBe(STORY_SO_FAR);

    await fillProse(composer(page), 'I say nothing and wait.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await waitForTurn(page);
    expect(lastSystem()).toContain(`The story so far:\n${STORY_SO_FAR}`);
  });

  test('7 · a lore entry stays out of the prompt until the story mentions it', async () => {
    await page.getByRole('button', { name: 'World', exact: true }).click();
    const world = page.getByRole('dialog');
    await world.getByRole('tab', { name: 'Lore' }).click();
    await world.getByRole('button', { name: 'Add an entry' }).click();
    await page.getByRole('menuitem', { name: 'Person' }).click();

    const entry = world.locator('.entry').first();
    await entry.getByLabel('Title').fill('Old Tomas');
    await entry.getByLabel('Keys').fill(`${LORE_KEY}, keeper`);
    const truth = entry.locator('li-editor-field textarea');
    await truth.fill(LORE_FACT);
    await truth.blur();
    await expect(entry).not.toHaveClass(/unwritten/);
    await close(world);

    await expect
      .poll(async () => (await server.document<any>('stories', storyId))?.['world'].entries.length)
      .toBe(1);

    // The way in is developer mode's context pill, and this is the first stage
    // that has wanted it — so it is switched on here, through the interface,
    // the way anyone else would.
    await expect(contextPill()).toHaveCount(0);
    await openPreferences(page);
    const preferences = page.getByRole('dialog');
    await preferences.getByRole('button', { name: 'Advanced' }).click();
    await preferences.getByRole('switch', { name: /^Developer mode/ }).click();
    await close(preferences);

    // Nothing in the story has mentioned him yet, and the composer is empty,
    // so the pill shows the chapter exactly as it stands.
    await contextPill().click();
    const preview = page.getByRole('dialog');
    await expect(preview.getByText(LORE_FACT)).toHaveCount(0);
    await close(preview);

    // Typing his name is enough: the pill counts the draft in too.
    await fillProse(composer(page), `"Did you know ${LORE_KEY}?" I ask.`);
    await contextPill().click();
    const armed = page.getByRole('dialog');
    await expect(armed.locator('li', { hasText: 'Old Tomas' })).toContainText(
      `fired on “${LORE_KEY}”`,
    );
    await close(armed);

    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await waitForTurn(page);
    expect(lastSystem()).toContain('What is true in this world:');
    expect(lastSystem()).toContain(LORE_FACT);
  });

  test('8 · closing the chapter folds it into the story so far and opens the next', async () => {
    await page.getByRole('button', { name: 'Close chapter' }).click();
    const review = page.getByRole('dialog');
    await expect(review.getByRole('heading', { name: /^Close Chapter 1/ })).toBeVisible();

    const summary = review.locator('textarea').first();
    await expect(summary).not.toBeEmpty({ timeout: 20_000 });

    // What was asked for: the story so far as it stands, and the chapter itself.
    const asked = requests[requests.length - 1]['messages'].at(-1).content as string;
    expect(asked).toContain(STORY_SO_FAR);
    expect(asked).toContain(SCENE_1);
    expect(asked).toContain('I climb, counting the steps.');

    const written = await summary.inputValue();
    await review.getByRole('button', { name: 'Close the chapter' }).click();

    // Chapter 1 keeps everything and is marked closed; the story so far is
    // replaced by the summary rather than having it appended.
    await expect
      .poll(async () => (await server.document<any>('chapters', chapter1))?.['status'])
      .toBe('closed');
    const closed = await server.document<any>('chapters', chapter1);
    expect(closed?.['summary']).toBe(written.trim());
    expect(closed?.['messages']).toHaveLength(6);

    const story = await server.document<any>('stories', storyId);
    expect(story?.['world'].storySoFar).toBe(written.trim());
    expect(story?.['world'].storySoFar).not.toContain(STORY_SO_FAR);
    expect(story?.['chapterCounter']).toBe(2);
  });

  test('9 · chapter 2 opens on the scene just closed, and carries only itself', async () => {
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: /Chapter 2 — the scene/ })).toBeVisible();
    // Pre-filled with chapter 1's scene, because the next chapter is usually
    // the same place a moment later.
    await expect(sheet.locator('textarea.scene')).toHaveValue(SCENE_1);

    const scene2 =
      'The keeper’s cottage the same night, the fire lit for the first time since March.';
    await sheet.locator('textarea.scene').fill(scene2);
    await sheet.getByRole('button', { name: 'Open the chapter' }).click();
    await expect(composer(page)).toBeEnabled();

    await fillProse(composer(page), 'I put the kettle on.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await waitForTurn(page);

    const body = requests[requests.length - 1];
    const system = systemOf(body);
    expect(system).toContain(scene2);
    expect(system).not.toContain(SCENE_1);
    // The whole point of chapters: the previous transcript is gone, and only
    // the summary of it is carried forward.
    const wire = JSON.stringify(body['messages']);
    expect(wire).not.toContain('I climb, counting the steps.');
    expect(system).toContain('The story so far:');

    await expect.poll(() => server.ids('chapters')).toHaveLength(2);
    chapter2 = (await server.ids('chapters')).find((id) => id !== chapter1)!;
    // Wait for this turn to reach disk, not just for the file to exist: the
    // next stage opens a second browser that can only see what was written.
    await expect
      .poll(async () => (await server.document<any>('chapters', chapter2))?.['messages']?.length)
      .toBe(2);
  });

  test('10 · a browser with an empty cache reads the whole story back off disk', async ({
    browser,
  }) => {
    const fresh = await browser.newContext();
    const reader = await fresh.newPage();
    await reader.goto(server.url);

    await expect(reader.locator('li-top-bar')).toContainText(TITLE);
    await expect(reader.locator('li-top-bar')).toContainText('Chapter 2');
    await expect(reader.locator('article[data-role]')).toHaveCount(2);

    // Chapter 1 is still there, closed, with everything in it.
    await reader.getByRole('button', { name: 'Chapters' }).click();
    const list = reader.getByRole('dialog');
    await expect(list.getByText('closed', { exact: true })).toHaveCount(1);
    await expect(list).toContainText('6 messages');
    await close(list);

    // And the world came back too.
    await reader.getByRole('button', { name: 'World', exact: true }).click();
    const world = reader.getByRole('dialog');
    await expect(world.locator('li-editor-field textarea').first()).not.toBeEmpty();
    await world.getByRole('tab', { name: 'Lore' }).click();
    await expect(world.locator('.entry')).toContainText('Old Tomas');
    await fresh.close();
  });

  test('11 · what is on disk is the whole story, and nothing else', async () => {
    expect(await server.ids('stories')).toHaveLength(1);
    expect(await server.ids('chapters')).toEqual([chapter1, chapter2].sort());
    expect(await server.document('settings')).not.toBeNull();

    const story = await server.document<any>('stories', storyId);
    expect(story?.['world'].entries).toHaveLength(1);
    expect(story?.['world'].entries[0].keys).toEqual([LORE_KEY, 'keeper']);
    expect(story?.['activeChapterId']).not.toBe(chapter1);
  });
});
