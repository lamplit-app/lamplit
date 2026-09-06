import { openPreferences } from './helpers';
import { expect, test } from './fixtures';

/**
 * What the bar holds, what it gives up when it runs out of room, and the one
 * time it has something to say.
 *
 * The last two are measurements rather than pictures. Whether a long title ends
 * in an ellipsis or stops mid-word is a question of which element the overflow
 * happens on, and whether the offline indicator reads as a status or as another
 * button is a question of what is drawn round it — so those are what is asked
 * here, off the rendered page.
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

test('offline is drawn as a status, not as another button', async ({ page, app }) => {
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
  // One of the three named buttons; all three are the same accent text.
  const button = await drawn(page.getByRole('button', { name: 'Story', exact: true }));

  expect(status.colour).not.toBe(button.colour);
  expect(button.border).toBe('none');
  expect(status.border).toBe('1px');
  expect(status.fill).not.toBe('rgba(0, 0, 0, 0)');
});

test('the bar names the story and nothing else, and the model carries its parameters', async ({
  page,
  app,
}) => {
  await page.setViewportSize({ width: 1240, height: 800 });
  await app.open();

  const bar = page.locator('li-top-bar header');
  for (const name of ['Story', 'World', 'Chapters']) {
    await expect(bar.getByRole('button', { name, exact: true })).toBeVisible();
  }
  // Neither of the two that were not about the story is a button anywhere.
  for (const name of ['Parameters', 'Preferences']) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }

  await bar.getByRole('button', { name: /Storyteller Large|Connect a model/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Model' })).toBeVisible();
  // Connection first: it is the one that has to be answered before the other
  // one means anything.
  await expect(sheet.getByRole('tab', { name: 'Connection' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // Reset to defaults puts the sampling set back, so it belongs to the tab that
  // holds the sampling set and is not offered beside an endpoint.
  await expect(sheet.getByRole('button', { name: 'Reset to defaults' })).toHaveCount(0);
  await sheet.getByRole('tab', { name: 'Parameters' }).click();
  await expect(sheet.getByRole('button', { name: 'Reset to defaults' })).toBeVisible();
  await expect(sheet.getByLabel('Stop sequences')).toBeVisible();

  // And Ctrl+K opens the same sheet, on the same tab.
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog').getByRole('tab', { name: 'Connection' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('⋯ is this chapter, then the app, in three groups', async ({ page, app }) => {
  await app.open();

  await page.getByRole('button', { name: 'More actions' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText([
    /^\s*New chapter…\s*$/,
    /^\s*Edit this scene…\s*$/,
    /^\s*Clear this chapter\s*$/,
    // The shortcut is written on the item, the way an editor writes it.
    /^\s*Preferences…\s*Ctrl\+,\s*$/,
    /^\s*About Lamplit…\s*$/,
  ]);
  await expect(menu.locator('hr')).toHaveCount(2);
});

test('Ctrl+, opens Preferences from the page, and does nothing over a sheet', async ({
  page,
  app,
}) => {
  await app.open();

  await page.keyboard.press('Control+,');
  await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible();

  // The page's shortcuts stop at the edge of a sheet, so the second press does
  // not stack a second Preferences on the first.
  await page.keyboard.press('Control+,');
  await expect(page.locator('mat-dialog-container')).toHaveCount(1);
});
