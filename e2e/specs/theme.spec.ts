import { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openPreferences, seedUi } from './helpers';

/**
 * The theme, and the three answers to which one it is: the machine's, and the
 * two ways of saying otherwise under Preferences → Reading.
 *
 * Two things are worth a spec here and neither can be seen in a unit test. The
 * first is following the machine at all — that a fresh install opens in the
 * theme the rest of the desktop is in, and moves when the desktop does. The
 * second is the frame *before* the app: the setting lives in `settings.json`
 * on the server and arrives a fetch after the page does, so a reader who chose
 * the theme the machine is not in used to watch the app flip on every load.
 * `public/boot-theme.js` is the answer, and the only way to see it work is to
 * hold the documents back and look at what is on screen while they are gone.
 *
 * Measured on the body's background, which is `var(--li-page)` and is drawn
 * from the first frame. The custom property itself cannot be read back — it
 * computes to `light-dark(#…, #…)` with both halves still in it, and which half
 * the page is drawn in is the whole question — so this is the used colour.
 */

/** `$palette`'s two papers, #f6f3ec and #14151a. */
const LIGHT = 'rgb(246, 243, 236)';
const DARK = 'rgb(20, 21, 26)';

function paper(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

/** What `applyUi` writes when the reader has chosen a side, and nothing when not. */
function chosen(page: Page): Promise<string> {
  return page.evaluate(() => document.documentElement.style.colorScheme);
}

/**
 * The choice under Reading. `exact`, because the panel's own folded summary
 * says which theme it is on — so the accordion's region is labelled "Reading
 * dark theme, 18px" and a loose match finds the section as well as the box.
 */
function themeIs(page: Page, name: 'system' | 'dark' | 'light'): Promise<unknown> {
  return page.getByLabel('Theme', { exact: true }).selectOption(name);
}

/**
 * The machine saying it. Asserted rather than assumed, the way
 * `accessibility.spec.ts` does: an emulation that quietly did not happen would
 * leave every test below passing on a question never asked.
 */
async function machineIs(page: Page, scheme: 'dark' | 'light'): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(
    scheme === 'dark',
  );
}

test('a fresh install is the theme the computer is in, and follows it', async ({
  page,
  server,
  app,
}) => {
  await app.seed();
  // What a fresh install is; `seedConnectedSettings` writes a 0.1.0 file, which
  // named a theme because there was no other choice then.
  await seedUi(server, { theme: 'system' });
  await machineIs(page, 'light');
  await app.visit();

  await expect.poll(() => paper(page)).toBe(LIGHT);
  // Nothing written on <html>: not saying it is how the machine is followed.
  expect(await chosen(page)).toBe('');

  // And it moves, mid-session, with no reload: `Layout` watches the query and
  // the paint in `workspace.ts` reads it.
  await machineIs(page, 'dark');
  await expect.poll(() => paper(page)).toBe(DARK);
  expect(await chosen(page)).toBe('');
});

test('a settings file that names a theme opens in it, whatever the computer says', async ({
  page,
  app,
}) => {
  // `seedConnectedSettings` says `dark`, as every 0.1.x file does.
  await app.seed();
  await machineIs(page, 'light');
  await app.visit();

  await expect.poll(() => paper(page)).toBe(DARK);
  expect(await chosen(page)).toBe('dark');
});

test('choosing one here beats the computer, and survives the reload', async ({ page, app }) => {
  await app.seed();
  await machineIs(page, 'dark');
  await app.visit();

  await openPreferences(page);
  await themeIs(page, 'light');
  await expect.poll(() => paper(page)).toBe(LIGHT);

  await page.keyboard.press('Escape');
  await page.reload();
  await expect.poll(() => paper(page)).toBe(LIGHT);
});

test('and back to the computer, which is the third choice', async ({ page, app }) => {
  await app.seed();
  await machineIs(page, 'light');
  await app.visit();
  await expect.poll(() => paper(page)).toBe(DARK);

  await openPreferences(page);
  await themeIs(page, 'system');

  await expect.poll(() => paper(page)).toBe(LIGHT);
  await expect.poll(() => chosen(page)).toBe('');
});

/**
 * The frame before the app, which is the whole reason there is a copy of this
 * one setting in the browser.
 *
 * The documents are held back so that nothing gets past the app initializer:
 * Angular never renders, `applyUi` never runs, and what is on screen is
 * `index.html`'s own boot screen with the stylesheet over it. If the theme were
 * only in `settings.json`, that screen would be whatever the computer is in —
 * dark here — and the app would flip to light behind it a moment later.
 */
test('the first frame is already the chosen theme, before any document arrives', async ({
  page,
  app,
}) => {
  await app.seed();
  await machineIs(page, 'dark');
  await app.visit();

  await openPreferences(page);
  await themeIs(page, 'light');
  await expect.poll(() => paper(page)).toBe(LIGHT);
  await page.keyboard.press('Escape');

  // Long enough that the assertions below are made on a page that is still
  // waiting, and finite so that nothing is left hanging when the test ends.
  await page.route('**/api/docs/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    await route.abort();
  });
  await page.reload();

  await expect(page.locator('.booting')).toBeVisible();
  expect(await chosen(page)).toBe('light');
  expect(await paper(page)).toBe(LIGHT);
});
