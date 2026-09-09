import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrap, localAddresses, versionLine } from './bootstrap.js';
import { findBuiltApp, parseArguments, wantedPort } from './cli.js';

/**
 * The one process a packaged Lamplit runs: documents on disk, the built
 * app in front of them, one URL to open. `start.bat` and `start.sh` do nothing
 * but call this file.
 *
 * What it is, beside `bootstrap.js`: the console. Everything said out loud once
 * the app is up — which is the whole of what a reader watching a terminal
 * window gets, and is why it is written here rather than where the desktop
 * shell can see it. What the command line means, and where the built app is,
 * are in `cli.js`, where a test can ask.
 */

/** `server/src/index.js` → the folder the app was unzipped (or cloned) into. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const { options, port } = read();
const dataDir = resolve(options.data ?? process.env['LAMPLIT_DATA_DIR'] ?? join(ROOT, 'data'));
const backupsDir = resolve(process.env['LAMPLIT_BACKUP_DIR'] ?? join(ROOT, 'backups'));
const publicDir = resolve(
  options.public ?? process.env['LAMPLIT_PUBLIC_DIR'] ?? findBuiltApp(ROOT),
);
const host = process.env['LAMPLIT_HOST'] ?? '127.0.0.1';
// The start scripts pass --open, so LAMPLIT_OPEN=0 has to be able to override it.
const shouldOpen =
  process.env['LAMPLIT_OPEN'] === '0' ? false : options.open || process.env['LAMPLIT_OPEN'] === '1';

const { build, previousVersion, upgraded, updates, sharing, shared, server, url, backup } =
  await bootstrap({
    root: ROOT,
    dataDir,
    backupsDir,
    publicDir,
    host,
    port,
    // Off unless asked for: the app calls its own origin, and `npm start`
    // proxies rather than calling across. See corsFor in security.js.
    devCors: process.env['LAMPLIT_DEV_CORS'] === '1',
  });

console.log(`Lamplit ${versionLine(build)} — ${url}`);
console.log(`  documents  ${dataDir}`);
if (upgraded) console.log(`  upgraded   ${previousVersion} → ${build.version}`);
console.log(
  `  app        ${existsSync(join(publicDir, 'index.html')) ? publicDir : '(not built; API only)'}`,
);

if (!updates.enabled) console.log('  updates    not checked (LAMPLIT_UPDATE_CHECK=0)');

// Said out loud at every start, because it is the one setting that changes who
// can reach the writing, and nobody should have to open a dialog to find out.
if (shared.share) {
  const addresses = localAddresses();
  console.log(`  shared     on this network at :${sharing.port} — pair a phone in Preferences`);
  for (const address of addresses) console.log(`             http://${address}:${sharing.port}/`);
} else if (shared.error) {
  console.warn(`  sharing was on, but could not be opened: ${shared.error}`);
}

// The failure has already been said; a backup that was taken is worth a line.
void backup.then((made) => made && console.log(`  backup     ${made}`));

if (shouldOpen) openBrowser(url);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    // The shared listener first: a phone holding a socket open must not be
    // what keeps the process alive after somebody has asked it to stop.
    void sharing.close().finally(() => server.close(() => process.exit(0)));
  });
}

/**
 * The command line, or one line and a stop. A mistyped flag and a port that is
 * not a number both used to get past here — the first ignored in silence, the
 * second as far as a stack trace out of `net` — and neither is worth more than
 * a sentence to somebody who is looking at a terminal window.
 */
function read() {
  try {
    const options = parseArguments(process.argv.slice(2));
    // Read here too, because the environment can be as wrong as the flag and
    // this is the one place that has somebody to tell.
    return { options, port: wantedPort(options) };
  } catch (error) {
    console.error(`lamplit: ${error.message}`);
    process.exit(1);
  }
}

function openBrowser(target) {
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', target]]
      : process.platform === 'darwin'
        ? ['open', [target]]
        : ['xdg-open', [target]];
  // Best effort: a headless machine simply has nothing to open it with.
  spawn(command, args, { detached: true, stdio: 'ignore' })
    .on('error', () => {})
    .unref();
}
