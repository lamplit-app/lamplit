import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * One way to name a field.
 *
 * The sheets used to hold three idioms at once — a Material outlined box with
 * a notched floating label, the same box with only a placeholder, and the
 * app's own bare textarea with neither — and the first-run screen showed all
 * three before the reader had written a word. There is one now: a name above
 * a box, the box drawn from the globals, and a note under it when there is
 * one.
 *
 * That is a measurement rather than a claim. Everything here is read off the
 * page the browser drew: the corner, the hairline and the paper of every box
 * in a sheet, and the step between each name and the box it names.
 */

interface Box {
  /** What names it: a label tied by id, or the aria-label of a box without one. */
  name: string;
  /** The step from the foot of the name to the top of the box, where there is a name. */
  above: number | null;
  radius: string;
  border: string;
  paper: string;
}

/**
 * Nothing is measured while a sheet is still growing into place: Material
 * scales a dialog open, and a gap read off a scaled box is a gap that has been
 * multiplied by something less than one.
 */
async function settled(page: Page): Promise<void> {
  await expect(page.locator('.mdc-dialog--opening')).toHaveCount(0);
}

/**
 * Every box in the sheet that is open, at rest.
 *
 * At rest because a sheet hands the focus to its first box as it opens, and a
 * box with the focus wears the accent edge rather than the hairline — which is
 * the subject of the other test, not this one. Boxes with no height are inside
 * a panel that is folded away, and nothing can be said about how they are
 * drawn.
 */
function boxes(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();

    const kinds =
      'textarea, select, ' +
      'input:where(:not([type]), [type="text"], [type="password"], [type="search"], [type="number"])';
    const sheet = document.querySelector('[role="dialog"]');
    if (!sheet) throw new Error('no sheet is open');

    return [...sheet.querySelectorAll<HTMLElement>(kinds)]
      .filter((box) => box.getBoundingClientRect().height > 0)
      .map((box) => {
        const style = getComputedStyle(box);
        const label = box.id ? sheet.querySelector(`label[for="${box.id}"]`) : null;
        const top = box.getBoundingClientRect().top;
        return {
          name: label?.textContent?.trim() ?? box.getAttribute('aria-label') ?? '',
          above: label ? Math.round(top - label.getBoundingClientRect().bottom) : null,
          radius: style.borderRadius,
          border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
          paper: style.backgroundColor,
        };
      });
  });
}

test('every box in every sheet is the same box, named the same way', async ({ page, app }) => {
  await app.seed({
    entries: [
      {
        id: 'tomas',
        title: 'Old Tomas',
        category: 'person',
        keys: ['tomas', 'keeper'],
        content: 'The lighthouse keeper, missing since spring.',
      },
    ],
  });
  await app.visit();

  const seen: Box[] = [];

  /** The sheet the review's own screenshot of the first run was taken of. */
  await page.getByRole('button', { name: /The Lighthouse/ }).click();
  await page.getByRole('menuitem', { name: 'New story…' }).click();
  await expect(page.getByRole('dialog').getByLabel('Title')).toBeVisible();
  await settled(page);
  seen.push(...(await boxes(page)));
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  /** The scene sheet: the app's serif box stacked on what was a Material one. */
  await page.getByRole('button', { name: 'Edit scene' }).click();
  await expect(page.getByRole('dialog').locator('textarea.scene')).toBeVisible();
  await settled(page);
  seen.push(...(await boxes(page)));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  /** The connection sheet, which is where all three kinds of box are. */
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog').getByLabel('Provider')).toBeVisible();
  await settled(page);
  seen.push(...(await boxes(page)));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  /** A lore entry, opened: the sheet the review found four idioms in. */
  await page.getByRole('button', { name: 'World', exact: true }).click();
  const world = page.getByRole('dialog');
  await world.getByRole('tab', { name: 'Lore' }).click();
  await world
    .getByRole('button', { name: /Old Tomas/ })
    .first()
    .click();
  await expect(world.getByLabel('Keys')).toBeVisible();
  await settled(page);
  seen.push(...(await boxes(page)));

  // Four sheets, and a box of every kind in them.
  expect(seen.length).toBeGreaterThan(12);

  // Every one of them is named, and none of those names is a placeholder that
  // vanishes the moment somebody types into the box.
  expect(seen.filter((box) => !box.name)).toEqual([]);

  // And every one of them is the same box, drawn the same way. Compared as a
  // list rather than one at a time, so a failure says which box broke ranks.
  const frame = (box: Box) => `${box.radius} · ${box.border} · ${box.paper}`;
  const frames = seen.map((box) => `${box.name} — ${frame(box)}`);
  expect(frames).toEqual(seen.map((box) => `${box.name} — ${frame(seen[0])}`));

  // The name stands the same step above the box wherever it is written — the
  // field's own, the editor field's row with a save mark to fit on it, all of
  // them.
  const named = seen.filter((box) => box.above !== null);
  expect(named.length).toBeGreaterThan(10);
  expect(named.map((box) => `${box.name} — ${box.above}px`)).toEqual(
    named.map((box) => `${box.name} — ${named[0].above}px`),
  );
});

test('a box says it has the focus the same way whatever kind it is', async ({ page, app }) => {
  await app.seed();
  await app.visit();
  await page.keyboard.press('Control+k');

  const sheet = page.getByRole('dialog');
  await expect(sheet.getByLabel('Provider')).toBeVisible();
  await settled(page);

  const edge = (name: string) =>
    sheet.getByLabel(name).evaluate((box) => {
      box.focus();
      return getComputedStyle(box).borderTopColor;
    });

  const resting = await sheet
    .getByLabel('Endpoint URL')
    .evaluate((box) => getComputedStyle(box).borderTopColor);
  const line = await edge('Endpoint URL');
  const choice = await edge('Provider');

  expect(line).not.toBe(resting);
  expect(choice).toBe(line);
});
