import { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { moving, openPreferences, seedUi } from './helpers';

/**
 * Preferences → Accessibility: two questions the app already answers from the
 * machine, and the panel that is allowed to overrule it.
 *
 * The stronger palette ships in `styles.scss` and has since #48, applied by
 * `prefers-contrast: more`. What is new is the door, and a door is worth a
 * spec in both directions: the machine on its own, with the panel never
 * opened, and the panel on its own, on a machine that asks for nothing. The
 * third state — a reader who has turned contrast up everywhere and does not
 * want this app repainted — is the one that cannot be done with a media query,
 * so it is the one asserted most plainly.
 *
 * Measured on the top bar's hairline, which is `var(--li-border)` and is on
 * screen from the first frame. `--li-border` itself cannot be read back: a
 * custom property computes to `light-dark(#…, #…)` with both halves still in
 * it, and which half the page is drawn in is the whole question here.
 */

/** The rule under the top bar, as the browser reports it. */
function rule(page: Page): Promise<string> {
  return page
    .locator('li-top-bar .bar')
    .evaluate((node) => getComputedStyle(node).borderBottomColor);
}

/** `$palette`'s dark rules, #4a5060, and `$contrast`'s, #6b7183. */
const SHIPPED = 'rgb(74, 80, 96)';
const STRONGER = 'rgb(107, 113, 131)';

/** And the Frost page's own pair, #40576e and #557492, from `page-palettes.ts`. */
const FROST = 'rgb(64, 87, 110)';
const FROST_STRONGER = 'rgb(85, 116, 146)';

/**
 * The machine saying it. Asserted rather than assumed, the way
 * `reduced-motion.spec.ts` does: an emulation that quietly did not happen
 * would leave every test below passing on a question never asked.
 */
async function machineAsksForContrast(page: Page): Promise<void> {
  await page.emulateMedia({ contrast: 'more' });
  expect(await page.evaluate(() => matchMedia('(prefers-contrast: more)').matches)).toBe(true);
}

/** Opens the panel, which arrives folded under Reading. */
async function openAccessibility(page: Page): Promise<void> {
  await openPreferences(page);
  await page.getByRole('button', { name: 'Accessibility' }).first().click();
  await expect(page.getByLabel('Contrast')).toBeVisible();
}

test('the machine on its own, with the panel never opened', async ({ page, app }) => {
  await app.open();
  expect(await rule(page)).toBe(SHIPPED);

  await machineAsksForContrast(page);
  await expect.poll(() => rule(page)).toBe(STRONGER);
});

test('the panel on its own, on a machine that asks for nothing', async ({ page, app }) => {
  await app.open();

  await openAccessibility(page);
  await page.getByLabel('Contrast').selectOption('high');
  await expect.poll(() => rule(page)).toBe(STRONGER);

  // Written down, not held in the tab: this is the setting a reader makes once.
  await page.keyboard.press('Escape');
  await page.reload();
  await expect.poll(() => rule(page)).toBe(STRONGER);
});

test('and the way back, for a machine that asks and a reader who would rather not', async ({
  page,
  server,
  app,
}) => {
  await app.seed();
  await seedUi(server, { contrast: 'normal' });
  await machineAsksForContrast(page);
  await app.visit();

  // A rule cannot unsay a media query, so this is the shipped half written a
  // second time in a later block — see `shipped-palette` in `styles.scss`.
  await expect.poll(() => rule(page)).toBe(SHIPPED);
});

/**
 * The page a chapter chose is written inline on `<html>`, and inline beats
 * every block in the stylesheet — so a story with a page of its own is the one
 * place a contrast mode could silently do nothing. #64 gave each palette a
 * contrast half for this; here it is, reaching the page.
 *
 * And it changes here rather than at the next reload, which is the other half:
 * the media query is asked when the settings effect runs, so `workspace.ts`
 * listens for the machine changing its mind and paints again.
 */
test('a page of its own gets its own stronger rules, the moment the machine says so', async ({
  page,
  app,
}) => {
  await app.open({ palette: 'frost' });
  expect(await rule(page)).toBe(FROST);

  await machineAsksForContrast(page);
  await expect.poll(() => rule(page)).toBe(FROST_STRONGER);
});

/**
 * In a contrast mode the colour Reset returns to is the contrast one, because
 * Reset is an override being removed and what is underneath is the stylesheet.
 * That much was always true. What was not, until the switch above existed, is
 * the swatch beside it: the sheet read the shipped colours once when it opened,
 * and the one control that can move them is now on the same sheet — so a reader
 * who turned contrast up here saw the page redraw and the Rules swatch go on
 * offering the colour it had been drawn in a moment ago.
 */
test('Reset in Colours puts back the contrast rule, not the shipped one', async ({ page, app }) => {
  await app.open();
  await openAccessibility(page);
  await page.getByLabel('Contrast').selectOption('high');

  await page.getByRole('button', { name: 'Colours' }).first().click();
  const rules = page.getByLabel(/^Rules/);
  await expect(rules).toHaveValue('#6b7183');

  await rules.evaluate((input: HTMLInputElement) => {
    input.value = '#ff0000';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => rule(page)).toBe('rgb(255, 0, 0)');

  await page.getByRole('button', { name: 'Reset the dark colours' }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect.poll(() => rule(page)).toBe(STRONGER);
});

/**
 * The motion half of the panel. `reduced-motion.spec.ts` asks the promise
 * itself with the machine set; this asks the other door, on a machine that has
 * asked for nothing — which is the whole reason the switch exists.
 */
test('always still: nothing moves, on a machine that never asked', async ({
  page,
  server,
  app,
}) => {
  await app.seed();
  await seedUi(server, { motion: 'reduced' });
  await app.visit();

  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
    false,
  );
  // Something on screen that would move: the top bar's own buttons ease their
  // background under the pointer. Named so that an empty list below is an
  // answer rather than the absence of one.
  await expect(page.getByRole('button', { name: 'More actions' })).toBeVisible();
  expect(await moving(page)).toEqual([]);
});
