import type { Locator, Page } from '@playwright/test';
import { openPreferences } from './helpers';
import { expect, test } from './fixtures';

/**
 * Reading the story on a phone, and what happens when both of them write.
 *
 * The "phone" here is a second browser context: its own cookie jar, which is
 * the whole of what pairing is, so a context that has not scanned the code is
 * exactly as unpaired as a phone that has not. The shared listener is on the
 * loopback in this suite (see `PersistenceServer`), which changes nothing about
 * the lock — the pairing middleware is in front of it either way.
 */

/** Opens Preferences and unfolds Advanced, where the switch lives. */
async function openAdvanced(page: Page): Promise<Locator> {
  await openPreferences(page);
  const preferences = page.getByRole('dialog');
  await preferences.getByRole('button', { name: 'Advanced' }).click();
  await expect(preferences.getByRole('switch', { name: 'Share on this network' })).toBeVisible();
  return preferences;
}

/** The switch itself, which every test here starts by flipping. */
function shareSwitch(scope: Locator) {
  return scope.getByRole('switch', { name: 'Share on this network' });
}

test.describe('sharing on this network', () => {
  test('a phone that scans the code gets the story, and one that has not does not', async ({
    browser,
    page,
    server,
    app,
  }) => {
    await app.open({ title: 'The Lighthouse' });
    const preferences = await openAdvanced(page);

    // Nothing is listening anywhere but on this machine until the switch is on.
    await expect(shareSwitch(preferences)).toHaveAttribute('aria-checked', 'false');
    await shareSwitch(preferences).click();
    await expect(shareSwitch(preferences)).toHaveAttribute('aria-checked', 'true');
    // The warning is not fine print: it is the reason the code exists.
    await expect(preferences.getByText(/can do everything you can here/)).toBeVisible();

    const phone = await browser.newContext();
    try {
      const phonePage = await phone.newPage();

      await phonePage.goto(server.sharedUrl);
      await expect(phonePage.getByText('Scan the code on the computer')).toBeVisible();

      // What the QR code encodes. The app is never told the token, so this is
      // the camera's part of the job and nothing else.
      await phonePage.goto(`${server.sharedUrl}/pair/${await server.shareToken()}`);
      await expect(phonePage).toHaveURL(`${server.sharedUrl}/`);
      await expect(phonePage.locator('li-top-bar')).toContainText('The Lighthouse');

      // And it stays paired without scanning again.
      await phonePage.goto(server.sharedUrl);
      await expect(phonePage.locator('li-top-bar')).toContainText('The Lighthouse');
    } finally {
      await phone.close();
    }
  });

  test('the switch survives a restart, and switching it off shuts the door', async ({
    browser,
    page,
    server,
    app,
  }) => {
    await app.open();
    const preferences = await openAdvanced(page);
    await shareSwitch(preferences).click();
    await expect(preferences.getByText(/can do everything you can here/)).toBeVisible();

    await server.stop();
    await server.start();
    // The setting is the server's, in `server.json`, so it comes back with it.
    const phone = await browser.newContext();
    try {
      const phonePage = await phone.newPage();
      await phonePage.goto(`${server.sharedUrl}/pair/${await server.shareToken()}`);
      await expect(phonePage.getByRole('button', { name: 'Story', exact: true })).toBeVisible();

      await server.setShare(false);
      // The listener is gone; the computer's own is untouched.
      await expect(phonePage.goto(server.sharedUrl)).rejects.toThrow();
      await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible();
    } finally {
      await phone.close();
    }
  });

  test('a new code unpairs the phone that scanned the old one', async ({
    browser,
    page,
    server,
    app,
  }) => {
    await app.open();
    const preferences = await openAdvanced(page);
    await shareSwitch(preferences).click();
    await expect(preferences.getByRole('button', { name: 'New code' })).toBeVisible();

    const phone = await browser.newContext();
    try {
      const phonePage = await phone.newPage();
      const first = await server.shareToken();
      await phonePage.goto(`${server.sharedUrl}/pair/${first}`);
      await expect(phonePage.getByRole('button', { name: 'Story', exact: true })).toBeVisible();

      await preferences.getByRole('button', { name: 'New code' }).click();
      await page.getByRole('button', { name: 'Make a new code' }).click();
      await expect.poll(() => server.shareToken()).not.toBe(first);

      await phonePage.goto(server.sharedUrl);
      await expect(phonePage.getByText('Scan the code on the computer')).toBeVisible();

      // Scanning the new one is the way back in.
      await phonePage.goto(`${server.sharedUrl}/pair/${await server.shareToken()}`);
      await expect(phonePage.getByRole('button', { name: 'Story', exact: true })).toBeVisible();
    } finally {
      await phone.close();
    }
  });
});

test.describe('two devices, one document', () => {
  test('a write onto a document the other device changed is refused and reloaded', async ({
    page,
    server,
    app,
  }) => {
    await app.open();
    await openPreferences(page);
    const preferences = page.getByRole('dialog');

    // The phone, in the only way that matters here: a conditional write to the
    // same document, based on the revision it read.
    await server.writeAs('settings', 'settings', (settings) => ({
      ...settings,
      ui: { ...(settings['ui'] as Record<string, unknown>), fontSize: 23 },
    }));

    // This window has been holding the older revision all along.
    const tokens = preferences.getByRole('switch', { name: 'Show token counts' });
    await expect(tokens).toHaveAttribute('aria-checked', 'true');
    await tokens.click();

    await expect(page.getByText('Changed on another device; reloaded.')).toBeVisible();
    // What the other device wrote is what is on disk and what is on screen.
    await expect
      .poll(async () => (await server.document('settings'))?.['ui'])
      .toMatchObject({
        fontSize: 23,
        showTokenCounts: true,
      });
    await expect(tokens).toHaveAttribute('aria-checked', 'true');

    // And the second attempt, from the document that was reloaded, lands.
    await tokens.click();
    await expect
      .poll(async () => (await server.document('settings'))?.['ui'])
      .toMatchObject({ fontSize: 23, showTokenCounts: false });
    await expect(page.getByText('Changed on another device; reloaded.')).toBeVisible();
  });

  test('coming back to the tab shows what the other device wrote', async ({
    page,
    server,
    app,
  }) => {
    await app.open({ title: 'The Lighthouse' });
    await expect(page.locator('li-top-bar')).toContainText('The Lighthouse');

    await server.writeAs('stories', 'story-under-test', (story) => ({
      ...story,
      title: 'Renamed on the phone',
    }));

    // Nothing is pushed, so nothing has changed here yet.
    await expect(page.locator('li-top-bar')).toContainText('The Lighthouse');

    // Looking at the window again is the moment it asks. A second tab in the
    // same context is how a headless browser hides the first one.
    const other = await page.context().newPage();
    await other.goto('about:blank');
    await page.bringToFront();
    await other.close();

    await expect(page.locator('li-top-bar')).toContainText('Renamed on the phone');
    await expect(page.getByText('Changed on another device; reloaded.')).toBeVisible();
  });
});
