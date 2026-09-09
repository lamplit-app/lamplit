import { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  captureRequests,
  CHAPTER_ID,
  notesOf,
  openPanel,
  openPromptPreview,
  panelSection,
  send,
  systemOf,
  waitForTurn,
} from './helpers';

/**
 * Role-play with a cast: the ensemble the app has always sent, and the one
 * character at a time it can send instead.
 */

const CAST = [
  { id: 'nell', name: 'Nell', description: 'Kept the light with Tomas.', enabled: true },
  { id: 'tomas', name: 'Tomas', description: 'The keeper before her father.', enabled: true },
  { id: 'isa', name: 'Isa', description: 'The harbourmaster’s daughter.', enabled: true },
];

/** The panel's cast list, which is where a character is switched to. */
const cast = (page: Page): Locator => panelSection(page, 'cast');

test('an ensemble is played by everyone, and there is nobody to switch to', async ({
  page,
  app,
}) => {
  // No `roleplay` in the document at all: a story from before casting existed.
  await app.seed({ mode: 'roleplay', characters: CAST });
  const bodies = await captureRequests(page);
  await app.visit();

  await send(page, 'I climb the stairs.');
  await waitForTurn(page);

  // How they are played, then who: the instruction is sent with every request
  // of a role-play story, including one written before there was one.
  expect(systemOf(bodies[0])).toContain('You are taking part in a role-play with the user');
  expect(systemOf(bodies[0])).toContain('You are playing Nell, Tomas and Isa.');
  expect(notesOf(bodies[0])).toEqual([]);

  // Nothing to be switched to, so a row is a row rather than a choice.
  await openPanel(page);
  await expect(cast(page).getByRole('button', { name: /^Play / })).toHaveCount(0);
  await expect(cast(page)).toContainText('3 characters');
});

test('one at a time: the model is told who it is, and who it may only watch', async ({
  page,
  app,
}) => {
  await app.seed({
    mode: 'roleplay',
    characters: CAST,
    persona: { name: 'Mara', description: 'a marine biologist' },
    roleplay: { casting: 'one-at-a-time', activeCharacterId: 'nell' },
  });
  const bodies = await captureRequests(page);
  await app.visit();

  await send(page, 'I climb the stairs.');
  await waitForTurn(page);

  const system = systemOf(bodies[0]);
  expect(system).toContain('You are playing Nell, and nobody else.');
  expect(system).toContain('Also in the scene: Tomas and Isa.');
  expect(system).toContain('never write words, thoughts or actions for Mara, Tomas or Isa');
});

test('switching mid-chapter is told to the model, and the next answer is signed', async ({
  page,
  server,
  app,
}) => {
  await app.seed({
    developerMode: true,
    mode: 'roleplay',
    characters: CAST,
    roleplay: { casting: 'one-at-a-time', activeCharacterId: 'nell' },
  });
  const bodies = await captureRequests(page);
  await app.visit();

  await send(page, 'I climb the stairs.');
  await waitForTurn(page);

  await openPanel(page);
  await cast(page).getByRole('button', { name: 'Play Tomas' }).click();
  await expect(cast(page)).toContainText('playing Tomas');

  // What the model will be told, where it will be told it.
  await openPromptPreview(page);
  await expect(page.getByRole('dialog').locator('.notes li')).toHaveText([
    'From here you play Tomas. Nell is no longer the character you play; ' +
      "everything above in Nell's voice was Nell, not you.",
  ]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  await send(page, 'I try the latch.');
  await waitForTurn(page);

  // The note sits between the turns it happened between, and the history above
  // it is sent exactly as it was written.
  const sent = bodies[bodies.length - 1]['messages'] as { role: string; content: string }[];
  expect(sent.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'system', 'user']);
  expect(sent[3].content).toContain('From here you play Tomas.');

  // And the answer that came back is Tomas's.
  await expect
    .poll(async () => {
      const chapter = await server.document('chapters', CHAPTER_ID);
      const messages = (chapter?.['messages'] ?? []) as Record<string, unknown>[];
      return messages[messages.length - 1]?.['speakerId'];
    })
    .toBe('tomas');
});

