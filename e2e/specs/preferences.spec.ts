import type { Page } from '@playwright/test';
import {
  captureRequests,
  composer,
  fillProse,
  openPanel,
  openPreferences,
  pageColour,
  seedDeveloperMode,
  seedUi,
  send,
  systemOf,
  waitForTurn,
} from './helpers';
import { expect, test } from './fixtures';

/** A hex as the browser reports it back. */
function rgb(hex: string): string {
  const value = parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

/**
 * The colours are a stylesheet the reader is allowed to edit, so the assertions
 * here are made against the computed style rather than a screenshot: what
 * matters is that the page is *drawn* in the colour, and that it is still the
 * colour after a reload, which is the only place the setting could have been.
 *
 * These start from 0.1.0's settings file — `seedConnectedSettings` writes the
 * four reading fields and nothing else — so the upgrade path is checked on
 * every run of the suite rather than once in a spec of its own.
 */
test.describe('preferences', () => {
  test.beforeEach(async ({ app }) => {
    await app.seed();
  });

  /** The native picker is not clickable, so the value is set the way a browser would. */
  function paint(page: Page, colour: string): Promise<void> {
    return page
      .getByLabel(/^Page/)
      .first()
      .evaluate((input: HTMLInputElement, value) => {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, colour);
  }

  test('opens on Reading, holding what the Reading menu held', async ({ page, server, app }) => {
    await app.visit();
    await openPreferences(page);

    // The first section is open on arrival, with all four of its settings.
    await expect(page.getByRole('switch', { name: 'Dark theme' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Dialogue on its own line' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Show token counts' })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Text size' })).toBeVisible();

    await page.getByRole('switch', { name: 'Show token counts' }).click();
    await expect
      .poll(async () => {
        const settings = await server.document('settings');
        return (settings?.['ui'] as Record<string, unknown>)?.['showTokenCounts'];
      })
      .toBe(false);
  });

  test('a colour is on the page at once, and on disk after a reload', async ({
    page,
    server,
    app,
  }) => {
    await app.visit();
    const shipped = await pageColour(page);

    await openPreferences(page);
    await page.getByRole('button', { name: 'Colours' }).first().click();
    await paint(page, '#123456');

    // Immediately, with the dialog still open over it.
    await expect.poll(() => pageColour(page)).toBe(rgb('#123456'));
    expect(shipped).not.toBe(rgb('#123456'));

    await expect
      .poll(async () => {
        const settings = await server.document('settings');
        const ui = settings?.['ui'] as { colours?: Record<string, Record<string, string>> };
        return ui?.colours?.['dark']?.['page'];
      })
      .toBe('#123456');

    // The browser keeps nothing of its own, so this is the file coming back.
    await page.reload();
    await expect.poll(() => pageColour(page)).toBe(rgb('#123456'));
  });

  test('each theme keeps its own set, and reset returns the shipped one', async ({ page, app }) => {
    await app.visit();
    await openPreferences(page);
    await page.getByRole('button', { name: 'Colours' }).first().click();

    await paint(page, '#123456');
    await page.getByRole('switch', { name: 'Dark theme' }).click();

    // Switching the theme switched the palette with it: light is untouched.
    await expect.poll(() => pageColour(page)).not.toBe(rgb('#123456'));
    const shippedLight = await pageColour(page);
    await paint(page, '#fedcba');
    await expect.poll(() => pageColour(page)).toBe(rgb('#fedcba'));

    await page.getByRole('button', { name: 'Reset the light colours' }).click();
    await page.getByRole('button', { name: 'Reset', exact: true }).click();

    // Exactly the shipped colour, because the override is gone rather than
    // replaced by a copy of it.
    await expect.poll(() => pageColour(page)).toBe(shippedLight);

    // And the dark set survived the reset of the light one.
    await page.getByRole('switch', { name: 'Dark theme' }).click();
    await expect.poll(() => pageColour(page)).toBe(rgb('#123456'));
  });

  test('the reading font changes the story and leaves the app alone', async ({ page, app }) => {
    await app.visit();
    // The reading face is only visible on prose, so there has to be some.
    await send(page, 'Two lines, please.');
    await waitForTurn(page);

    await openPreferences(page);
    await page.getByRole('button', { name: 'Colours' }).first().click();
    await page.getByRole('combobox', { name: 'Reading font' }).click();
    await page.getByRole('option', { name: 'Monospace' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('heading', { name: 'Preferences' })).toBeHidden();

    const faceOf = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((el) => getComputedStyle(el).fontFamily);

    await expect.poll(() => faceOf('.story-prose')).toMatch(/Cascadia|Consolas|monospace/i);
    // The wordmark is app furniture and stays in the serif it always was.
    await expect.poll(() => faceOf('li-top-bar .wordmark')).toMatch(/Iowan|Palatino|serif/i);
  });

  test('the story is written at the size it is read at', async ({ page, server, app }) => {
    // Not the default, because the default is also what the stylesheet ships:
    // a size that only works when nobody has chosen one is not the setting.
    await seedUi(server, { fontSize: 23 });
    await app.visit();
    await send(page, 'Two lines, please.');
    await waitForTurn(page);

    const sizeOf = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((el) => getComputedStyle(el).fontSize);

    await expect.poll(() => sizeOf('.story-prose')).toBe('23px');

    // The two boxes the story itself is written into, in a sheet over the page
    // and in the panel beside it. Both were 16px against a page of 23.
    await page.getByRole('button', { name: 'Edit scene' }).click();
    await expect(page.locator('.mdc-dialog--opening')).toHaveCount(0);
    expect(await sizeOf('textarea.scene')).toBe('23px');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    await openPanel(page);
    expect(await sizeOf('li-chapter-panel [data-section="scene"] textarea')).toBe('23px');

    // The app around it is not the story and does not follow it.
    expect(await sizeOf('li-top-bar .wordmark')).not.toBe('23px');
  });
});
/**
 * Developer mode is the line between what the story needs and what a person
 * debugging it needs. The one thing it must never do is change the request, so
 * that is checked here rather than left to reasoning about the template.
 */
test.describe('developer mode', () => {
  test.beforeEach(async ({ app }) => {
    await app.seed();
  });

  const pill = (page: Page) =>
    page.locator('li-composer').getByRole('button', { name: /^context/ });

  test('is off on a fresh install, and switching it on is the way to the prompt', async ({
    page,
    server,
    app,
  }) => {
    await app.visit();

    // Neither door: the pill is gone and the toolbar button it replaced is too.
    await expect(pill(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'What the model sees' })).toHaveCount(0);

    await openPreferences(page);
    const preferences = page.getByRole('dialog');
    await preferences.getByRole('button', { name: 'Advanced' }).click();
    await preferences.getByRole('switch', { name: /^Developer mode/ }).click();
    await preferences.getByRole('button', { name: 'Done' }).click();
    await expect(preferences).toBeHidden();

    await expect(pill(page)).toBeVisible();
    await pill(page).click();
    await expect(page.getByRole('heading', { name: 'What the model sees' })).toBeVisible();

    // And it is a setting, not a session: the file says so, and a reload agrees.
    await expect
      .poll(async () => {
        const settings = await server.document('settings');
        return (settings?.['ui'] as Record<string, unknown>)?.['developerMode'];
      })
      .toBe(true);
    await page.reload();
    await expect(pill(page)).toBeVisible();
  });

  test('changes nothing about what the model is sent', async ({ page, server, app }) => {
    await app.visit();
    const off = await captureRequests(page);
    await send(page, 'I knock twice and wait.');
    await waitForTurn(page);

    await seedDeveloperMode(server);
    await page.reload();
    await expect(pill(page)).toBeVisible();
    const on = await captureRequests(page);
    await fillProse(composer(page), 'I knock twice and wait.');
    await pill(page).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await waitForTurn(page);

    // The same system prompt, and the same user line under it. Looking at the
    // request is not the same as being in it.
    expect(systemOf(on[on.length - 1])).toBe(systemOf(off[off.length - 1]));
  });

  test('adds the folder the documents are in to About', async ({ page, server, app }) => {
    await app.visit();
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: /^About Lamplit/ }).click();
    const about = page.getByRole('dialog');
    // The build line is a bug report's, not a developer's, and stays either way.
    await expect(about.locator('.build')).not.toBeEmpty();
    await expect(about.locator('.path')).toHaveCount(0);
    await about.getByRole('button', { name: 'Close' }).click();

    await seedDeveloperMode(server);
    await page.reload();
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: /^About Lamplit/ }).click();
    await expect(page.getByRole('dialog').locator('.path')).toContainText(server.dataDir);
  });
});
