import { openPreferences } from './helpers';
import { expect, test } from './fixtures';

/**
 * The bar when it runs out of room, and the one time it has something to say.
 *
 * Both of these are measurements rather than pictures. Whether a long title
 * ends in an ellipsis or stops mid-word is a question of which element the
 * overflow happens on, and whether the offline indicator reads as a status or
 * as a seventh button is a question of what is drawn round it — so those are
 * what is asked here, off the rendered page.
 */

/** The answer the server would give if 0.2.0 had been published. */
const NEWER = {
  ok: true,
  enabled: true,
  checked: true,
  version: '0.0.0',
  latest: null,
  newer: [
    {
      tag: 'v0.2.0',
      version: '0.2.0',
      name: '0.2.0 — the second one',
      publishedAt: '2026-04-02T09:00:00.000Z',
      body: 'A line about what changed.',
      url: 'https://example.invalid/releases/v0.2.0',
      assets: [],
    },
  ],
  releases: [] as unknown[],
};

test('a title too long for the bar ends in an ellipsis, not mid-word', async ({ page, app }) => {
  // The width the documentation screenshots are taken at, where this title
  // fits until the update pill appears and takes the room it was using.
  await page.setViewportSize({ width: 1240, height: 800 });
  await page.route('**/api/updates', (route) => route.fulfill({ json: NEWER }));
  await app.open({
    title: 'The Lantern Room and the Winter It Was Kept Through',
    chapterTitle: 'A hundred and nine steps',
  });
  await expect(page.getByRole('button', { name: /available$/ })).toBeVisible();

  const overflow = await page.locator('li-top-bar .here .label').evaluate((label) => {
    const identity = label.closest('.identity') as HTMLElement;
    return {
      label: label.scrollWidth - label.clientWidth,
      identity: identity.scrollWidth - identity.clientWidth,
    };
  });

  // There is more title than there is bar...
  expect(overflow.label).toBeGreaterThan(0);
  // ...and what hides the rest of it is the ellipsis on the label rather than
  // the hard edge of the box around it, which has nothing to hide.
  expect(overflow.identity).toBeLessThanOrEqual(1);
});

test('offline is drawn as a status, not as a seventh button', async ({ page, app }) => {
  await app.open();

  // The server stops taking documents. Nothing is lost — the session has it
  // all in memory — and the indicator is the only thing that says so.
  await page.route('**/api/docs/**', (route) => route.abort('failed'));
  await openPreferences(page);
  await page.getByRole('switch', { name: 'Show token counts' }).click();
  await page.keyboard.press('Escape');

  const offline = page.getByRole('button', { name: 'Offline' });
  await expect(offline).toBeVisible({ timeout: 20_000 });

  const drawn = (locator: ReturnType<typeof page.locator>) =>
    locator.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        colour: style.color,
        border: style.borderTopStyle === 'none' ? 'none' : style.borderTopWidth,
        fill: style.backgroundColor,
      };
    });

  const status = await drawn(offline);
  // One of the six named buttons; all six are the same accent text.
  const button = await drawn(page.getByRole('button', { name: 'Story', exact: true }));

  expect(status.colour).not.toBe(button.colour);
  expect(button.border).toBe('none');
  expect(status.border).toBe('1px');
  expect(status.fill).not.toBe('rgba(0, 0, 0, 0)');
});
