import { expect, test } from './fixtures';
import type { PersistenceServer } from './persistence-server';
import {
  captureRequests,
  CHAPTER_ID,
  chapterPanel,
  composer,
  fillProse,
  openPanel,
  openPromptPreview,
  panelSection,
  SCENE,
  send,
  systemOf,
  waitForTurn,
} from './helpers';

/**
 * The chapter panel: the scene, the narrator, the persona and the cast, beside
 * the page rather than over it.
 */

const LANTERN = 'The lantern room, an hour before dusk. The lamp is already lit.';

/** The settings document has to land before a reload can read it back. */
async function waitForUi(server: PersistenceServer, field: string, value: unknown): Promise<void> {
  await expect
    .poll(async () => {
      const settings = await server.document('settings');
      return (settings?.['ui'] as Record<string, unknown> | undefined)?.[field];
    })
    .toEqual(value);
}

test('the scene is edited beside the page, and the next request carries it', async ({
  page,
  app,
}) => {
  await app.seed();
  const bodies = await captureRequests(page);
  await app.visit();

  await openPanel(page);
  const scene = panelSection(page, 'scene').locator('textarea');
  await expect(scene).toHaveValue(SCENE);

  // The mark appears once the text differs from the document, and leaving the
  // field is what commits it — the same bargain every other field here makes.
  await scene.fill(LANTERN);
  await expect(panelSection(page, 'scene').getByRole('button', { name: 'Save' })).toBeVisible();
  await scene.blur();
  await expect(panelSection(page, 'scene').getByRole('button', { name: 'Save' })).toHaveCount(0);

  await send(page, 'I climb the stairs.');
  await waitForTurn(page);
  expect(systemOf(bodies[0])).toContain(LANTERN);
});

test('a closed chapter shows its scene and will not take a change to it', async ({
  page,
  server,
  app,
}) => {
  await app.seed();
  const chapter = (await server.document('chapters', CHAPTER_ID))!;
  await server.seed({ [`chapter:${CHAPTER_ID}`]: { ...chapter, status: 'closed' } });
  await app.visit();

  await openPanel(page);
  const scene = panelSection(page, 'scene').locator('textarea');
  await expect(scene).toHaveValue(SCENE);
  await expect(scene).toHaveJSProperty('readOnly', true);
  await expect(panelSection(page, 'scene')).toContainText('closed');
});

test('it is where it was left, folds and all, after a reload', async ({ page, server, app }) => {
  await app.open();

  await openPanel(page);
  await panelSection(page, 'persona').getByRole('button', { name: 'Persona' }).click();
  await expect(panelSection(page, 'persona').locator('textarea')).toHaveCount(0);
  await waitForUi(server, 'sidebarOpen', true);
  await waitForUi(server, 'sidebarSections', { persona: false });

  await page.reload();
  await expect(
    chapterPanel(page).getByRole('button', { name: 'Close the chapter panel' }),
  ).toBeVisible();
  // Scene is open because nothing was said about it; persona is shut because
  // something was.
  await expect(panelSection(page, 'scene').locator('textarea')).toBeVisible();
  await expect(panelSection(page, 'persona').locator('textarea')).toHaveCount(0);
});

