import { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { captureRequests, send, STORY_ID, tailOf, waitForTurn } from './helpers';
import type { PersistenceServer } from './persistence-server';

/**
 * Closing a chapter can also ask what the chapter established. Off unless the
 * story says otherwise, proposed rather than written, and never in the way of
 * the close itself.
 */

/** The town the fake endpoint will propose an entry for, planted in the story. */
const TOWN = 'I ask her how far it is to Ashport.';

const TOMAS = {
  id: 'lore-tomas',
  title: 'Old Tomas',
  keys: ['tomas', 'keeper'],
  content: 'Kept the light for nineteen years before Mara’s father.',
};

function review(page: Page): Locator {
  return page.getByRole('dialog');
}

function proposals(page: Page): Locator {
  return page.locator('.proposal');
}

/** Waits for the second request to have been answered, or for it not to come. */
async function openReview(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Close chapter' }).click();
  await expect(review(page).locator('textarea').first()).not.toBeEmpty();
}

async function turnOn(server: PersistenceServer): Promise<void> {
  const story = (await server.document('stories', STORY_ID))!;
  const world = story['world'] as Record<string, unknown>;
  await server.seed({
    [`story:${STORY_ID}`]: { ...story, world: { ...world, extractLore: true } },
  });
}

/** The lore entries on disk, after a close. */
async function entries(server: PersistenceServer): Promise<Record<string, any>[]> {
  const story = await server.document('stories', STORY_ID);
  return ((story?.['world'] as Record<string, any>)?.['entries'] ?? []) as Record<string, any>[];
}

test('off: closing a chapter makes exactly one request', async ({ page, app }) => {
  await app.seed();
  const bodies = await captureRequests(page);
  await app.visit();

  await send(page, TOWN);
  await waitForTurn(page);
  const written = bodies.length;

  await openReview(page);
  // Waiting for the summary to *finish* rather than to start: the lore request
  // is made after it resolves, so a check made while it is still streaming
  // asks the question before the answer could exist either way.
  await expect(review(page).getByRole('button', { name: 'Write it again' })).toBeVisible();

  // The summary, and nothing else: no second request, and nothing proposed.
  expect(bodies.filter((body) => body['stream'] === false)).toEqual([]);
  expect(bodies.length).toBe(written + 1);
  await expect(proposals(page)).toHaveCount(0);
  await expect(review(page).getByRole('button', { name: 'Propose lore' })).toBeVisible();
});

test('on: the chapter is read back, and what is ticked is filed', async ({ page, server, app }) => {
  await app.seed();
  await turnOn(server);
  await app.visit();

  await send(page, TOWN);
  await waitForTurn(page);
  await openReview(page);

  const town = proposals(page).filter({ hasText: 'Ashport' });
  await expect(town).toBeVisible();
  await expect(town).toContainText('place');
  await expect(town.locator('.key')).toHaveText(['ashport', 'the town']);
  // A new entry is additive, so it arrives ticked.
  await expect(town.locator('input')).toBeChecked();

  await review(page).getByRole('button', { name: 'Close the chapter' }).click();
  // The next chapter's scene sheet, which is the proof the close went through
  // rather than being answered a second time on its way out. Escape is for
  // that sheet, and pressing it before it is there lands on this one.
  await expect(page.getByRole('heading', { name: /Chapter 2/ })).toBeVisible();
  await page.keyboard.press('Escape');

  await expect
    .poll(async () => (await entries(server)).map((e) => e['title']))
    .toEqual(['Ashport']);
  const [filed] = await entries(server);
  expect(filed['category']).toBe('place');
  expect(filed['keys']).toEqual(['ashport', 'the town']);
  expect(filed['enabled']).toBe(true);
  expect(filed['alwaysOn']).toBe(false);
});

test('a filed entry reaches the next chapter’s prompt when it is mentioned', async ({
  page,
  server,
  app,
}) => {
  await app.seed();
  await turnOn(server);
  const bodies = await captureRequests(page);
  await app.visit();

  await send(page, TOWN);
  await waitForTurn(page);
  await openReview(page);
  await expect(proposals(page).filter({ hasText: 'Ashport' })).toBeVisible();
  await review(page).getByRole('button', { name: 'Close the chapter' }).click();

  // Chapter 2 opens on its scene sheet; a scene that mentions the town.
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: /Chapter 2/ })).toBeVisible();
  await sheet.locator('textarea.scene').fill('The Ashport ferry, first light.');
  await sheet.getByRole('button', { name: 'Open the chapter' }).click();

  await send(page, 'I buy a ticket.');
  await waitForTurn(page);

  // A keyed entry, so it goes last in the request rather than into the leading
  // system message: what fires comes and goes, and the front of the prompt is
  // what a provider's cache is keyed on.
  const tail = tailOf(bodies[bodies.length - 1]);
  expect(tail).toContain('What is true in this world:');
  expect(tail).toContain('nine hundred at the mouth of the estuary');
});

