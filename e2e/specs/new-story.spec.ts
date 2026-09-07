import { expect, test } from './fixtures';
import { captureRequests, openChapter, send, sheetSettled, systemOf, waitForTurn } from './helpers';

/**
 * Starting a second story from inside the first: the questions it asks, the
 * order it asks them in, and what backing out of them leaves behind.
 */

const NEWLINE = String.fromCharCode(10);

test('asks for mode and persona before the first scene', async ({ page, app }) => {
  await app.seed();
  const bodies = await captureRequests(page);
  await app.visit();

  await page.getByRole('button', { name: /The Lighthouse/ }).click();
  await page.getByRole('menuitem', { name: 'New story…' }).click();

  const setup = page.getByRole('dialog');
  await setup.getByLabel('Title').fill('The Jetty');
  await setup.getByLabel('Name').fill('Ines');
  await setup.getByRole('button', { name: 'Write the first scene' }).click();

  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: /Chapter 1 — the scene/ })).toBeVisible();
  // A new story starts on a blank scene: nothing is carried over from the last one.
  await expect(sheet.locator('textarea.scene')).toHaveValue('');
  await openChapter(page, 'The jetty, first light.');

  await expect(page.getByRole('button', { name: /The Jetty · Chapter 1/ })).toBeVisible();
  await send(page, 'I wait.');
  await waitForTurn(page);
  expect(systemOf(bodies[0])).toContain('The user plays Ines');
  expect(systemOf(bodies[0])).toContain('The jetty, first light.');
});

test('the persona box grows with what is typed, even in a short window', async ({ page, app }) => {
  // A short window is what made this fail: the sheet overflowed, and a flex
  // column shrinks its children rather than scrolling, so the box was pinned
  // at one line however much was typed into it.
  await page.setViewportSize({ width: 900, height: 520 });
  await app.open();

  await page.getByRole('button', { name: /The Lighthouse/ }).click();
  await page.getByRole('menuitem', { name: 'New story…' }).click();
  const box = page.getByRole('dialog').locator('textarea');
  await box.waitFor();
  // The dialog scales up as it opens, which moves the numbers this measures.
  // Waiting for the animation to be over says that; a sleep says "probably
  // by now", and is the one thing every flaky suite has in common.
  await sheetSettled(page);

  const state = () =>
    box.evaluate((el: HTMLTextAreaElement) => ({
      drawn: el.getBoundingClientRect().height,
      // Squashed by the flex column, the box would scroll its own text.
      scrolling: el.scrollHeight > el.clientHeight + 4,
    }));
  const short = await state();
  await box.fill(Array.from({ length: 9 }, (_, i) => `line ${i + 1}`).join(NEWLINE));
  const tall = await state();
  expect(tall.drawn).toBeGreaterThan(short.drawn + 80);
  expect(tall.scrolling).toBe(false);
});

test('backing out of the sheet creates nothing', async ({ page, app }) => {
  await app.open();

  await page.getByRole('button', { name: /The Lighthouse/ }).click();
  await page.getByRole('menuitem', { name: 'New story…' }).click();
  await page.getByRole('dialog').getByLabel('Title').fill('Never mind');
  await page.keyboard.press('Escape');

  await expect(page.getByRole('button', { name: /The Lighthouse · Chapter 1/ })).toBeVisible();
  await page.getByRole('button', { name: /The Lighthouse/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Never mind' })).toHaveCount(0);
});
