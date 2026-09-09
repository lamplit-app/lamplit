import { session } from 'electron';

/**
 * What Chromium is allowed to do on this app's behalf: how it reaches the
 * network, and what a page in it may ask for.
 *
 * Two settings, one file, because both are answers to the same question —
 * Electron's defaults are the browser's defaults, and this is not a browser.
 * Neither has anything to do with a story, a window or a menu.
 */

/**
 * Direct, and the reason it has to be.
 *
 * Chromium's default is the operating system's proxy configuration, and on
 * Windows that includes WPAD auto-discovery: it goes looking for a `wpad` host,
 * and on a corporate network or a VPN it finds one. Every request then waits
 * for a PAC file to come back from it — twenty-one seconds, measured, on the
 * machine this was found on — and *every* means every, because Chromium applies
 * its bypass rules only after the configuration has resolved. Loopback is
 * already in those rules and waits all the same, which is why a bypass list is
 * not the fix it looks like, and why Electron documents `--proxy-bypass-list`
 * as having no effect without a `--proxy-server` beside it.
 *
 * Hardly any Electron app meets this, because hardly any of them navigate to
 * `http://` at all: a window on `file:` never enters proxy resolution. This one
 * serves its own page, so it pays on the way in. The splash painted in 0.15 s
 * and the loopback page behind it took 21.2 s.
 *
 * Direct is also what the rest of Lamplit already does — electron-updater asks
 * GitHub through Node, which has never read a system proxy — and what
 * *docs/desktop.md* promises about the model endpoint. Someone who needs the
 * proxy to reach the internet at all switches it back on in Preferences →
 * Advanced, and waits for it then rather than at every start.
 *
 * @param {boolean} [enabled] whether to read the operating system's configuration
 */
export function useSystemProxy(enabled = false) {
  return session.defaultSession.setProxy(enabled ? { mode: 'system' } : { mode: 'direct' });
}

/**
 * The one thing the app asks the browser for, and it asks for it on a click:
 * Copy, on a message and on the prompt preview. Everything else on Chromium's
 * list — the camera, the microphone, the location, notifications, reading the
 * clipboard rather than writing it — this app has never used and has no reason
 * to, and Electron grants all of them by default. A page that got in here
 * could ask; now it is told no before anyone is.
 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write']);

/**
 * Both handlers, because they answer different questions: `request` is a page
 * asking for something, `check` is `navigator.permissions.query` and the
 * silent grant behind `navigator.clipboard.writeText`.
 */
export function denyPermissions() {
  const { defaultSession } = session;
  defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission)),
  );
  defaultSession.setPermissionCheckHandler((_contents, permission) =>
    ALLOWED_PERMISSIONS.has(permission),
  );
}
