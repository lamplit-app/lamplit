import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from '../server/src/ports.js';

/**
 * `npm run smoke` — a completely fresh install, in one command.
 *
 * Builds the package, unzips the archive (not the staging folder: the archive
 * is part of what is being tested) into an empty directory, and starts it the
 * way anyone else would, through start.bat or start.sh.
 *
 * An empty `data/` folder is all it takes to be empty: the browser keeps no
 * documents of its own, so there is nothing else that could carry a story over
 * from the last run. (It was not always so. This script used to rotate the port
 * every run, because browser storage is keyed by origin and a browser holding
 * documents would upload them into the new install. Deleting that storage
 * deleted the need for the trick.)
 *
 * Ctrl+C stops it. Run it again and the folder and the data are both new.
 *
 *   --no-build   reuse the last archive
 *   --port N     listen somewhere other than the default
 *   --check      stop as soon as it answers, and exit 0 — for CI
 *
 * `--check` is the same walk with nobody to walk it: it proves that what was
 * packaged unzips, starts and serves. Nothing else covers that. A dependency
 * npm put somewhere tools/package.mjs did not look is invisible until then —
 * the stage is written, the zip is made, the installers are built, and the
 * server dies on the reader's machine with ERR_MODULE_NOT_FOUND. It runs in
 * .github/actions/verify, so it is no longer a thing to remember.
 *
 * The automated half of the same walk is e2e/specs/journey.spec.ts; the script
 * to follow here is e2e/LIVE-TEST.md.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WINDOWS = process.platform === 'win32';
const BUILD = join(ROOT, 'build');

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const zip = join(BUILD, `lamplit-${version}.zip`);
const fresh = join(BUILD, 'fresh-install');

const argv = process.argv.slice(2);
const skipBuild = argv.includes('--no-build');
const check = argv.includes('--check');
const port = argv.includes('--port') ? Number(argv[argv.indexOf('--port') + 1]) : DEFAULT_PORT;
const url = `http://127.0.0.1:${port}/`;

let server = null;
let stopping = false;

await main().catch(async (error) => {
  console.error(`\nsmoke: ${error.message}`);
  await stop(1);
});

async function main() {
  if (skipBuild && !existsSync(zip))
    throw new Error(`no archive at ${zip}. Run without --no-build.`);
  if (!skipBuild) {
    step('packaging');
    run(process.execPath, [join(ROOT, 'tools', 'package.mjs')]);
  }

  step('unpacking into an empty folder');
  try {
    await rm(fresh, { recursive: true, force: true });
  } catch (error) {
    // Almost always the server from the last smoke run, still holding it open.
    if (error.code !== 'EBUSY' && error.code !== 'EPERM') throw error;
    throw new Error(
      `${fresh} is locked — a server from an earlier smoke run is probably still ` +
        'going. Stop it (Ctrl+C in its window) and try again.',
      { cause: error },
    );
  }
  extract(zip, fresh);
  const app = join(fresh, `lamplit-${version}`);
  if (!existsSync(app)) throw new Error(`the archive did not unpack as expected into ${fresh}`);

  step('starting it the way anyone else would');
  console.log(`   ${app}`);
  // cmd.exe splits its command line on spaces, and the temporary folder this
  // unpacked into may well contain one, so the script is named as an argument
  // to be run rather than as the command line itself.
  const script = join(app, WINDOWS ? 'start.bat' : 'start.sh');
  server = spawn(WINDOWS ? 'cmd.exe' : script, WINDOWS ? ['/c', script] : [], {
    cwd: app,
    stdio: 'inherit',
    // No browser under --check: there is nobody to show it to, and on a CI
    // runner the call either fails or opens something nothing will close.
    env: { ...process.env, LAMPLIT_PORT: String(port), LAMPLIT_OPEN: check ? '0' : '1' },
  });
  server.on('exit', (code) => stop(code ?? 0));
  server.on('error', (error) => {
    console.error(`smoke: ${error.message}`);
    void stop(1);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));

  await waitForHealth(url);

  if (check) {
    step('it answered /api/health');
    console.log(`   ${url}api/health — what was packaged runs.`);
    await stop(0);
    return;
  }

  console.log(`\n   ${url}`);
  console.log('   an empty data folder and no key: it opens on the connection sheet.');
  console.log('   the script to follow is e2e/LIVE-TEST.md. Ctrl+C stops it.\n');
}

// -- the pieces --------------------------------------------------------------

async function waitForHealth(url, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (stopping) process.exit(0);
    const up = await fetch(`${url}api/health`).then(
      (response) => response.ok,
      () => false,
    );
    if (up) return;
    if (Date.now() > deadline) throw new Error(`the server never came up on ${url}`);
    await new Promise((fulfil) => setTimeout(fulfil, 200));
  }
}

async function stop(code) {
  if (stopping) return;
  stopping = true;
  // start.bat is a cmd.exe that spawned node: killing it leaves the server
  // holding the port and, with nobody at the keyboard, the pipe the CI step is
  // waiting on. Ctrl+C by hand signals the whole group and never needed this,
  // which is why it took until --check to notice.
  if (WINDOWS && server?.pid) {
    spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    server?.kill();
  }
  process.exit(code);
}

/** Whatever unzips archives on this machine; both are there by default. */
function extract(archive, into) {
  const result = WINDOWS
    ? spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -Path '${archive}' -DestinationPath '${into}' -Force`,
        ],
        { stdio: 'inherit' },
      )
    : spawnSync('unzip', ['-q', archive, '-d', into], { stdio: 'inherit' });
  if (result.error) throw new Error(`could not unzip: ${result.error.message}`);
  if (result.status !== 0) throw new Error('unzip failed');
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

function step(message) {
  console.log(`\n• ${message}`);
}
