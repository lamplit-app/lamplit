import { BrowserWindow, dialog, nativeTheme } from 'electron';
import { MINIMUM_WINDOW } from './window-state.mjs';

/**
 * The one window, and the three rules it opens under.
 *
 * The rules are the whole content of this file: where a link goes, where a
 * navigation is allowed to go, and what to say when the page refuses to be
 * closed. Everything about *what size* the window is, and where it was last
 * time, is in `window-state.mjs`, which has no Electron in it and a test.
 */

/**
 * The app's own page colour, both halves of it, copied from the palette in
 * *app/src/styles.scss*. The window is painted in it from the moment it opens,
 * before there is a page in it at all, so there is no white flash and no empty
 * grey rectangle. Which half is Chromium's answer, not Preferences': the shell
 * is not allowed to read the app's settings, and `nativeTheme` is the same
 * signal the splash page reads as `prefers-color-scheme`.
 */
const PAGE = { light: '#f6f3ec', dark: '#14151a' };

/**
 * @param {object} what
 * @param {{width: number, height: number, x?: number, y?: number}} what.state
 * @param {string} what.preload           the bridge, which is the only script the page gets
 * @param {(url: string) => boolean} what.inside  whether a navigation stays in the app
 * @param {(url: string) => unknown} what.openExternal  where everything else goes
 * @returns {BrowserWindow}
 */
export function openWindow({ state, preload, inside, openExternal }) {
  const window = new BrowserWindow({
    ...state,
    minWidth: MINIMUM_WINDOW.width,
    minHeight: MINIMUM_WINDOW.height,
    // Not `ready-to-show`, which waits for the first paint of a page that is
    // waiting for the server: Electron's own advice for anything bigger than a
    // simple page is to show the window at once on its background colour.
    show: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? PAGE.dark : PAGE.light,
    title: 'Lamplit',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  // A "get a key" link is somewhere to go, not somewhere to navigate the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (inside(url)) return;
    event.preventDefault();
    openExternal(url);
  });
  window.webContents.on('will-prevent-unload', (event) => {
    if (closeAnyway(window)) event.preventDefault();
  });

  return window;
}

/**
 * The page stops the window closing when its queue is failing — the one case
 * where leaving loses what was written. A browser would ask; Electron does
 * not, it asks *us*, and a shell that says nothing here is a window whose
 * close button does nothing at all, with no reason given.
 *
 * True means overrule the page and close in spite of it, which is what
 * `preventDefault` on a `will-prevent-unload` event says.
 */
function closeAnyway(window) {
  const answer = dialog.showMessageBoxSync(window, {
    type: 'warning',
    buttons: ['Keep Lamplit open', 'Close anyway'],
    defaultId: 0,
    cancelId: 0,
    title: 'Lamplit',
    message: 'Some of what you have written has not been saved yet.',
    detail:
      'Lamplit cannot reach its own server, so the last few changes are still ' +
      'only in this window. Keep it open and they will be saved as soon as the ' +
      'server answers again.',
  });
  return answer === 1;
}
