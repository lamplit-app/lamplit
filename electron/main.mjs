import { Menu, app, dialog, ipcMain, shell } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { denyPermissions, useSystemProxy } from './chromium.mjs';
import { saySoAndStop } from './fatal.mjs';
import { menuTemplate } from './menu.mjs';
import { profilePaths } from './profile.mjs';
import { shutDown } from './shutdown.mjs';
import { checkForUpdates } from './updates.mjs';
import { openWindow } from './window.mjs';
import { readWindowState, rememberWindow } from './window-state.mjs';

/**
 * The desktop shell, and nothing else.
 *
 * It starts the same Express server the zip starts, on a free port on the
 * loopback, and opens one window at it. Everything the person sees is the same
 * web app, talking to the same API, saving the same JSON files — the only
 * difference is where those files live (the user's profile rather than a folder
 * beside a script) and the fact that Node came in the box.
 *
 * That is the whole design rule: nothing below is allowed to know anything
 * about stories, chapters or models. If something here starts needing to, the
 * shell is doing too much and the change belongs in `server/` or `app/`.
 *
 * What is left here is the wiring: the order things happen in, and the state
 * that outlives the function that made it. Everything decidable without a
 * running Electron is next door with a test in `tools/test/` —
 * `profile.mjs`, `window-state.mjs`, `menu.mjs`, `shutdown.mjs`, `fatal.mjs`
 * and `updates.mjs` — and the two that do need Electron but are not wiring
 * either are beside them: `chromium.mjs` and `window.mjs`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Packaged, the staged folder from `tools/package.mjs` sits unpacked beside the
 * asar; in development it is the repository itself. Either way it holds
 * `server/` and the built app, which is all this file needs to find.
 */
const BUNDLE = app.isPackaged ? join(process.resourcesPath, 'app') : resolve(HERE, '..');
const SERVER = join(BUNDLE, 'server', 'src');

/** Where the writing is kept, and the caches that must not be kept with it. */
const PROFILE = profilePaths({ env: process.env, userData: app.getPath('userData') });
if (PROFILE.moved) app.setPath('userData', PROFILE.moved);
app.setPath('sessionData', PROFILE.sessionData);

/** A second launch over the same files would be two writers, so there is one. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', focusWindow);
  // `.catch` rather than a second argument: that one only answers for
  // `whenReady` itself, and everything that can actually go wrong — a profile
  // that cannot be written, a port that will not open, an app that will not
  // load — happens inside `start`. Unanswered, it left a process with no
  // window holding the single-instance lock, so relaunching did nothing
  // either, and said nothing at all.
  app.whenReady().then(start).catch(fatal);
}

/** @type {import('node:http').Server | null} */
let server = null;
/**
 * The second listener, when the person has asked for one. The shell owns its
 * lifetime and nothing else: what it is, why it is locked and when it opens
 * are all in `server/src/share.js`, and the window is no more able to reach it
 * than a browser tab is.
 *
 * @type {{ close(): Promise<void> } | null}
 */
let sharing = null;
let finished = false;
/** @type {import('electron').BrowserWindow | null} */
let window = null;
/**
 * The app's own address, once there is one. Null while the splash is up, which
 * is what the navigation guard reads it for.
 *
 * @type {string | null}
 */
let appUrl = null;

/**
 * The window first, the server second.
 *
 * Everything below the `splash` line — importing the server, opening its
 * store, listening, then Chromium loading and Angular bootstrapping — takes a
 * fraction of a second on a warm machine and a great deal longer on the first
 * run after installing, where Windows is also scanning a new program. A
 * launcher that shows nothing for that long is one people click again. So the
 * window is created and shown before any of it, on a page of its own saying
 * what is happening, and navigates to the app when there is one.
 */
