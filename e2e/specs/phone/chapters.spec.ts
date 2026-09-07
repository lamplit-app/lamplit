import { expect, test } from '../fixtures';
import {
  actFromMenu,
  assistantMessages,
  closeChapter,
  messages,
  send,
  sheetSettled,
  waitForTurn,
} from '../helpers';
import { openMenu } from './helpers';

/**
 * Writing a chapter with a thumb: what a message offers when there is no
 * margin to put it in, what a sheet is when there is no room to float one, and
 * the chapter's own turning points — which stay on the phone, because closing a
 * chapter is the story rather than the app.
 */

test('a message’s actions are behind the ⋯, and there is no rail', async ({ page, app }) => {
  await app.open();
  await send(page, 'Two lines, please.');
  await waitForTurn(page);

  const message = assistantMessages(page).first();
  // No margin to write in and no pointer to hover with, so the rail that holds
  // these on a desktop is not drawn at all.
  await expect(message.locator('.rail')).toBeHidden();

  const more = message.getByRole('button', { name: 'Message actions' });
  await expect(more).toBeVisible();
  // Big enough to be hit with a thumb rather than aimed at with a mouse.
  const box = (await more.boundingBox())!;
  expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);

  await actFromMenu(page, message, 'Copy');
  // The menu closed on the action, which is all the app can promise about a
  // clipboard a headless browser may refuse.
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('the same actions still act: a message deleted from the menu is gone', async ({
  page,
  app,
}) => {
  await app.open();
  await send(page, 'A line to delete.');
  await waitForTurn(page);
  await expect(messages(page)).toHaveCount(2);

  await actFromMenu(page, assistantMessages(page).first(), 'Delete');
  await expect(messages(page)).toHaveCount(1);
});

test('a sheet is the whole screen, and its buttons are where the thumb is', async ({
  page,
  app,
}) => {
  await app.open();

  await openMenu(page);
  await page.getByRole('menuitem', { name: 'Story…' }).click();

  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await sheetSettled(page);

  const viewport = (await page.viewportSize())!;
  const box = (await sheet.boundingBox())!;
  expect(Math.round(box.width)).toBe(viewport.width);
  expect(Math.round(box.height)).toBe(viewport.height);

  // The actions are the last thing above the foot of the screen, not the last
  // thing at the end of a scroll.
  const actions = (await sheet.locator('mat-dialog-actions').boundingBox())!;
  expect(viewport.height - (actions.y + actions.height)).toBeLessThan(8);

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('a chapter is closed and the next one opened, all from the phone', async ({ page, app }) => {
  await app.open();
  await send(page, 'Two lines, please.');
  await waitForTurn(page);

  await closeChapter(page, 'She went up the stairs and did not come down.');

  // The scene sheet for the next chapter arrives over the page.
  const scene = page.getByRole('dialog');
  await expect(scene).toBeVisible();
  await scene.locator('textarea.scene').fill('The cottage, the same night.');
  await scene.getByRole('button', { name: 'Open the chapter' }).click();
  await expect(scene).toBeHidden();

  await expect(page.locator('li-chapter-toolbar')).toContainText('Chapter 2');
});
