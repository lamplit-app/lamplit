import { BrowserWindow, Menu, app, dialog, ipcMain, nativeTheme, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { shouldCheck } from './updates.mjs';

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
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Packaged, the staged folder from `tools/package.mjs` sits unpacked beside the
 * asar; in development it is the repository itself. Either way it holds
 * `server/` and the built app, which is all this file needs to find.
 */
const BUNDLE = app.isPackaged ? join(process.resourcesPath, 'app') : resolve(HERE, '..');
const SERVER = join(BUNDLE, 'server', 'src');
const PUBLIC_DIR = app.isPackaged
  ? join(BUNDLE, 'public')
  : join(BUNDLE, 'app', 'dist', 'app', 'browser');

/**
 * Where everything this person has written lives. The installer's answer is the
 * profile, which is the only user-visible difference from the zip and is what
 * *docs/desktop.md* documents. Two things move it:
 *
 * - `PORTABLE_EXECUTABLE_DIR`, set by electron-builder's portable build, which
 *   puts `data/` beside the .exe exactly as the zip does — the point of a
 *   portable build being that the stick holds the stories too.
 * - `LAMPLIT_USER_DATA`, which is how the desktop spec gets a first run every time,
 *   and how anyone else can keep a profile somewhere of their choosing.
 */
const PROFILE =
  process.env['LAMPLIT_USER_DATA'] ??
  process.env['PORTABLE_EXECUTABLE_DIR'] ??
  app.getPath('userData');
if (PROFILE !== app.getPath('userData')) app.setPath('userData', resolve(PROFILE));
// Moving `userData` moves Chromium's own caches with it — fifteen folders of
// them, next to the two that hold the writing. On a stick that is churn on the
// stick; anywhere it is a profile nobody can read at a glance. They go into a
// folder of their own, still inside the profile, so a portable copy is still
// self-contained.
app.setPath('sessionData', join(app.getPath('userData'), 'browser'));

const DATA_DIR = join(app.getPath('userData'), 'data');
const BACKUPS_DIR = join(app.getPath('userData'), 'backups');
const WINDOW_STATE = join(app.getPath('userData'), 'window.json');

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
 */
const DIRECT = { mode: 'direct' };
const SYSTEM = { mode: 'system' };

const DEFAULT_WINDOW = { width: 1180, height: 820 };
/** Small enough for a laptop, wide enough that the reading column is not squeezed. */
const MINIMUM_WINDOW = { width: 720, height: 520 };

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
 * lifetime and nothing else: what it is, why it is locked and when it opens are
 * all in `server/src/share.js`, and the window is no more able to reach it than
 * a browser tab is.
 *
 * @type {{ close(): Promise<void> } | null}
 */
let sharing = null;
let finished = false;
/** @type {BrowserWindow | null} */
let window = null;
/**
 * The app's own address, once there is one. Null while the splash is up, which
 * is what the navigation guard reads it for: before the server is listening
 * there is no address that counts as staying inside the app.
 *
 * @type {string | null}
 */
let appUrl = null;
/** @type {{version: string, commit: string, builtAt: string, build: string, channel: string} | null} */
let build = null;

/**
 * The window first, the server second.
 *
 * Everything below the `openWindow` line — importing the server, opening its
 * store, listening, then Chromium loading and Angular bootstrapping — takes a
 * fraction of a second on a warm machine and a great deal longer on the first
 * run after installing, where Windows is also scanning a new program. A
 * launcher that shows nothing for that long is a launcher people click again,
 * or give up on. So the window is created and shown before any of it, with a
 * page of its own saying what is happening, and navigates to the app when
 * there is an app to navigate to.
 */
async function start() {
  await openWindow();

  if (!existsSync(join(PUBLIC_DIR, 'index.html'))) {
    return fatal(new Error(`no built app at ${PUBLIC_DIR} — run \`npm run build\` first.`));
  }

  // One call, into the same sequence the zip runs — the build stamp, what ran
  // here last, the update checker the /api/updates endpoint answers from,
  // sharing, the app, the store, the listener, the daily backup. It is the
  // whole of what the shell used to re-implement through six imports of the
  // server's own modules, in an order that had already drifted from theirs.
  const { bootstrap, versionLine } = await import(pathToFileURL(join(SERVER, 'bootstrap.js')).href);
  const started = await bootstrap({
    root: BUNDLE,
    dataDir: DATA_DIR,
    backupsDir: BACKUPS_DIR,
    publicDir: PUBLIC_DIR,
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
  build = started.build;
  sharing = started.sharing;
  server = started.server;
  const url = started.url;
  if (started.upgraded) {
    console.log(`upgraded ${started.previousVersion} → ${build.version}`);
  }
  // Honoured, not thrown: a machine that was sharing when it was shut down
  // should be sharing again, and a port that is busy this morning must still
  // leave a window that opens.
  if (started.shared.error) {
    console.warn(`sharing was on, but could not be opened: ${started.shared.error}`);
  }

  denyPermissions();
  ipcMain.handle('lamplit:open-data-folder', openDataFolder);
  // The page asks for the update check rather than the shell taking it: the
  // switch that governs it is in the app's settings.json, which the shell
  // deliberately cannot read. It does not wait for an answer, and there is
  // none — the check takes as long as GitHub takes, and downloads after that.
  ipcMain.handle('lamplit:check-for-updates', (_event, setting) => {
    void checkForUpdates(setting);
  });
  // Reported from the same place and for the same reason as the line above:
  // the switch is in the app's settings.json and the shell may not read it.
  // Off — the default, and what the window started under — is direct.
  ipcMain.handle('lamplit:use-system-proxy', (_event, enabled) =>
    session.defaultSession.setProxy(enabled ? SYSTEM : DIRECT),
  );
  Menu.setApplicationMenu(buildMenu(versionLine(build)));

  // Same window, same background colour, so the hand-over is a change of
  // words rather than a flash. `loadURL` from here does not fire
  // `will-navigate`, so the guard below only ever sees the page's own
  // navigations — but it needs the address first.
  appUrl = url;
  await window?.loadURL(url);
}

/**
 * The one thing the app asks the browser for, and it asks for it on a click:
 * Copy, on a message and on the prompt preview. Everything else on Chromium's
 * list — the camera, the microphone, the location, notifications, reading the
 * clipboard rather than writing it — this app has never used and has no reason
 * to, and Electron grants all of them by default. A page that got in here
 * could ask; now it is told no before anyone is.
 *
 * Both handlers, because they answer different questions: `request` is a page
 * asking for something, `check` is `navigator.permissions.query` and the
 * silent grant behind `navigator.clipboard.writeText`.
 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write']);

function denyPermissions() {
  const { defaultSession } = session;
  defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission)),
  );
  defaultSession.setPermissionCheckHandler((_contents, permission) =>
    ALLOWED_PERMISSIONS.has(permission),
  );
}

async function openWindow() {
  // Before the window exists, because the first request it makes must not go
  // out under a configuration Chromium is still resolving. See DIRECT.
  await session.defaultSession.setProxy(DIRECT);

  const state = await readWindowState();
  window = new BrowserWindow({
    ...state,
    minWidth: MINIMUM_WINDOW.width,
    minHeight: MINIMUM_WINDOW.height,
    // Not `ready-to-show`, which waits for the first paint of a page that is
    // waiting for the server: Electron's own advice for anything bigger than a
    // simple page is to show the window at once on its background colour.
    show: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? PAGE.dark : PAGE.light,
    title: 'Lamplit',
    webPreferences: {
      preload: join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // A "get a key" link is somewhere to go, not somewhere to navigate the app.
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    openExternal(target);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, target) => {
    if (!appUrl || !target.startsWith(appUrl)) {
      event.preventDefault();
      openExternal(target);
    }
  });

  // The page stops the window closing when its queue is failing — the one case
  // where leaving loses what was written. A browser would ask; Electron does
  // not, it asks *us*, and a shell that says nothing here is a window whose
  // close button does nothing at all, with no reason given.
  window.webContents.on('will-prevent-unload', (event) => {
    const answer = dialog.showMessageBoxSync(window ?? undefined, {
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
    // preventDefault here means "overrule the page": close in spite of it.
    if (answer === 1) event.preventDefault();
  });

  window.on('close', rememberWindow);
  window.on('closed', () => (window = null));

  await window.loadFile(join(HERE, 'splash.html'));
}

/** The one thing the shell does that the web app cannot do for itself. */
async function openDataFolder() {
  await mkdir(DATA_DIR, { recursive: true }).catch(() => {});
  await shell.openPath(DATA_DIR);
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

// -- the window's size and place ---------------------------------------------

async function readWindowState() {
  try {
    const saved = JSON.parse(await readFile(WINDOW_STATE, 'utf8'));
    const width = Math.max(MINIMUM_WINDOW.width, Number(saved.width) || DEFAULT_WINDOW.width);
    const height = Math.max(MINIMUM_WINDOW.height, Number(saved.height) || DEFAULT_WINDOW.height);
    const place =
      Number.isInteger(saved.x) && Number.isInteger(saved.y) ? { x: saved.x, y: saved.y } : {};
    return { width, height, ...place };
  } catch {
    return { ...DEFAULT_WINDOW };
  }
}

/**
 * Written on close rather than on every move: the app's own documents are
 * debounced through the server, and this is not one of them.
 */
function rememberWindow() {
  if (!window || window.isMinimized()) return;
  const [width, height] = window.getSize();
  const [x, y] = window.getPosition();
  const state = window.isMaximized() ? { width, height } : { width, height, x, y };
  writeFile(WINDOW_STATE, `${JSON.stringify(state, null, 2)}\n`, 'utf8').catch(() => {});
}

// -- the menu ----------------------------------------------------------------

/** `version` is the line the server made of the stamp, ready to show. */
function buildMenu(version) {
  return Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Open data folder', click: openDataFolder },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    // Without these six, copy and paste do not work on macOS at all.
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Lamplit on the web', click: () => openExternal(WEBSITE) },
        { label: 'Report a problem', click: () => openExternal(`${REPOSITORY}/issues`) },
        { type: 'separator' },
        // The same line the About sheet shows, from the same stamp.
        { label: `Version ${version}`, enabled: false },
      ],
    },
  ]);
}