test('an update shows what it would overwrite, and waits to be asked', async ({
  page,
  server,
  app,
}) => {
  await app.seed({ entries: [TOMAS] });
  await turnOn(server);
  await app.visit();

  await send(page, `${TOWN} And whether Old Tomas ever came back.`);
  await waitForTurn(page);
  await openReview(page);

  const update = proposals(page).filter({ hasText: 'Old Tomas' });
  await expect(update).toContainText('replaces an entry');
  await expect(update).toContainText('boarding the Ashport ferry');
  // Both texts, because an update overwrites one the writer wrote.
  await expect(update.locator('.was')).toContainText('nineteen years');
  await expect(update.locator('input')).not.toBeChecked();

  await review(page).getByRole('button', { name: 'Close the chapter' }).click();
  // The next chapter's scene sheet, which is the proof the close went through
  // rather than being answered a second time on its way out. Escape is for
  // that sheet, and pressing it before it is there lands on this one.
  await expect(page.getByRole('heading', { name: /Chapter 2/ })).toBeVisible();
  await page.keyboard.press('Escape');

  // Unticked, so it was not applied — and the new entry beside it was.
  await expect.poll(async () => (await entries(server)).length).toBe(2);
  const tomas = (await entries(server)).find((e) => e['title'] === 'Old Tomas');
  expect(tomas?.['content']).toContain('nineteen years');
});

test('ticking the update rewrites the entry where it stands', async ({ page, server, app }) => {
  await app.seed({ entries: [TOMAS] });
  await turnOn(server);
  await app.visit();

  await send(page, `${TOWN} And whether Old Tomas ever came back.`);
  await waitForTurn(page);
  await openReview(page);

  const update = proposals(page).filter({ hasText: 'Old Tomas' });
  await update.locator('input').check();
  await review(page).getByRole('button', { name: 'Close the chapter' }).click();
  // The next chapter's scene sheet, which is the proof the close went through
  // rather than being answered a second time on its way out. Escape is for
  // that sheet, and pressing it before it is there lands on this one.
  await expect(page.getByRole('heading', { name: /Chapter 2/ })).toBeVisible();
  await page.keyboard.press('Escape');

  await expect
    .poll(async () => (await entries(server)).find((e) => e['id'] === TOMAS.id)?.['content'])
    .toContain('boarding the Ashport ferry');
  // Rewritten, not added beside itself.
  expect((await entries(server)).filter((e) => e['title'] === 'Old Tomas')).toHaveLength(1);
});

test('the button proposes on a story that never asked for it', async ({ page, server, app }) => {
  await app.open();

  await send(page, TOWN);
  await waitForTurn(page);
  await openReview(page);
  await expect(proposals(page)).toHaveCount(0);

  await review(page).getByRole('button', { name: 'Propose lore' }).click();
  await expect(proposals(page).filter({ hasText: 'Ashport' })).toBeVisible();
  // Nothing is written by proposing: cancelling leaves the world alone.
  await review(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(review(page)).toBeHidden();
  expect(await entries(server)).toEqual([]);
});

test('an endpoint that refuses response_format still answers', async ({ page, server, app }) => {
  // The model whose row 400s on `response_format`, the way plenty of local
  // servers do; the retry drops it and the answer comes back fenced.
  await app.seed();
  const settings = (await server.document('settings'))!;
  const connection = settings['connection'] as Record<string, unknown>;
  await server.seed({
    settings: { ...settings, connection: { ...connection, model: 'fake/no-json-schema' } },
  });
  await turnOn(server);
  const bodies = await captureRequests(page);
  await app.visit();

  await send(page, TOWN);
  await waitForTurn(page);
  await openReview(page);

  await expect(proposals(page).filter({ hasText: 'Ashport' })).toBeVisible();
  // Asked for once, refused, and asked again without it.
  const asked = bodies.filter((b) => b['stream'] === false);
  expect(asked).toHaveLength(2);
  expect(asked[0]['response_format']).toBeTruthy();
  expect(asked[1]['response_format']).toBeUndefined();
});

test('a failed extraction is a muted line, and the close still works', async ({
  page,
  server,
  app,
}) => {
  await app.seed();
  await turnOn(server);
  await app.visit();

  // !nolore fails the second request and only the second request.
  await send(page, `${TOWN} !nolore`);
  await waitForTurn(page);
  await openReview(page);

  await expect(review(page)).toContainText('No entries came back');
  await expect(proposals(page)).toHaveCount(0);

  // The summary is there, and the close goes through: a chapter is not held up
  // by the half of this that is meant to save typing.
  await review(page).getByRole('button', { name: 'Close the chapter' }).click();
  await expect(page.getByRole('heading', { name: /Chapter 2/ })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await entries(server)).toEqual([]);
});

test('cancelling the review leaves the chapter open and the world alone', async ({
  page,
  server,
  app,
}) => {
  await app.seed({ storySoFar: 'Mara arrived on the island.' });
  await turnOn(server);
  await app.visit();

  await send(page, TOWN);
  await waitForTurn(page);
  await openReview(page);
  await expect(proposals(page).filter({ hasText: 'Ashport' })).toBeVisible();

  await review(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(review(page)).toBeHidden();

  // Nothing at all: not the entries, not the summary over the story so far,
  // and not the chapter, which is still the one being written into.
  expect(await entries(server)).toEqual([]);
  const story = (await server.document('stories', STORY_ID))!;
  expect((story['world'] as Record<string, unknown>)['storySoFar']).toBe(
    'Mara arrived on the island.',
  );
  const chapter = await server.document('chapters', 'chapter-under-test');
  expect(chapter?.['status']).toBe('writing');
  await expect(page.getByRole('button', { name: 'Close chapter' })).toBeVisible();
});