async function start() {
  await splash();

  // One call, into the same sequence the zip runs — the build stamp, what ran
  // here last, the update checker /api/updates answers from, sharing, the app,
  // the store, the listener, the daily backup. It is the whole of what the
  // shell used to re-implement through six imports of the server's own
  // modules, in an order that had already drifted from theirs.
  const { bootstrap, versionLine } = await load('bootstrap.js');
  // Packaged, the built app is `public/` beside the server; from the repository
  // it is the Angular output. The server's own function answers for both, and
  // that path is now spelt in exactly one file.
  const { findBuiltApp } = await load('cli.js');

  const publicDir = findBuiltApp(BUNDLE);
  if (!existsSync(join(publicDir, 'index.html'))) {
    return fatal(new Error(`no built app at ${publicDir} — run \`npm run build\` first.`));
  }

  const started = await bootstrap({
    root: BUNDLE,
    dataDir: PROFILE.dataDir,
    backupsDir: PROFILE.backupsDir,
    publicDir,
    // Read from the same stamp beside the same built app the zip reads, so the
    // window and the browser tab cannot disagree about which build this is —
    // `app.getVersion()` knows the version and nothing else. Only the channel
    // is the shell's to say; see version.js for why it is not in the file.
    channel: 'desktop',
    // Port 0: the operating system hands back one that is free, and it is a
    // different one every start. The shared listener is the one that does not
    // move, because a person may read that number off the screen.
    port: 0,
  });
  sharing = started.sharing;
  server = started.server;
  if (started.upgraded) {
    console.log(`upgraded ${started.previousVersion} → ${started.build.version}`);
  }
  // Honoured, not thrown: a machine that was sharing when it was shut down
  // should be sharing again, and a port that is busy this morning must still
  // leave a window that opens.
  if (started.shared.error) {
    console.warn(`sharing was on, but could not be opened: ${started.shared.error}`);
  }

  denyPermissions();
  ipcMain.handle('lamplit:open-data-folder', openDataFolder);
  // The page asks for the update check rather than the shell taking it, and the
  // same for the proxy: both switches are in the app's settings.json, which the
  // shell deliberately cannot read. Neither waits for an answer.
  ipcMain.handle('lamplit:check-for-updates', (_event, setting) => {
    void checkForUpdates({
      isPackaged: app.isPackaged,
      portable: Boolean(process.env['PORTABLE_EXECUTABLE_DIR']),
      env: process.env,
      setting,
    });
  });
  ipcMain.handle('lamplit:use-system-proxy', (_event, enabled) => useSystemProxy(enabled));

  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      menuTemplate({ version: versionLine(started.build), openDataFolder, openExternal }),
    ),
  );

  // Same window, same background colour, so the hand-over is a change of
  // words rather than a flash. `loadURL` from here does not fire
  // `will-navigate`, so the guard only ever sees the page's own navigations —
  // but it needs the address first.
  appUrl = started.url;
  await window?.loadURL(started.url);
}

/** The server's own modules, from wherever this copy of the bundle keeps them. */
function load(module) {
  return import(pathToFileURL(join(SERVER, module)).href);
}
/** The window, on its own page, before there is a server to point it at. */
async function splash() {
  // Before the window exists, because the first request it makes must not go
  // out under a configuration Chromium is still resolving. See chromium.mjs.
  await useSystemProxy(false);

  window = openWindow({
    state: await readWindowState(PROFILE.windowState),
    preload: join(HERE, 'preload.cjs'),
    // Nowhere is inside the app until there is an app: `appUrl` is read at the
    // moment of the navigation rather than captured, because it is null now.
    inside: (url) => Boolean(appUrl) && url.startsWith(appUrl),
    openExternal,
  });
  window.on('close', () => void rememberWindow(PROFILE.windowState, window));
  window.on('closed', () => (window = null));

  await window.loadFile(join(HERE, 'splash.html'));
}

/** The one thing the shell does that the web app cannot do for itself. */
async function openDataFolder() {
  await mkdir(PROFILE.dataDir, { recursive: true }).catch(() => {});
  await shell.openPath(PROFILE.dataDir);
}

function focusWindow() {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
}

/** http(s) only: nothing else is a link the app could have produced. */
function openExternal(target) {
  if (/^https?:\/\//i.test(target)) shell.openExternal(target);
}

// The last debounced write leaves the page on `beforeunload`, which closing
// the window fires; the server is closed after it so that write has somewhere
// to land. The sequence, and why it is that sequence, are in `shutdown.mjs`.
app.on('window-all-closed', () => app.quit());

app.on('will-quit', (event) => {
  if (finished) return;
  event.preventDefault();
  const closing = server;
  server = null;
  const shared = sharing;
  sharing = null;
  shutDown({
    server: closing,
    sharing: shared,
    finish: () => {
      finished = true;
      // Not app.quit(): once a quit has been prevented, Electron ignores the
      // next one, and by here the windows are gone and the server is shut.
      // There is nothing left to be graceful about.
      app.exit(0);
    },
  });
});

/** Said, and stopped: how, and to whom, is in `fatal.mjs`. */
function fatal(error) {
  saySoAndStop({
    error,
    window,
    isPackaged: app.isPackaged,
    dialog,
    exit: (code) => app.exit(code),
  });
}
