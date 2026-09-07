import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from '../server/src/ports.js';
import { collectEntries, writeZip } from '../server/src/zip.js';
import { STAMP_FILE, buildStamp } from '../server/src/version.js';
import { productionClosure } from './lib/production-closure.mjs';

/**
 * `npm run package` — the whole app as one folder, and that folder as one zip.
 *
 * Unzip it anywhere and run `start.bat` (Windows), `start.command` (macOS) or
 * `start.sh` (Linux). There is nothing to install: the server's dependencies
 * travel inside, and Node is the only thing expected to be on the machine
 * already — the start scripts check for it and offer the fix if it is missing.
 *
 *   lamplit-<version>/
 *     start.bat             one call, opens the browser
 *     start.command         the same, for double-clicking on a Mac
 *     start.sh              the same, byte for byte, for Linux
 *     server/               the persistence server, unchanged from the repo
 *     public/               the built Angular app, served by it, and the
 *                           version.json stamped into it (see server/src/version.js)
 *     node_modules/         the server's production dependencies, and only those
 *                           — plus, where npm put one there, server/node_modules/
 *     package.json  README.txt
 *     data/                 created on first run, next to the script
 *
 * The desktop build (tools/desktop.mjs) stages through this same file with
 * `--stage <dir> --no-zip` and puts an Electron shell around the result, so
 * this stays the single place that decides what ships.
 *
 * `--stage <dir> --zip-only` is the other half of that: it zips a folder that
 * was already staged, without building or staging anything. The release
 * workflow uses it to make the published zip out of the very folder the
 * installers were built from, so the two channels cannot drift.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILT_APP = join(ROOT, 'app', 'dist', 'app', 'browser');
/** Written by `ng build`, one entry per package bundled into the app. */
const LICENCES_FILE = '3rdpartylicenses.txt';

const options = parseArguments(process.argv.slice(2));
const version = readJson(join(ROOT, 'package.json')).version;
const name = `lamplit-${version}`;
const outDir = resolve(options.out ?? join(ROOT, 'build'));
const stageDir = options.stage ? resolve(options.stage) : join(outDir, name);
const zipPath = join(outDir, `${name}.zip`);

step(`Lamplit ${version} → ${options.zip === false ? stageDir : zipPath}`);

if (options.zipOnly) {
  if (!existsSync(join(stageDir, 'package.json'))) {
    fail(`nothing staged at ${stageDir}. Drop --zip-only to stage it first.`);
  }
  step(`zipping what is already staged in ${stageDir}`);
} else {
  if (options.build === false) {
    step('skipping the Angular build (--no-build)');
  } else {
    step('building the app');
    run('npm', ['run', 'build', '-w', 'app']);
  }
  if (!existsSync(join(BUILT_APP, 'index.html'))) {
    fail(`no built app at ${BUILT_APP}. Run without --no-build.`);
  }

  step('staging');
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });
  await cp(join(ROOT, 'server', 'src'), join(stageDir, 'server', 'src'), { recursive: true });
  await cp(BUILT_APP, join(stageDir, 'public'), { recursive: true });
  // The licences of everything bundled into that JavaScript. Angular writes
  // them beside the build rather than inside it, so they have to be asked for
  // — and Apache-2.0 and BSD-3, which several of them are, require the notice
  // to travel with what it covers. NOTICE says this file is here.
  await cp(join(dirname(BUILT_APP), LICENCES_FILE), join(stageDir, LICENCES_FILE));
  // Next to the built app: which commit, which CI run, and when. The server
  // reads it back and /api/health repeats it, so a bug report can name the
  // build it came from rather than a version two dozen builds have carried.
  const stamp = buildStamp({ version, root: ROOT });
  await writeFile(
    join(stageDir, 'public', STAMP_FILE),
    `${JSON.stringify(stamp, null, 2)}
`,
  );
  await writeFile(join(stageDir, 'package.json'), manifest(), 'utf8');
  await writeFile(join(stageDir, 'start.bat'), startBat().replaceAll('\n', '\r\n'), 'utf8');
  await writeFile(join(stageDir, 'start.sh'), startSh(), { encoding: 'utf8', mode: 0o755 });
  // The same script under the name Finder will run: a double-clicked .sh opens
  // in a text editor, a .command runs. See README.txt.
  await writeFile(join(stageDir, 'start.command'), startSh(), { encoding: 'utf8', mode: 0o755 });
  await writeFile(join(stageDir, 'README.txt'), readme(), 'utf8');

  step('collecting the server’s production dependencies');
  // Each one to the place it holds in the repository, which is the place the
  // stage has to resolve it from — see tools/lib/production-closure.mjs.
  const dependencies = closure();
  for (const [place, from] of dependencies) {
    await cp(from, join(stageDir, ...place.split('/')), { recursive: true });
  }
  console.log(`   ${dependencies.size} packages`);
  console.log(`   stamped  build ${stamp.build}, commit ${stamp.commit || '(no git)'}`);
}