test('narrow, it comes over the page and Escape gives the page back', async ({ page, app }) => {
  await app.seed();
  await page.setViewportSize({ width: 900, height: 800 });
  await app.visit();

  await openPanel(page);
  await expect(chapterPanel(page).locator('.scrim')).toBeVisible();

  // The composer is under the scrim but not gone: the chapter is still being
  // written, and what is in the box stays there.
  await fillProse(composer(page), 'I do not move.');
  await expect(composer(page)).toHaveText('I do not move.');

  await page.keyboard.press('Escape');
  await expect(chapterPanel(page).locator('.scrim')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open the chapter panel' })).toBeVisible();
  // Escape closed the panel and nothing else.
  await expect(composer(page)).toHaveText('I do not move.');
});

test('wide, it takes its width out of the page and covers none of it', async ({ page, app }) => {
  await app.seed();
  await page.setViewportSize({ width: 1400, height: 900 });
  await app.visit();

  const reading = page.locator('li-chapters-page');
  const before = (await reading.boundingBox())!.width;

  await openPanel(page);
  await expect(chapterPanel(page).locator('.scrim')).toHaveCount(0);

  const narrowed = (await reading.boundingBox())!;
  const sheet = (await chapterPanel(page).locator('.panel').boundingBox())!;
  expect(narrowed.width).toBeLessThan(before);
  // Beside, not on top: the page ends where the panel begins.
  expect(narrowed.x + narrowed.width).toBeLessThanOrEqual(sheet.x + 1);
});

test('the narrator default is adopted by writing into it, and given back by the link', async ({
  page,
  app,
}) => {
  await app.open();
  await openPanel(page);

  const narrator = panelSection(page, 'narrator').locator('textarea');
  await expect(narrator).toHaveValue(/You are the narrator of an ongoing story/);

  await narrator.fill('Write it as a diary, in the first person.');
  await narrator.blur();
  await expect(panelSection(page, 'narrator')).toContainText('your own');

  // The Story sheet is the same document, seen from the other side.
  await page.getByRole('button', { name: 'Story', exact: true }).click();
  const override = page.getByRole('switch', { name: 'Write my own narrator instructions' });
  await expect(override).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(override).toBeHidden();

  await panelSection(page, 'narrator').getByRole('button', { name: 'Back to the default' }).click();
  await expect(narrator).toHaveValue(/You are the narrator of an ongoing story/);
  await expect(panelSection(page, 'narrator')).toContainText('default');
});

/**
 * The narrator instruction, in the three places it is shown and the one place
 * it is sent, with the box emptied.
 *
 * That state — the override on and nothing written — is the one the app used to
 * disagree with itself about: the panel and the Story sheet showed the
 * document, which is empty, and the request fell back to the instruction
 * Lamplit ships. So the app showed an empty narrator and sent a full one, and
 * the guide's promise that "What the model sees" is what goes on the wire was
 * false for exactly one setting.
 */
test('an emptied narrator box shows what is being sent, everywhere it is shown', async ({
  page,
  app,
}) => {
  await app.open({ developerMode: true });
  await openPanel(page);

  const narrator = panelSection(page, 'narrator').locator('textarea');
  await narrator.fill('Write it as a diary, in the first person.');
  await narrator.blur();
  await expect(panelSection(page, 'narrator')).toContainText('your own');

  // Emptied by hand, which leaves the override on and the document blank.
  await narrator.fill('');
  await narrator.blur();
  await expect(panelSection(page, 'narrator')).toContainText('default');
  await expect(narrator).toHaveValue(/You are the narrator of an ongoing story/);

  // The Story sheet: the switch is still on, so the box is still there — with
  // the words that are being sent in it, dimmed, as in the panel.
  await page.getByRole('button', { name: 'Story', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(
    sheet.getByRole('switch', { name: 'Write my own narrator instructions' }),
  ).toHaveAttribute('aria-checked', 'true');
  // `exact`, or the switch beside it — "Write my own narrator instructions" —
  // is a second match for the words.
  await expect(sheet.getByLabel('Narrator instructions', { exact: true })).toHaveValue(
    /You are the narrator of an ongoing story/,
  );
  await page.keyboard.press('Escape');

  // And what the model sees, which is the answer the other two now give.
  await openPromptPreview(page);
  await expect(page.getByRole('dialog')).toContainText('You are the narrator of an ongoing story');
});

test('a cast row says who they are, and the edit mark opens the sheet on them', async ({
  page,
  app,
}) => {
  await app.open({
    mode: 'roleplay',
    characters: [
      {
        id: 'nell',
        name: 'Nell',
        description: 'Kept the light with Tomas.\nSpeaks plainly, and never twice.',
        enabled: true,
      },
    ],
  });
  await openPanel(page);

  const row = panelSection(page, 'cast').locator('.cast-row');
  await expect(row).toContainText('Nell');
  await expect(row).toContainText('Kept the light with Tomas.');
  // One line of it, not the paragraph: the row is a mention, not the record.
  await expect(row).not.toContainText('never twice');

  await row.getByRole('button', { name: 'Edit Nell' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.locator('[data-character="nell"] input').first()).toBeFocused();
});

/**
 * Escape is answered by one thing at a time, and by the thing nearest the
 * reader. A menu opened from inside the panel is over the panel: closing it is
 * the whole of what the key was for, and taking the panel away with it loses
 * the section that menu was opened from.
 */
test('narrow, Escape closes the menu it was pressed for and leaves the panel', async ({
  page,
  app,
}) => {
  await app.seed({
    mode: 'roleplay',
    characters: [
      { id: 'nell', name: 'Nell', description: 'The keeper.', enabled: true },
      { id: 'isa', name: 'Isa', description: 'The harbourmaster’s daughter.', enabled: true },
    ],
  });
  await page.setViewportSize({ width: 900, height: 800 });
  await app.visit();
  await openPanel(page);
  await expect(chapterPanel(page).locator('.scrim')).toBeVisible();

  // The dot beside a character's name: the menu that changes their colour.
  await chapterPanel(page).locator('li-character-swatch button').first().click();
  const menu = page.locator('.mat-mdc-menu-panel');
  await expect(menu).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(menu).toBeHidden();
  await expect(chapterPanel(page).locator('.scrim')).toBeVisible();
});
