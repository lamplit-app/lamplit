import { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { chapterPanel, moving, openPanel, openPromptPreview, send, waitForTurn } from './helpers';

/**
 * What the app does for a reader who has asked their machine to turn motion
 * down. `styles.scss` answers it in one rule for everything, so what these ask
 * is the promise itself rather than any one declaration: with the preference
 * set, is there anything left on the page that would still move?
 *
 * Three tests, because a duration only exists while the thing it belongs to
 * is on screen. The panel's switch and the message rail are simply there; the
 * save dot is there for as long as a write is in flight, which is why one test
 * holds a write open; and the prompt preview's blocks only have a transition
 * while a block is being dragged past them, which is why one test stops with
 * the mouse still down.
 *
 * The walk itself is `moving` in `helpers.ts`, because the other door into the
 * same rule — Preferences → Accessibility, on a machine that asked for nothing
 * — is asked in `accessibility.spec.ts` and has to be asked the same way.
 */

/**
 * The preference itself, asked of the page rather than declared as an option.
 *
 * `test.use({ reducedMotion: 'reduce' })` is the tidier spelling and does
 * nothing here — measured on Playwright 1.62.1, with the plain fixtures as
 * well as these: the page it hands over still answers `no-preference` to
 * `matchMedia`, and every duration in the app is what it always was. Asked of
 * the page, it takes. A spec whose emulation quietly did not happen is a spec
 * that passes because the app was never questioned, so this is asked of the
 * page and each test names what it expects to find moving.
 */
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

const CAST = [
  { id: 'nell', name: 'Nell', description: 'Kept the light with Tomas.', enabled: true },
  { id: 'tomas', name: 'Tomas', description: 'The keeper before her father.', enabled: false },
];

test('the page, the bar and the panel have nothing left to animate', async ({ page, app }) => {
  await app.open({ mode: 'roleplay', characters: CAST });
  await send(page, 'I climb the stairs.');
  await waitForTurn(page);
  await openPanel(page);

  // The two that are on screen and would move: the knob of a cast row's
  // switch, which slides across its track, and the rail of actions, which
  // slides in from the margin. Named here so that an empty list below is the
  // answer to a question and not the absence of one.
  await expect(chapterPanel(page).locator('.in-scene .knob').first()).toBeVisible();
  await expect(page.locator('article[data-role] .rail').first()).toBeAttached();

  expect(await moving(page)).toEqual([]);
});

test('the save dot does not fade in while a write is in flight', async ({ page, app }) => {
  await app.open({ mode: 'roleplay', characters: CAST });
  // A write that will not land for a while, so the indicator it puts up can be
  // read at leisure. Reads are left alone: the app starts by making them.
  await page.route('**/api/**', async (route) => {
    if (route.request().method() !== 'GET') await new Promise((done) => setTimeout(done, 3_000));
    await route.continue();
  });

  await openPanel(page);
  await chapterPanel(page)
    .getByRole('switch', { name: /Tomas is in the scene/ })
    .click();

  const saving = page.locator('li-save-status .status');
  await expect(saving).toHaveAttribute('aria-label', /Saving/);
  expect(await moving(page)).toEqual([]);
});

test('a block dragged past the others does not push them about', async ({ page, app }) => {
  await app.open({ developerMode: true, persona: { name: 'Mara', description: 'a biologist' } });
  await openPromptPreview(page);

  const names = page.locator('.block.movable .name');
  const before = await blockNames(names);
  const second = page.locator('.block.movable', { hasText: before[1] }).locator('.handle');
  await startDrag(page, second, page.locator('.block.movable').first());
  // The class the transition hangs off. Without it the rule is not in play and
  // the measurement below is worth nothing.
  await expect(page.locator('.cdk-drop-list-dragging')).toHaveCount(1);

  expect(await moving(page)).toEqual([]);

  // And the drop still lands, which is the other half of what the rule says:
  // the CDK animates a dropped block into its place and holds on to it until
  // that transition ends, so the durations are an instant rather than none.
  await page.mouse.up();
  await expect(page.locator('.cdk-drag-preview')).toHaveCount(0);
  await expect.poll(() => blockNames(names)).toEqual([before[1], before[0], ...before.slice(2)]);
});

/** The movable blocks in the order they are read, set in capitals or not. */
async function blockNames(names: Locator): Promise<string[]> {
  return (await names.allTextContents()).map((name) => name.trim());
}

/**
 * A CDK drag, left half done: the mouse is still down and the list is still
 * sorting when this returns. The two moves are what `prompt-order.spec.ts`
 * found the drop list needs — one to get past the threshold it starts
 * tracking at, and one that lands inside the target's upper half.
 */
async function startDrag(page: Page, handle: Locator, target: Locator): Promise<void> {
  await page.locator('mat-dialog-content').evaluate((el) => (el.scrollTop = 0));
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('nothing to drag');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y - 10, { steps: 6 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.25, { steps: 20 });
}
