import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { sheetSettled } from './helpers';

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
  /**
   * The step from the foot of the name to the top of the box, where there is a
   * name — in pixels, as the browser laid it out, unrounded. The step is
   * `--li-space-xs`, which is `5.6px`, and rounding a number that sits 0.4px
   * from the boundary between two integers throws away the only precision that
   * would say whether it is the right number: `Math.round` reads 6 at rest, 5
   * after a single sub-pixel shift, and 4 off a sheet that has not finished
   * growing. `step()` below is what it is compared with.
   */
  above: number | null;
  radius: string;
  border: string;
  paper: string;
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
          above: label ? top - label.getBoundingClientRect().bottom : null,
          radius: style.borderRadius,
          border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
          paper: style.backgroundColor,
        };
      });
  });
}

/**
 * What `--li-space-xs` is worth in pixels, asked of the browser.
 *
 * The step a name stands above its box is `li-field`'s own `gap`, so this is
 * the number every one of them is compared with rather than a `6` written
 * here. Resolved through a probe element the way `preferences.spec.ts` resolves
 * a colour, because a custom property's own computed value is the `0.35rem` it
 * was declared as and the page is drawn in pixels.
 *
 * Compared with half a pixel of tolerance at the call site. Both sides are
 * quantised the same way — the browser resolves `0.35rem` to a sixty-fourth,
 * and all sixteen steps and the token alike land on 5.59375 — so the tolerance
 * is not covering for the arithmetic; it is there so the assertion is about
 * the step rather than the last bit of a float. Half a pixel leaves nothing
 * real uncaught: the space tokens either side of this one are 4px and 8px, and
 * the read that started this, off a sheet still at `scale(0.8)`, is 4.475px —
 * 1.12px out.
 */
function step(page: Page): Promise<number> {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.height = 'var(--li-space-xs)';
    document.body.append(probe);
    const px = parseFloat(getComputedStyle(probe).height);
    probe.remove();
    return px;
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
  await sheetSettled(page);
  seen.push(...(await boxes(page)));
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  /** The scene sheet: the app's serif box stacked on what was a Material one. */
  await page.getByRole('button', { name: 'Edit scene' }).click();
  await expect(page.getByRole('dialog').locator('textarea.scene')).toBeVisible();
  await sheetSettled(page);
  seen.push(...(await boxes(page)));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  /** The connection sheet, which is where all three kinds of box are. */
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog').getByLabel('Provider')).toBeVisible();
  await sheetSettled(page);
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
  await sheetSettled(page);
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
  // them — and that step is the token, not a number that happens to match it.
  const named = seen.filter((box) => box.above !== null);
  expect(named.length).toBeGreaterThan(10);
  const gap = await step(page);
  expect(
    named
      .filter((box) => Math.abs(box.above! - gap) > 0.5)
      .map((box) => `${box.name} — ${box.above}px, not ${gap}px`),
  ).toEqual([]);
});

test('a box says it has the focus the same way whatever kind it is', async ({ page, app }) => {
  await app.seed();
  await app.visit();
  await page.keyboard.press('Control+k');

  const sheet = page.getByRole('dialog');
  await expect(sheet.getByLabel('Provider')).toBeVisible();
  await sheetSettled(page);

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

/**
 * The guard on the two tests above, which went missing without saying so.
 *
 * Both of them measure a sheet, and both are only true of a sheet that has
 * stopped moving. The wait that says so used to watch for a class Material
 * puts on an animation frame after the sheet appears — so on a machine slow
 * enough to be late with that frame, there was no class to wait for, the wait
 * returned at once, and a 6px step read as 4px. It went red on CI twice on
 * changes that had nothing to do with fields, and green on a re-run of the
 * same commit both times.
 *
 * So the late frame is arranged here rather than waited for. What is asserted
 * is not a number — the two above own the numbers — but that the numbers do
 * not move after the wait has returned, which is the whole of what the wait is
 * for.
 */
test('measures a sheet only once it has stopped moving', async ({ page, app }) => {
  // A frame late enough that slipping through the window behind it is certain
  // rather than a matter of how busy the machine happens to be.
  await page.addInitScript(() => {
    const frame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      frame(() => window.setTimeout(() => callback(performance.now()), 120));
  });
  await app.seed();
  await app.visit();

  await page.getByRole('button', { name: 'Edit scene' }).click();
  await expect(page.getByRole('dialog').locator('textarea.scene')).toBeVisible();
  await sheetSettled(page);
  const measured = await boxes(page);

  // Long enough for an animation that had not finished to finish.
  await page.waitForTimeout(400);

  expect(measured.length).toBeGreaterThan(0);
  expect(measured).toEqual(await boxes(page));
});
