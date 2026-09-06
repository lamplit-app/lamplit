import { expect, test } from './fixtures';
import { act, assistantMessages, openPreferences, send, waitForTurn } from './helpers';
import { clearSpeech, fakeVoices, finishSpeaking, spoken, spokenText } from './speech';

/** Its own button rather than Escape: the focus may be in a select or a slider. */
async function closePreferences(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

/**
 * Reading the story out loud, with the device's own voice and nothing sent
 * anywhere to do it.
 *
 * The voice itself is replaced — see `speech.ts` — so what is under test is
 * what the app decided: which words it handed over, which voice and speed it
 * asked for, and when it stopped. Whether a machine then makes a noise is the
 * platform's business and not something a spec can watch.
 */

test.beforeEach(async ({ page }) => {
  await fakeVoices(page);
});

test('Listen reads the message, without the marks that shape it', async ({ page, app }) => {
  await app.open();
  await send(page, 'Two lines, please.');
  await waitForTurn(page);

  await act(assistantMessages(page).first(), 'Listen');

  const said = await spokenText(page);
  // The words the model wrote, quotation marks and all — a voice pauses at
  // those and the listener needs the pause.
  expect(said).toContain('"You are smaller than the songs promised," she said.');
  expect(said).toContain('The dragon shifted, scales grinding on stone.');
  // But not the asterisks that made an action italic on the page.
  expect(said).not.toContain('*');
});

test('pressing it again stops, and nothing more is said', async ({ page, app }) => {
  await app.open();
  await send(page, 'Two lines, please.');
  await waitForTurn(page);

  const message = assistantMessages(page).first();
  await act(message, 'Listen');
  // Mid-reading: the fake voice says nothing until it is told to finish, which
  // is the only way to catch the app while it is still speaking.
  await expect(message.getByRole('button', { name: 'Stop reading' })).toBeVisible();
  const before = (await spoken(page)).length;

  await act(message, 'Stop reading');
  await expect(message.getByRole('button', { name: 'Listen' })).toBeVisible();

  await finishSpeaking(page);
  expect((await spoken(page)).length).toBe(before);
});

test('the voice and the speed are the ones chosen in Preferences', async ({ page, app }) => {
  await app.open();
  await send(page, 'Two lines, please.');
  await waitForTurn(page);

  await openPreferences(page);
  await page.getByLabel('Voice').selectOption('Autre Voix');
  await page.getByRole('slider', { name: 'Reading speed' }).fill('1.4');
  await closePreferences(page);

  await act(assistantMessages(page).first(), 'Listen');

  const pieces = await spoken(page);
  expect(pieces[0]?.voice).toBe('Autre Voix');
  expect(pieces[0]?.rate).toBe(1.4);
});

test('a long reply is handed over in pieces, and all of it is said', async ({ page, app }) => {
  await app.open();
  await send(page, '!long');
  await waitForTurn(page);

  await act(assistantMessages(page).first(), 'Listen');
  await finishSpeaking(page);

  const pieces = await spoken(page);
  // Chrome stops after about fifteen seconds of one utterance, so a long reply
  // is queued in short ones. Every sentence still arrives, in order.
  expect(pieces.length).toBeGreaterThan(1);
  const said = pieces.map((piece) => piece.text).join(' ');
  expect(said).toContain('Sentence 1 of the long passage.');
  expect(said).toContain('Sentence 60 of the long passage.');
  expect(said.indexOf('Sentence 2 of')).toBeLessThan(said.indexOf('Sentence 60 of'));
});

test.describe('reading replies as they arrive', () => {
  /** The switch in Preferences → Reading, which the phone has in its menu. */
  async function setReadAloud(page: import('@playwright/test').Page, on: boolean): Promise<void> {
    await openPreferences(page);
    const toggle = page.getByRole('switch', { name: 'Read replies aloud' });
    if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
    await closePreferences(page);
  }

  test('with it on, a reply is read the moment it finishes', async ({ page, app }) => {
    await app.open();
    await setReadAloud(page, true);
    await clearSpeech(page);

    await send(page, 'Two lines, please.');
    await waitForTurn(page);

    await expect.poll(() => spokenText(page)).toContain('smaller than the songs promised');
    // The reader's own line is not read back to them: this reads replies.
    expect(await spokenText(page)).not.toContain('Two lines, please');
  });

  test('with it off, nothing is read at all', async ({ page, app }) => {
    await app.open();

    await send(page, 'Two lines, please.');
    await waitForTurn(page);

    expect(await spoken(page)).toEqual([]);
  });

  test('a new turn stops the reply being read', async ({ page, app }) => {
    await app.open();
    await setReadAloud(page, true);

    await send(page, 'Two lines, please.');
    await waitForTurn(page);
    await expect.poll(() => spoken(page).then((pieces) => pieces.length)).toBeGreaterThan(0);
    await expect(
      assistantMessages(page).first().getByRole('button', { name: 'Stop reading' }),
    ).toBeVisible();

    // Writing on while the last answer is still being read: the story moved,
    // and the voice goes with it.
    await send(page, 'And then?');
    await expect(
      assistantMessages(page).first().getByRole('button', { name: 'Listen' }),
    ).toBeVisible();
    await waitForTurn(page);
  });

  test('a reply that failed is not read, and neither is one that was stopped', async ({
    page,
    app,
  }) => {
    await app.open();
    await setReadAloud(page, true);
    await clearSpeech(page);

    await send(page, '!401 this should fail');
    await waitForTurn(page);

    // The error is the app reporting itself, not the story.
    await expect(assistantMessages(page).first()).toContainText(/key/i);
    expect(await spoken(page)).toEqual([]);
  });
});