if (options.zip === false) {
  step('done');
  console.log(`   folder  ${stageDir}`);
} else {
  step('zipping');
  await mkdir(outDir, { recursive: true });
  const entries = await collectEntries(stageDir, name, { mode: modeOf });
  const size = await writeZip(zipPath, entries);

  step('done');
  console.log(`   folder  ${stageDir}`);
  console.log(`   zip     ${zipPath}  (${megabytes(size)}, ${entries.length} entries)`);
  console.log(`   unzip it, then run start.bat, start.command or ./start.sh.`);
}

// -- the pieces --------------------------------------------------------------

/** Reported as one line, and a throw from it is one line too rather than a stack. */
function closure() {
  try {
    return productionClosure({ root: ROOT, from: join(ROOT, 'server') });
  } catch (error) {
    fail(error.message);
  }
}

function manifest() {
  const server = readJson(join(ROOT, 'server', 'package.json'));
  return `${JSON.stringify(
    {
      name: 'lamplit',
      version,
      private: true,
      type: 'module',
      description: readJson(join(ROOT, 'package.json')).description,
      main: 'server/src/index.js',
      scripts: { start: 'node server/src/index.js --open' },
      // What the start scripts check for before they start anything. The root
      // package.json is stricter — building the app needs a version Angular
      // will run on — but nothing in here is built.
      engines: server.engines,
      dependencies: server.dependencies,
    },
    null,
    2,
  )}\n`;
}

/**
 * Both start scripts do the same three things: check that Node is there and new
 * enough, offer one command that would fix it if it is not, and start the
 * server. The offer is a prompt — nothing is installed on anything but a yes,
 * and a "no" leaves the advice on screen.
 *
 * The fallback is nodejs.org's download page plus the exact file to pick, rather
 * than a direct link to a file: every direct link on that site carries a version
 * number in it, so one written here would go stale within weeks.
 */
function startBat() {
  return `@echo off
rem Lamplit — start the app and open it in the browser.
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem -- is Node here, and new enough? -----------------------------------------

set FOUND=
for /f "delims=" %%v in ('node -v 2^>nul') do set FOUND=%%v

if not defined FOUND (
  set PROBLEM=Node.js is not installed on this machine.
) else (
  for /f "tokens=1,2 delims=." %%a in ("!FOUND:v=!") do (
    set MAJOR=%%a
    set MINOR=%%b
  )
  set OLD=1
  if !MAJOR! gtr 20 set OLD=
  if !MAJOR! equ 20 if !MINOR! geq 19 set OLD=
  if defined OLD set PROBLEM=This machine has Node.js !FOUND!, which is too old.
)

if not defined PROBLEM goto run

rem -- it is not: say so, then offer the fix ---------------------------------

set ARCH=x64
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set ARCH=arm64
if /i "%PROCESSOR_ARCHITECTURE%"=="x86" set ARCH=x86

echo Lamplit needs Node.js 20.19 or newer. !PROBLEM!
echo.

where winget >nul 2>nul
if errorlevel 1 goto manual

echo This machine has winget, so one command installs it:
echo.
echo     winget install OpenJS.NodeJS.LTS
echo.
set ANSWER=
set /p ANSWER="Run that now? [y/N] "
if /i not "!ANSWER!"=="y" (
  echo.
  goto manual
)

echo.
winget install OpenJS.NodeJS.LTS
if errorlevel 1 (
  echo.
  echo That did not finish, so nothing was installed.
  goto manual
)
echo.
echo Node.js is installed. Close this window and run start.bat again: only a new
echo window sees the change winget made to PATH.
echo.
pause
exit /b 0

:manual
echo Download Node.js from https://nodejs.org/en/download
echo and pick the Windows Installer (.msi) for !ARCH!. Then run start.bat again.
echo.
pause
exit /b 1

rem -- it is: start ----------------------------------------------------------

:run
node "%~dp0server\\src\\index.js" --open %*
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)
exit /b 0
`;
}

