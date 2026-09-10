import { expect, test } from './fixtures';
import { captureRequests, openPromptPreview, send, systemOf, tailOf, waitForTurn } from './helpers';

/**
 * The world behind the story: what is true in it, which of it the scene and
 * the reader's own words call up, and the lore modal it is all written in.
 */

const entries = [
  {
    id: 'tomas',
    title: 'Old Tomas',
    category: 'person' as const,
    keys: ['tomas', 'keeper'],
    content: 'The lighthouse keeper, missing since spring.',
  },
  {
    id: 'lantern',
    title: 'The Lantern Room',
    category: 'place' as const,
    keys: ['lantern', 'lamp room'],
    content: 'Reached by a hundred and nine iron steps.',
  },
];

test('lore fires on the scene, and only on what is mentioned', async ({ page, app }) => {
  await app.open({ developerMode: true, entries, storySoFar: 'Mara has just arrived.' });

  await openPromptPreview(page);
  const preview = page.getByRole('dialog');
  await expect(preview.locator('li', { hasText: 'Old Tomas' })).toContainText(
    'fired on “keeper” in the scene',
  );
  await expect(preview.locator('li', { hasText: 'The Lantern Room' })).toHaveCount(0);
  await expect(preview.getByText('Mara has just arrived.')).toBeVisible();
  await preview.getByRole('button', { name: 'Done' }).click();

  // What the preview promised is what the request carries — in the block after
  // the new line, which is where an entry a keyword fired goes.
  const bodies = await captureRequests(page);
  await send(page, 'I look around.');
  await waitForTurn(page);
  expect(tailOf(bodies[0])).toContain('missing since spring');
  expect(tailOf(bodies[0])).not.toContain('hundred and nine iron steps');
  expect(systemOf(bodies[0])).not.toContain('missing since spring');
});

test('what the reader types can fire an entry too', async ({ page, app }) => {
  await app.seed({ entries });
  const bodies = await captureRequests(page);
  await app.visit();

  await send(page, 'I climb to the lantern.');
  await waitForTurn(page);
  expect(tailOf(bodies[0])).toContain('hundred and nine iron steps');
});

test('closing the modal saves what was typed into it', async ({ page, app }) => {
  await app.open({ developerMode: true });

  await page.getByRole('button', { name: 'World', exact: true }).click();
  const world = page.getByRole('dialog');
  await world.locator('li-editor-field textarea').fill('Mara has just arrived on the island.');
  // Escape closes and saves: there is no discard anywhere in the app.
  await page.keyboard.press('Escape');
  await expect(world).toBeHidden();

  await openPromptPreview(page);
  await expect(page.getByRole('dialog')).toContainText('Mara has just arrived on the island.');
});

test('an entry with nothing written in it says so', async ({ page, app }) => {
  await app.open();

  await page.getByRole('button', { name: 'World', exact: true }).click();
  const world = page.getByRole('dialog');
  await world.getByRole('tab', { name: 'Lore' }).click();
  await world.getByRole('button', { name: 'Add an entry' }).click();
  await page.getByRole('menuitem', { name: 'Person' }).click();

  const card = world.locator('.entry');
  await expect(card).toHaveClass(/unwritten/);
  await expect(card).toContainText('nothing to say yet');

  const text = card.locator('li-editor-field textarea');
  await text.fill('The lighthouse keeper, missing since spring.');
  await text.blur();
  await expect(card).not.toHaveClass(/unwritten/);
});

test('a new entry is on screen even when a search was in the way', async ({ page, app }) => {
  await app.open({ entries });

  await page.getByRole('button', { name: 'World', exact: true }).click();
  const world = page.getByRole('dialog');
  await world.getByRole('tab', { name: 'Lore' }).click();
  await world.getByRole('textbox', { name: 'Search' }).fill('tomas');
  await expect(world.locator('.entry')).toHaveCount(1);

  await world.getByRole('button', { name: 'Add an entry' }).click();
  await page.getByRole('menuitem', { name: 'Fact' }).click();

  // It has no title and no keys, so no search could have matched it.
  await expect(world.locator('.entry.open')).toHaveCount(1);
  await expect(world.locator('.entry.open')).toHaveClass(/unwritten/);
});

test('entries collapse to one line, and open one at a time', async ({ page, app }) => {
  await app.open({ entries });

  await page.getByRole('button', { name: 'World', exact: true }).click();
  const world = page.getByRole('dialog');
  await world.getByRole('tab', { name: 'Lore' }).click();

  // A world can hold dozens: they start closed, each one a single row.
  const cards = world.locator('.entry');
  await expect(cards).toHaveCount(2);
  await expect(world.locator('li-editor-field')).toHaveCount(0);
  await expect(world.locator('.entry', { hasText: 'Old Tomas' })).toContainText('tomas, keeper');

  await world.locator('.disclose', { hasText: 'Old Tomas' }).click();
  await expect(world.locator('li-editor-field')).toHaveCount(1);
  await expect(world.locator('.entry.open')).toContainText('What is true');

  await world.locator('.disclose', { hasText: 'Old Tomas' }).click();
  await expect(world.locator('li-editor-field')).toHaveCount(0);
});

test('switching to role-play changes the system prompt', async ({ page, app }) => {
  await app.seed({ persona: { name: 'Mara', description: 'a marine biologist' } });
  const bodies = await captureRequests(page);
  await app.visit();

  await send(page, 'Hello?');
  await waitForTurn(page);
  expect(systemOf(bodies[0])).toContain('You are the narrator');

  await page.getByRole('button', { name: 'Story', exact: true }).click();
  const story = page.getByRole('dialog');
  await story.getByRole('button', { name: /Role-play/ }).click();
  await story.getByRole('button', { name: 'Add a character' }).click();
  await story.getByLabel('Name').first().fill('Tomas');
  await story.getByLabel('Name').first().blur();
  await story.getByRole('button', { name: 'Done' }).click();

  await send(page, 'Hello again?');
  await waitForTurn(page);
  const system = systemOf(bodies[1]);
  expect(system).toContain('You are playing Tomas.');
  expect(system).toContain('never write words, thoughts or actions for Mara');
});
