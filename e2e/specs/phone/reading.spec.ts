import { expect, test } from '../fixtures';
import { assistantMessages, composer, send, waitForTurn } from '../helpers';
import { horizontalOverflow, margins, openMenu } from './helpers';

/**
 * The story on a phone: the page itself and the bar over it.
 *
 * The purpose here is one thing — carry on the story that was started on the
 * computer — so the test of the layout is what is *not* on screen. The bar is
 * three things, the story has the rest, and nothing is anywhere but where it
 * would be on a page of a book.
 */

test('the chapter reads edge to edge, with a gutter and no more', async ({ page, app }) => {
  await app.open();
  await send(page, 'Two lines, please.');
  await waitForTurn(page);

  const prose = assistantMessages(page).first().locator('.story-prose');
  const { left, right } = await margins(prose);
  // One rem each side at this width: the column is what is left of the screen.
  expect(left).toBeLessThanOrEqual(20);
  expect(right).toBeLessThanOrEqual(20);
  expect(left).toBeGreaterThan(0);

  // The reading column and the box under it are the same width, as they are at
  // every other width: one measure, not two.
  const box = await margins(page.locator('li-composer .box'));
  expect(box.left).toBe(left);
});

/**
 * A Pixel 7 is what this project runs as; an iPhone 15 is 19 CSS pixels
 * narrower and a good deal taller, and 320 is the narrowest screen anyone
 * still holds. The pointer and the touch events are the device's either way —
 * only the viewport moves, which is the whole of what these three ask about.
 */
test('nothing is wider than the screen, at any of the sizes people hold', async ({ page, app }) => {
  await app.open();
  expect(await horizontalOverflow(page)).toBe(0);

  await send(page, '!long');
  await waitForTurn(page);

  for (const size of [
    { width: 412, height: 915 },
    { width: 393, height: 852 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(size);
    expect(await horizontalOverflow(page)).toBe(0);
    // And the bar is still the three things it is meant to be, not a row that
    // has started wrapping or clipping its own menu.
    await expect(page.getByRole('button', { name: 'More actions' })).toBeVisible();
  }
});

test('the bar is the wordmark, the dot and one menu', async ({ page, app }) => {
  await app.open();

  const bar = page.locator('li-top-bar header');
  // The wordmark is what opens the story menu here, so it is a button rather
  // than the span it is at every other width — and that span is not drawn.
  await expect(bar.getByRole('button', { name: 'Lamplit' })).toBeVisible();
  await expect(bar.locator('.wordmark')).toBeHidden();
  await expect(bar.getByRole('button', { name: 'More actions' })).toBeVisible();

  // The three the desktop bar names are not in this one.
  for (const name of ['Story', 'World', 'Chapters']) {
    await expect(bar.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  // Nor is the model, which is the way into the connection and its parameters.
  await expect(bar.getByRole('button', { name: /Storyteller Large|Connect a model/ })).toHaveCount(
    0,
  );
});

test('the app’s own settings are not offered anywhere on a phone', async ({ page, app }) => {
  await app.open({ developerMode: true });

  await openMenu(page);
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Story…' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'World…' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Chapters…' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Chapter panel' })).toBeVisible();

  for (const name of [/Preferences/, /Parameters/, /Connection/, /Model/, /About/, /What.s new/]) {
    await expect(menu.getByRole('menuitem', { name })).toHaveCount(0);
  }

  // Developer mode was left on by the computer that shared this; the pill and
  // the prompt preview behind it are still the app talking about itself.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /^context/ })).toHaveCount(0);
});

test('the wordmark says which story and chapter, and offers the others', async ({ page, app }) => {
  await app.open({ title: 'The Lighthouse' });

  await page.getByRole('button', { name: 'Lamplit' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.locator('.where')).toContainText('The Lighthouse');
  await expect(menu.locator('.where')).toContainText('Chapter 1');
  await expect(menu.getByRole('menuitem', { name: 'New story…' })).toBeVisible();
});

test('the chapter is text until the end of it', async ({ page, app }) => {
  await app.open();

  await send(page, '!long');
  await waitForTurn(page);
  await page.locator('li-chapters-page .page').evaluate((el) => el.scrollTo(0, 0));

  // Scrolled up, the box is out of the way with everything else: no dock, no
  // toolbar, nothing holding the foot of a screen this small.
  const onScreen = (selector: string) =>
    page.locator(selector).evaluate((el) => {
      const port = el.closest('.page')!.getBoundingClientRect();
      const own = el.getBoundingClientRect();
      return own.bottom > port.top && own.top < port.bottom;
    });
  expect(await onScreen('li-composer .box')).toBe(false);
  expect(await onScreen('li-chapter-toolbar')).toBe(false);

  // And the box is still the box: reading is not a mode you leave.
  await expect(composer(page)).toHaveCount(1);
});
