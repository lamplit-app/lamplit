import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  act,
  assistantMessages,
  CHAPTER_ID,
  composer,
  FAKE_MODEL,
  fillProse,
  messages,
  proseEditor,
  seedDeveloperMode,
  send,
  setBookStyle,
  userMessages,
  waitForSaved,
  waitForTurn,
} from './helpers';

test.describe('writing a chapter', () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('streams an answer, styles speech and reports tokens', async ({ page }) => {
    await send(page, 'Two lines between a knight and a dragon.');

    const answer = assistantMessages(page).first();
    // Text arrives before the turn ends, which is the point of streaming.
    await expect(answer).toContainText('knight', { timeout: 15_000 });
    await waitForTurn(page);

    await expect(answer.locator('.speech').first()).toContainText('smaller than the songs');
    await expect(answer.locator('.action').first()).toBeVisible();
    await expect(answer.locator('footer')).toContainText(FAKE_MODEL);
    await expect(answer.locator('footer')).toContainText('out');
  });

  test('book style gives each spoken line its own paragraph', async ({ page }) => {
    await send(page, 'A scene, please.');
    await waitForTurn(page);

    const answer = assistantMessages(page).first();
    const spokenParagraphs = answer.locator('p:has(> span.speech)');
    await expect(spokenParagraphs).toHaveCount(2);
    // Each spoken paragraph starts with the quote, nothing before it.
    for (const paragraph of await spokenParagraphs.all()) {
      expect((await paragraph.innerText()).trim().startsWith('"')).toBe(true);
    }
  });

  test('the book style switch splits and rejoins a single-paragraph answer', async ({ page }) => {
    // `!prose` answers in one paragraph, the only shape the switch can change.
    await send(page, '!prose all in one paragraph');
    await waitForTurn(page);

    const paragraphs = assistantMessages(page).first().locator('.story-prose > p');
    await expect(paragraphs).toHaveCount(3);

    await setBookStyle(page, false);
    await expect(paragraphs).toHaveCount(1);
    await expect(paragraphs.first()).toContainText('You are smaller than the songs');

    await setBookStyle(page, true);
    await expect(paragraphs).toHaveCount(3);
  });

  test('stop keeps the partial answer and marks it', async ({ page }) => {
    await send(page, '!slow tell me slowly');

    const answer = assistantMessages(page).first();
    await expect(answer).toContainText('knight', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await waitForTurn(page);

    await expect(answer.locator('.story-prose')).not.toBeEmpty();
    await expect(answer.locator('footer')).toContainText('stopped');
  });

  test('an answer still arriving cannot be edited out from under itself', async ({ page }) => {
    await send(page, '!slow tell me slowly');

    const answer = assistantMessages(page).first();
    await expect(answer).toContainText('knight', { timeout: 15_000 });

    // Editing now would be taken, appended to by the next delta, and then
    // written over by the finished answer: the writer's words twice discarded.
    await answer.hover();
    await expect(answer.getByRole('button', { name: 'Edit' })).toBeDisabled();

    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await waitForTurn(page);
    // Finished, and an ordinary message again.
    await expect(answer.getByRole('button', { name: 'Edit' })).toBeEnabled();
  });

  test('editing a user message and replaying re-asks from there', async ({ page }) => {
    await send(page, 'First attempt.');
    await waitForTurn(page);
    const firstAnswer = await assistantMessages(page).first().innerText();

    const userMessage = userMessages(page).first();
    await act(userMessage, 'Edit');
    await fillProse(proseEditor(userMessage), 'Second attempt.');
    await userMessage.getByRole('button', { name: 'Save' }).click();
    await expect(userMessage).toContainText('Second attempt.');

    await act(userMessages(page).first(), 'Replay from here');
    await waitForTurn(page);

    await expect(messages(page)).toHaveCount(2);
    await expect(userMessages(page).first()).toContainText('Second attempt.');
    expect(await assistantMessages(page).first().innerText()).not.toBe(firstAnswer);
  });

  test('regenerate replaces the answer in place', async ({ page }) => {
    await send(page, 'Once more.');
    await waitForTurn(page);
    const first = await assistantMessages(page).first().innerText();

    await act(assistantMessages(page).first(), 'Regenerate');
    await waitForTurn(page);

    await expect(assistantMessages(page)).toHaveCount(1);
    expect(await assistantMessages(page).first().innerText()).not.toBe(first);
  });

  test('deleting a message removes just that message', async ({ page }) => {
    await send(page, 'A line to delete.');
    await waitForTurn(page);
    await expect(messages(page)).toHaveCount(2);

    await act(assistantMessages(page).first(), 'Delete');
    await expect(messages(page)).toHaveCount(1);
    await expect(userMessages(page)).toHaveCount(1);
  });

  test('a rejected key reads as a rejected key, and nothing crashes', async ({ page }) => {
    await send(page, '!401 this should fail');
    await waitForTurn(page);

    const answer = assistantMessages(page).first();
    await expect(answer.locator('.error')).toContainText('API key was rejected');
    await expect(answer.locator('.error')).toContainText('Incorrect API key provided');
    // The composer stays usable.
    await expect(composer(page)).toBeEnabled();
  });

  test('a provider error is reported with the provider’s own words', async ({ page }) => {
    await send(page, '!error break it');
    await waitForTurn(page);

    await expect(assistantMessages(page).first().locator('.error')).toContainText(
      'upstream model is on fire',
    );
  });

  test('the chapter and the connection survive a reload', async ({ page, server }) => {
    await send(page, 'Remember me.');
    await waitForTurn(page);
    const answer = await assistantMessages(page).first().innerText();
    await waitForSaved(server, 2);

    await page.reload();

    await expect(userMessages(page).first()).toContainText('Remember me.');
    expect(await assistantMessages(page).first().innerText()).toBe(answer);
    await expect(page.getByRole('button', { name: /Storyteller Large/ })).toBeVisible();
  });

  test('what is typed is coloured as it will be read, and stored as it was typed', async ({
    page,
    server,
  }) => {
    const box = composer(page);
    await fillProse(box, 'He looked away. *shrugs* "Not today."');

    // In the box: the action in italics, the speech in colour, no asterisks.
    await expect(box.locator('em.action')).toHaveText('shrugs');
    await expect(box.locator('span.speech')).toHaveText('"Not today."');
    await expect(box).toHaveText('He looked away. shrugs "Not today."');

    // Undo takes back the last thing typed, not the whole message.
    await box.press('ControlOrMeta+z');
    await expect(box).not.toHaveText(/Not today\./);
    await box.press('ControlOrMeta+Shift+z');

    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await waitForTurn(page);
    await waitForSaved(server, 2);

    // On the page as it always was, and on disk as it was typed.
    const line = userMessages(page).first().locator('.story-prose');
    await expect(line.locator('em.action')).toHaveText('shrugs');
    await expect(line.locator('span.speech')).toHaveText('"Not today."');
    const chapter = await server.document('chapters', CHAPTER_ID);
    const stored = (chapter?.['messages'] ?? []) as Record<string, unknown>[];
    expect(stored[0]?.['content']).toBe('He looked away. *shrugs* "Not today."');

    // And nothing that was sent can be undone back into the box.
    await expect(box).toHaveText('');
    await box.press('ControlOrMeta+z');
    await expect(box).toHaveText('');
  });

  test('editing a message keeps the markdown the editor does not model', async ({
    page,
    server,
  }) => {
    const source = '# A heading\n\n- one\n- two\n\nA line with `code` and a [link](https://x.y).';
    await fillProse(composer(page), source);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await waitForTurn(page);
    await waitForSaved(server, 2);

    const userMessage = userMessages(page).first();
    await act(userMessage, 'Edit');
    const editor = proseEditor(userMessage);
    await expect(editor).toBeFocused();
    // Kept as the writer's own characters, not turned into anything.
    await expect(editor).toContainText('# A heading');
    await expect(editor).toContainText('- one');
    await editor.press('End');
    await editor.pressSequentially(' Edited.');
    await userMessage.getByRole('button', { name: 'Save' }).click();

    await expect
      .poll(async () => {
        const chapter = await server.document('chapters', CHAPTER_ID);
        return ((chapter?.['messages'] ?? []) as Record<string, unknown>[])[0]?.['content'];
      })
      .toBe(`${source} Edited.`);
    // Rendered as the markdown it still is.
    await expect(userMessage.locator('.story-prose h1')).toHaveText('A heading');
    await expect(userMessage.locator('.story-prose li')).toHaveCount(2);
  });

  test('the composer grows with the text, without ever scrolling it', async ({ page }) => {
    const box = composer(page);
    await box.click();

    // Measured two frames on, so that a box which only grew on the frame after
    // the keystroke would still pass — and one that grew any later than that,
    // with the line being written out of sight, would not.
    const state = () =>
      box.evaluate(
        (el: HTMLTextAreaElement) =>
          new Promise<{ height: number; scrolling: boolean }>((settled) => {
            requestAnimationFrame(() =>
              requestAnimationFrame(() =>
                settled({
                  height: Math.round(el.getBoundingClientRect().height),
                  scrolling: el.scrollHeight > el.clientHeight + 4,
                }),
              ),
            );
          }),
      );

    const resting = await state();
    expect(resting.scrolling).toBe(false);

    for (let i = 0; i < 60; i++) {
      await page.keyboard.type('word ');
      expect((await state()).scrolling).toBe(false);
    }
    expect((await state()).height).toBeGreaterThan(resting.height);
  });

  /**
   * The whole point of the move: a reader crossing the page with the pointer
   * should never have a word taken away from them. Measured rather than looked
   * at, because "it looks fine on my screen" is how it got there in the first
   * place.
   */
  for (const width of [1280, 1440]) {
    test(`at ${width}px the message actions sit outside the text`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await send(page, 'Two lines, please.');
      await waitForTurn(page);

      const message = assistantMessages(page).first();
      await message.hover();

      const rail = message.locator('.rail');
      const prose = message.locator('.story-prose');
      await expect(rail).toBeVisible();

      /** How far the left edge of something is past the end of the text. */
      const clearance = async (what: Locator) => {
        const box = (await what.boundingBox())!;
        const text = (await prose.boundingBox())!;
        return Math.round(box.x - (text.x + text.width));
      };

      // The rail slides in over 120ms, so this is measured where it comes to
      // rest. Touching the column's edge is the point — the rail bridges the
      // gap so the pointer can reach it — but nothing of it is over a word.
      await expect.poll(() => clearance(rail)).toBeGreaterThanOrEqual(0);

      for (const name of ['Edit', 'Regenerate', 'Copy', 'Delete']) {
        expect(await clearance(message.getByRole('button', { name }))).toBeGreaterThan(0);
      }

      // And the ⋯ is not doubling up on it at this width.
      await expect(message.getByRole('button', { name: 'Message actions' })).toBeHidden();
    });
  }

  test('the context pill reflects what will be sent', async ({ page, server }) => {
    // The pill is developer mode's; the beforeEach opened the app without it.
    await seedDeveloperMode(server);
    await page.reload();

    const pill = page.getByRole('button', { name: /^context/ });
    // The scene and the system blocks are in there before a word is typed.
    await expect(pill).toContainText('/ 16k');
    const before = await pill.innerText();

    await fillProse(composer(page), 'A sentence that costs a few tokens to send.');
    await expect(pill).not.toHaveText(before);
  });
});