function startSh() {
  return `#!/bin/sh
# Lamplit — start the app and open it in the browser.
#
# This file is shipped twice under two names: start.command, which macOS runs
# when it is double-clicked in Finder, and start.sh, for Linux and terminals.
set -eu
cd "$(dirname "$0")"

# -- is Node here, and new enough? --------------------------------------------

node_is_new_enough() {
  command -v node >/dev/null 2>&1 || return 1
  found=$(node -v 2>/dev/null | sed 's/^v//')
  major=\${found%%.*}
  rest=\${found#*.}
  minor=\${rest%%.*}
  case "$major" in '' | *[!0-9]*) return 1 ;; esac
  case "$minor" in '' | *[!0-9]*) return 1 ;; esac
  if [ "$major" -gt 20 ]; then return 0; fi
  if [ "$major" -eq 20 ] && [ "$minor" -ge 19 ]; then return 0; fi
  return 1
}

# The command that would install it here, and the file to fetch by hand if the
# answer is no. Both depend on the machine, so both are worked out before asking.
installer=''
case "$(uname -s)" in
  Darwin)
    case "$(uname -m)" in
      arm64) manual='the macOS Apple Silicon (.pkg) installer' ;;
      *) manual='the macOS Intel (.pkg) installer' ;;
    esac
    if command -v brew >/dev/null 2>&1; then installer='brew install node'; fi
    ;;
  Linux)
    case "$(uname -m)" in
      aarch64 | arm64) manual='the Linux ARM64 binaries' ;;
      *) manual='the Linux x64 binaries' ;;
    esac
    if command -v apt >/dev/null 2>&1; then
      installer='sudo apt install nodejs npm'
    elif command -v dnf >/dev/null 2>&1; then
      installer='sudo dnf install nodejs'
    elif command -v pacman >/dev/null 2>&1; then
      installer='sudo pacman -S nodejs npm'
    fi
    ;;
  *) manual='the build for this system' ;;
esac

advise() {
  echo "Download Node.js from https://nodejs.org/en/download and take $manual."
  echo "Then run this again."
}

if ! node_is_new_enough; then
  if command -v node >/dev/null 2>&1; then
    echo "Lamplit needs Node.js 20.19 or newer. This machine has $(node -v), which is too old."
  else
    echo "Lamplit needs Node.js 20.19 or newer, and it is not installed."
  fi

  # -- offer the fix, and install nothing without a yes -----------------------

  answered=''
  if [ -n "$installer" ] && [ -t 0 ]; then
    echo
    echo "This machine can install it with one command:"
    echo
    echo "    $installer"
    echo
    printf 'Run that now? [y/N] '
    read -r answer || answer=''
    case "$answer" in
      y | Y | yes | YES)
        answered=yes
        echo
        if ! sh -c "$installer"; then
          echo
          echo "That did not finish, so nothing was installed."
          advise
          exit 1
        fi
        ;;
    esac
  fi

  if [ "$answered" != yes ] || ! node_is_new_enough; then
    echo
    if [ "$answered" = yes ]; then
      echo "That installed Node.js $(node -v 2>/dev/null || echo 'nothing usable'), which is still not 20.19 or newer."
    fi
    advise
    exit 1
  fi
  echo
fi

# -- it is: start -------------------------------------------------------------

exec node server/src/index.js --open "$@"
`;
}

/**
 * Unix permissions inside the zip. Everything is read-only-ish except the two
 * scripts a Mac or a Linux box has to be allowed to run; a start.sh that
 * arrives without its x bit is a support question, not a download.
 */
function modeOf(entry) {
  return entry.endsWith('start.sh') || entry.endsWith('start.command') ? 0o755 : 0o644;
}

function readme() {
  return `Lamplit ${version}
=====================================

Running it
----------
  Windows      double-click start.bat
  macOS        double-click start.command
  Linux        ./start.sh   (start.command is the same script)

One call starts the server and opens http://127.0.0.1:${DEFAULT_PORT}/ in your browser.
Close the window (or press Ctrl+C) to stop it. Node.js 20.19+ is the only thing
that has to be installed already — everything else is in this folder. If it is
missing or too old, the script says so and offers the one command that installs
it on this machine. Nothing is installed unless you answer yes.

On a Mac, the first run of a file you downloaded can be refused ("cannot be
opened because it is from an unidentified developer"). Right-click start.command
and choose Open instead; that asks once, and never again.

Your stories
------------
They are written to the "data" folder next to this file, one JSON file per
document: settings.json, stories/<id>.json, chapters/<id>.json. Copy that folder
and you have copied everything. A zip of it is taken into "backups" once a day
when the app starts.

Move the whole folder wherever you like; the data goes with it.

Upgrading
---------
Unzip the new version beside this one and move this folder's "data" into it —
or leave it here and start the new one with --data pointing at it. Then the old
folder can be deleted whole; nothing is registered outside it. The app says
which build it is under the ... menu, in About Lamplit.

Options
-------
  start.bat --port 5000        listen somewhere else
  start.bat --data D:\\stories  keep the documents somewhere else
  LAMPLIT_OPEN=0                    do not open a browser
  LAMPLIT_BACKUP=0                  do not take the daily backup

Your API key
------------
The key you paste into Connection is stored in plain text in data/settings.json,
on this machine. That is deliberate for a single-user local tool. The server
listens on 127.0.0.1 only, so nothing on your network can reach it, unless you
turn on Preferences > Advanced > Share on this network, which opens a second
listener for a phone that has scanned the code it shows. Do not run
this on a machine you share.
`;
}

/** `shell` on Windows: npm is a .cmd there, and Node will not spawn one directly. */
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) fail(`${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed`);
}

function parseArguments(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--no-build') parsed.build = false;
    else if (argv[i] === '--no-zip') parsed.zip = false;
    else if (argv[i] === '--zip-only') parsed.zipOnly = true;
    else if (argv[i] === '--out') parsed.out = argv[++i];
    else if (argv[i] === '--stage') parsed.stage = argv[++i];
    else fail(`unknown option ${argv[i]}`);
  }
  if (parsed.zipOnly && !parsed.stage) fail('--zip-only needs --stage <dir> to zip');
  if (parsed.zipOnly && parsed.zip === false)
    fail('--zip-only and --no-zip ask for opposite things');
  return parsed;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function megabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function step(message) {
  console.log(`\n• ${message}`);
}

function fail(message) {
  console.error(`\npackage: ${message}`);
  process.exit(1);
}
