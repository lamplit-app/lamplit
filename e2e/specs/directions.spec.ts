import { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  captureRequests,
  CHAPTER_ID,
  composer,
  fillProse,
  openPromptPreview,
  promptBlocks,
  proseEditor,
  send,
  systemOf,
  waitForTurn,
} from './helpers';

/**
 * The author's voice: a direction the model is told to follow, written beside
 * the persona's words rather than inside them, and kept out of everything the
 * story is later summarised from.
 */

/** The author's half of a message, as the page draws it. */
function directions(page: Page): Locator {
  return page.locator('article[data-role] .direction');
}

function authorToggle(page: Page): Locator {
  return page.locator('li-composer button.author');
}

function authorField(page: Page): Locator {
  return page.locator('li-composer .direction textarea');
}

/** The user messages of the last request, which is where a direction shows up. */
function userLines(body: Record<string, unknown> | undefined): string[] {
  return ((body?.['messages'] ?? []) as { role: string; content: string }[])
    .filter((m) => m.role === 'user')
    .map((m) => m.content);
}

test('[AUTHOR] splits the message before it is sent, and both halves go out', async ({
  page,
  app,
}) => {
  await app.seed();
  const bodies = await captureRequests(page);
  await app.visit();

  // Typed as one line of text; the composer takes the tag out of the prose the
  // moment it closes and the rest is typed where the caret went — into the
  // author's field, leading space and all — so the split is visible before Send.
  await fillProse(composer(page), 'Mara pushes the door open.\n[AUTHOR] The room is empty.');
  await expect(composer(page)).toHaveText('Mara pushes the door open.');
  await expect(authorField(page)).toHaveValue(/^\s*The room is empty\.$/);
  await expect(authorToggle(page)).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await waitForTurn(page);

  // On the page: prose as prose, the direction as a note that is not prose.
  await expect(page.locator('article[data-role="user"] .story-prose')).toHaveText(
    'Mara pushes the door open.',
  );
  await expect(directions(page)).toHaveText(/author\s*The room is empty\./);

  // On the wire: one message, the direction bracketed under the prose.
  expect(userLines(bodies[0])).toEqual([
    'Mara pushes the door open.\n\n[Author: The room is empty.]',
  ]);
  expect(systemOf(bodies[0])).toContain('[Author: …]');

  // And the field is empty again, closed, ready for a line that is only prose.
  await expect(authorField(page)).toHaveCount(0);
  await expect(authorToggle(page)).toHaveAttribute('aria-pressed', 'false');
});

test('the Author button opens the field directly, and sends a direction alone', async ({
  page,
  app,
}) => {
  await app.seed();
  const bodies = await captureRequests(page);
  await app.visit();

  await authorToggle(page).click();
  await authorField(page).fill('The storm arrives tonight.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await waitForTurn(page);

  // Nothing was said as the persona, so nothing but the direction goes out.
  expect(userLines(bodies[0])).toEqual(['[Author: The storm arrives tonight.]']);
  await expect(directions(page)).toHaveText(/author\s*The storm arrives tonight\./);
  await expect(page.locator('article[data-role="user"] .story-prose')).toHaveCount(0);

  // It is still in the chapter three turns later.
  await send(page, 'I look at the sky.');
  await waitForTurn(page);
  expect(userLines(bodies[bodies.length - 1])[0]).toBe('[Author: The storm arrives tonight.]');
});

test('closing the field throws the direction away rather than sending it quietly', async ({
  page,
  app,
}) => {
  await app.seed();
  const bodies = await captureRequests(page);
  await app.visit();

  await authorToggle(page).click();
  await authorField(page).fill('She should refuse.');
  await authorToggle(page).click();
  await expect(authorField(page)).toHaveCount(0);

  await send(page, 'I ask her again.');
  await waitForTurn(page);

  expect(userLines(bodies[0])).toEqual(['I ask her again.']);
  expect(systemOf(bodies[0])).not.toContain('[Author: …]');
});

test('the Author block sits last and has no handle', async ({ page, app }) => {
  await app.open({ developerMode: true });

  await authorToggle(page).click();
  await authorField(page).fill('The room is empty.');
  await openPromptPreview(page);

  const names = await promptBlocks(page);
  expect(names.at(-1)).toBe('Author');
  expect(names.at(-2)).toBe('Style');

  // Pinned: no handle of its own, and a reason where the handle would be.
  const author = page
    .locator('mat-dialog-content .block')
    .filter({ has: page.locator('.name', { hasText: /^Author$/ }) });
  await expect(author.locator('.handle')).toHaveCount(0);
  await expect(author).toContainText('outranks every instruction above it');

  // What the next message will carry, as it will carry it.
  await expect(
    page.locator('mat-dialog-content .block').filter({ hasText: 'Your next message' }),
  ).toContainText('[Author: The room is empty.]');
});

test('a direction is not in the summary the chapter closes with', async ({ page, app }) => {
  await app.seed();
  const bodies = await captureRequests(page);
  await app.visit();

  await fillProse(composer(page), 'Mara pushes the door open.\n[AUTHOR] The room is empty.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await waitForTurn(page);

  await page.getByRole('button', { name: 'Close chapter' }).click();
  const review = page.getByRole('dialog');
  await expect(review.locator('textarea')).not.toBeEmpty();

  const asked = bodies[bodies.length - 1];
  const summaryRequest = userLines(asked).join('\n');
  expect(summaryRequest).toContain('Mara pushes the door open.');
  expect(summaryRequest).not.toContain('The room is empty.');
  expect(summaryRequest).not.toContain('[Author:');
});

test('editing a message edits both halves of it', async ({ page, server, app }) => {
  await app.open();

  await fillProse(composer(page), 'Mara pushes the door open.\n[AUTHOR] The room is empty.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await waitForTurn(page);

  const message = page.locator('article[data-role="user"]').first();
  await message.hover();
  await message.getByRole('button', { name: 'Edit' }).click();

  await fillProse(proseEditor(message), 'Mara pushes the door open, slowly.');
  await message.locator('textarea').fill('The room is empty, and it should not be.');
  await message.getByRole('button', { name: 'Save' }).click();

  await expect(message.locator('.story-prose')).toHaveText('Mara pushes the door open, slowly.');
  await expect(message.locator('.direction')).toContainText('and it should not be');

  // Both halves are on disk, still apart.
  await expect
    .poll(async () => {
      const chapter = await server.document('chapters', CHAPTER_ID);
      const first = ((chapter?.['messages'] ?? []) as Record<string, unknown>[])[0];
      return [first?.['content'], first?.['direction']];
    })
    .toEqual(['Mara pushes the door open, slowly.', 'The room is empty, and it should not be.']);
});