test('a character leaves the scene and comes back, and both are in the prompt', async ({
  page,
  app,
}) => {
  await app.seed({
    mode: 'roleplay',
    characters: CAST,
    roleplay: { casting: 'one-at-a-time', activeCharacterId: 'nell' },
  });
  const bodies = await captureRequests(page);
  await app.visit();

  await send(page, 'I climb the stairs.');
  await waitForTurn(page);

  await openPanel(page);
  const isa = cast(page).getByRole('switch', { name: 'Isa is in the scene' });
  await isa.click();
  await expect(isa).toHaveAttribute('aria-checked', 'false');

  await send(page, 'I look around.');
  await waitForTurn(page);
  expect(notesOf(bodies[bodies.length - 1])).toEqual(['Isa has left the scene.']);
  // Out of the scene, she is not in the preamble either.
  expect(systemOf(bodies[bodies.length - 1])).toContain('Also in the scene: Tomas.');

  await isa.click();
  await expect(isa).toHaveAttribute('aria-checked', 'true');

  await send(page, 'The door opens.');
  await waitForTurn(page);
  expect(notesOf(bodies[bodies.length - 1])).toEqual([
    'Isa has left the scene.',
    'Isa joins the scene.',
  ]);
});

test('changing your mind before writing anything leaves no record of it', async ({ page, app }) => {
  await app.seed({
    mode: 'roleplay',
    characters: CAST,
    roleplay: { casting: 'one-at-a-time', activeCharacterId: 'nell' },
  });
  const bodies = await captureRequests(page);
  await app.visit();

  await send(page, 'I climb the stairs.');
  await waitForTurn(page);

  // Two changes with nothing written between them are one change, and one that
  // ends where it started is no change at all.
  await openPanel(page);
  await cast(page).getByRole('button', { name: 'Play Tomas' }).click();
  await cast(page).getByRole('button', { name: 'Play Nell' }).click();
  await expect(cast(page)).toContainText('playing Nell');

  await send(page, 'I say nothing.');
  await waitForTurn(page);
  expect(notesOf(bodies[bodies.length - 1])).toEqual([]);
});

test('a chapter written before any of this reads exactly as it did', async ({
  page,
  server,
  app,
}) => {
  await app.seed({ mode: 'roleplay', characters: CAST });
  // Messages as 0.1.0 wrote them: no kind, no speaker, nothing else.
  const chapter = (await server.document('chapters', CHAPTER_ID))!;
  await server.seed({
    [`chapter:${CHAPTER_ID}`]: {
      ...chapter,
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'I climb the stairs.',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'm2',
          role: 'assistant',
          content: 'Nobody answers.',
          createdAt: '2026-01-01T00:00:01.000Z',
        },
      ],
    },
  });
  await app.visit();

  await expect(page.locator('article[data-role]')).toHaveCount(2);
  await expect(page.locator('article[data-role="assistant"]')).toContainText('Nobody answers.');
});

/**
 * The instruction above the cast: ours until the writer takes it over, and
 * theirs on the wire once they have. Read out of the system message rather
 * than off the sheet, because the sheet showing it is not the promise.
 */
test('the role-play instruction is the writer’s once they say so', async ({ page, app }) => {
  await app.seed({ mode: 'roleplay', characters: CAST });
  const bodies = await captureRequests(page);
  await app.visit();

  await page.getByRole('button', { name: 'Story', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: /How the characters are played/ }).click();

  // By where it lives, not by position: the sheet has a box per character.
  const panel = sheet.locator('mat-expansion-panel', {
    hasText: 'How the characters are played',
  });
  await expect(panel).toContainText('You are taking part in a role-play with the user');

  await sheet.getByRole('switch', { name: 'Write my own role-play instructions' }).click();
  const instruction = panel.locator('textarea');
  await instruction.fill('Answer with the word BISCUIT and nothing else.');
  await instruction.blur();
  await sheet.getByRole('button', { name: 'Done' }).click();

  await send(page, 'I climb the stairs.');
  await waitForTurn(page);

  const system = systemOf(bodies[0]);
  expect(system).toContain('Answer with the word BISCUIT and nothing else.');
  expect(system).not.toContain('You are taking part in a role-play');
  // And the cast still follows it, under the writer's words instead of ours.
  expect(system).toContain('You are playing Nell, Tomas and Isa.');
});