const WEBSITE = 'https://lamplit-app.github.io/lamplit/';
const REPOSITORY = 'https://github.com/lamplit-app/lamplit';

// -- updates -----------------------------------------------------------------

/**
 * Checked once, when the page says it may, against the same GitHub release the
 * installer came from. Best effort by design: a machine that is offline, or a
 * build that was never published, must not produce a dialog about it.
 *
 * Whether it may at all is `shouldCheck`, next door, where a test can ask it.
 *
 * @param {boolean} [setting] Preferences → Advanced, as the page reports it.
 */
async function checkForUpdates(setting) {
  const allowed = shouldCheck({
    isPackaged: app.isPackaged,
    portable: Boolean(process.env['PORTABLE_EXECUTABLE_DIR']),
    env: process.env,
    setting,
  });
  if (!allowed) return;
  try {
    const { autoUpdater } = await import('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.on('error', (error) => console.warn(`update check failed: ${error.message}`));
    await autoUpdater.checkForUpdatesAndNotify();
  } catch (error) {
    console.warn(`update check failed: ${error.message}`);
  }
}

// -- shutting down -----------------------------------------------------------

/**
 * The last debounced write leaves the page on `beforeunload`, which closing the
 * window fires; the server is closed after it so that write has somewhere to
 * land.
 */
app.on('window-all-closed', () => app.quit());

app.on('will-quit', (event) => {
  if (finished) return;
  event.preventDefault();
  const closing = server;
  server = null;
  // A phone still holding a socket open is not a reason for Quit not to quit,
  // and `close` there drops the sockets rather than waiting on them.
  const shared = sharing;
  sharing = null;
  void shared?.close().catch(() => {});

  const finish = () => {
    if (finished) return;
    finished = true;
    // Not app.quit(): once a quit has been prevented, Electron ignores the
    // next one, and by here the windows are gone and the server is shut. There
    // is nothing left to be graceful about.
    app.exit(0);
  };

  if (!closing) return finish();
  closing.close(finish);
  // The window's keep-alive sockets outlive the window they belonged to, and a
  // server holding one never finishes closing. Idle ones go at once; anything
  // still in flight — the last beacon — gets its moment and then goes too.
  closing.closeIdleConnections();
  setTimeout(() => {
    closing.closeAllConnections();
    finish();
  }, SHUTDOWN_GRACE);
});

/** Long enough for a beacon to land, short enough that Quit means quit. */
const SHUTDOWN_GRACE = 1500;

function fatal(error) {
  console.error(`Lamplit could not start: ${error.stack ?? error.message}`);
  // A packaged app has no console anyone is watching, and a launcher that
  // appears to do nothing is the worst way to say something went wrong.
  if (app.isPackaged) {
    const said = String(error.message ?? error);
    // Parented to the window when there is one — which, since the window now
    // opens before anything that can fail, there almost always is. A box with
    // no parent is a box that can end up behind the very window it is about.
    if (window && !window.isDestroyed()) {
      dialog.showMessageBoxSync(window, {
        type: 'error',
        title: 'Lamplit could not start',
        message: 'Lamplit could not start',
        detail: said,
      });
    } else {
      dialog.showErrorBox('Lamplit could not start', said);
    }
  }
  app.exit(1);
}
