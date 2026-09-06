import { expect, test } from './fixtures';
import {
  assistantMessages,
  captureRequests,
  composer,
  expectComposerHidden,
  FAKE_API_URL,
  openChapter,
  SCENE,
  send,
  systemOf,
  waitForTurn,
} from './helpers';

/**
 * An empty data folder: the three questions the app asks before a word can be
 * written, in the order it asks them, and what happens to someone who answers
 * only the ones they have to.
 */

test('asks for the connection, then who tells it, then for a scene', async ({ page, app }) => {
  await app.visit();

  // Nothing is stored, so the connection is the first thing on screen: no
  // other question means anything until the app has somewhere to send the
  // story, and this sheet does not take Escape for an answer.
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: /somewhere to send the story/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Done' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('heading', { name: /somewhere to send the story/ })).toBeVisible();

  await dialog.getByLabel('Provider').selectOption('custom');
  await dialog.getByLabel('Endpoint URL').fill(FAKE_API_URL);

  await dialog.getByRole('button', { name: 'Fetch models' }).click();
  await expect(dialog.getByText('3 models', { exact: true })).toBeVisible();

  await dialog.getByLabel('Model', { exact: true }).selectOption('fake/storyteller-large');

  await dialog.getByRole('button', { name: 'Test' }).click();
  await expect(dialog.getByText(/The model answered/)).toBeVisible({ timeout: 20_000 });

  // Answered, so the way on lights up.
  const done = dialog.getByRole('button', { name: 'Done' });
  await expect(done).toBeEnabled();
  await done.click();

  // Only then the story questions.
  const setup = page.getByRole('dialog');
  await expect(setup.getByRole('heading', { name: 'Your first story' })).toBeVisible();
  await setup.getByLabel('Title').fill('The Lighthouse');
  await setup.getByRole('button', { name: /Role-play/ }).click();
  await setup.getByLabel('Name').fill('Mara');
  await setup.getByRole('button', { name: 'Write the first scene' }).click();

  // Then the scene sheet, and only then can anything be written.
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: /Chapter 1 — the scene/ })).toBeVisible();
  await openChapter(page, SCENE);

  await expect(page.getByRole('button', { name: /The Lighthouse/ })).toBeVisible();
  await expect(composer(page)).toBeEnabled();

  const bodies = await captureRequests(page);
  await send(page, 'Begin.');
  await waitForTurn(page);
  await expect(assistantMessages(page)).toHaveCount(1);
  // What the first sheet asked for is in the very first request.
  expect(systemOf(bodies[0])).toContain('never write words, thoughts or actions for Mara');
});

test('the way out of the connection sheet leaves the app blocked, and says so', async ({
  page,
  app,
}) => {
  await app.visit();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: /somewhere to send the story/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Not now' }).click();

  // The flow carries on from where it was: the story questions, then the
  // scene.
  const setup = page.getByRole('dialog');
  await expect(setup.getByRole('heading', { name: 'Your first story' })).toBeVisible();
  await setup.getByRole('button', { name: 'Cancel' }).click();

  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: /Chapter 1 — the scene/ })).toBeVisible();
  await openChapter(page, SCENE);

  // With a scene written and still nowhere to send it, the composer is the
  // one saying so — rather than a modal that cannot be dismissed.
  await expectComposerHidden(page, /Pick a model|endpoint URL/);
});