test.describe('parameters', () => {
  test('advanced parameters are only sent once switched on', async ({ page, app }) => {
    await app.open();
    const bodies: Record<string, unknown>[] = [];
    await page.route('**/chat/completions', async (route) => {
      bodies.push(route.request().postDataJSON());
      await route.continue();
    });

    await send(page, 'First request.');
    await waitForTurn(page);
    expect(bodies[0]).not.toHaveProperty('top_k');
    expect(bodies[0]).toMatchObject({
      stream: true,
      max_tokens: 800,
      temperature: 0.9,
    });

    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Parameters' }).click();
    const advanced = dialog.getByRole('button', { name: /Advanced/ });
    await advanced.scrollIntoViewIfNeeded();
    await advanced.click();
    await dialog.locator('li-param-row', { hasText: 'Top-k' }).getByRole('switch').click();
    await dialog.getByRole('button', { name: 'Done' }).click();

    await send(page, 'Second request.');
    await waitForTurn(page);
    expect(bodies[1]).toHaveProperty('top_k');
  });

  test('a tight context budget drops the oldest messages', async ({ page, app }) => {
    // The budget is on disk before the app opens, because that is the one
    // moment it is read.
    await app.open({ generation: { maxContextTokens: 1152, maxResponseTokens: 1024 } });

    await send(page, '!long give me a long passage');
    await waitForTurn(page);

    await fillProse(composer(page), 'And now the next thing.');
    await expect(page.getByText(/older message[s]? left out/)).toBeVisible();
  });
});

/**
 * The page's own shortcuts stop at the edge of a sheet. Ctrl+Enter on the page
 * asks the last turn again; inside the scene sheet it is a keystroke in a text
 * box, and answering it there regenerates the chapter behind what is being
 * edited, in a window the reader cannot see.
 */
test('leaves the page’s shortcuts alone while a sheet is open', async ({ page, app }) => {
  await app.open();

  await send(page, 'I climb the stairs.');
  await waitForTurn(page);
  const written = await assistantMessages(page).first().textContent();

  await page.getByRole('button', { name: 'Edit scene' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.locator('textarea').first().click();
  await page.keyboard.press('Control+Enter');

  // Nothing was asked again: the sheet is still open over the same answer.
  await expect(sheet).toBeVisible();
  await expect(composer(page).locator('.stop')).toHaveCount(0);
  await sheet.getByRole('button', { name: /Save the scene|Open the chapter/ }).click();
  await expect(sheet).toBeHidden();
  expect(await assistantMessages(page).first().textContent()).toBe(written);
});
