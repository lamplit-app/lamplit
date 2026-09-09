import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

/**
 * What ships, and where each piece of it sits.
 *
 * `tools/package.mjs` builds and zips; this says what the folder it builds is
 * made of. The split is the same one `tools/lib/desktop-build.mjs` made and for
 * the same reason: the script has its effects at the top of the file, so a
 * `node:test` cannot import it to ask what it would write. What it would write
 * is the part worth asking about — a file dropped from this list ships as a
 * folder that is missing something, and nothing before the reader's machine
 * says so.
 *
 * The two start scripts and the README are held here in full because they are
 * the whole of what a reader who has never seen the repository is handed.
 */

/**
 * The command line, read. Throws rather than exiting, so the script says it in
 * its own voice and a test can ask what a pair of contradictory flags does.
 *
 * Through `node:util`'s reader, like every other parser in the repository, so
 * that `--stage=<dir>`, a `--stage` with nothing after it, and `--` all mean
 * the same thing here as they do on the server's own command line. The loop
 * this replaced read `--stage` at the end of the line as `undefined` and
 * staged into `build/lamplit-<version>` without a word.
 */
export function parseArguments(argv) {
  let flags;
  try {
    ({ values: flags } = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        'no-build': { type: 'boolean', default: false },
        'no-zip': { type: 'boolean', default: false },
        'zip-only': { type: 'boolean', default: false },
        out: { type: 'string' },
        stage: { type: 'string' },
      },
    }));
  } catch (error) {
    throw new Error(String(error.message).split('. ')[0], { cause: error });
  }
  const parsed = {};
  if (flags['no-build']) parsed.build = false;
  if (flags['no-zip']) parsed.zip = false;
  if (flags['zip-only']) parsed.zipOnly = true;
  if (flags.out !== undefined) parsed.out = flags.out;
  if (flags.stage !== undefined) parsed.stage = flags.stage;
  if (parsed.zipOnly && !parsed.stage) throw new Error('--zip-only needs --stage <dir> to zip');
  if (parsed.zipOnly && parsed.zip === false) {
    throw new Error('--zip-only and --no-zip ask for opposite things');
  }
  return parsed;
}

/**
 * The package.json the stage runs from. `engines` and `dependencies` are the
 * server's own, not the root's: what the start scripts check for before they
 * start anything, and the packages that travel beside them. The root
 * package.json is stricter — building the app needs a version Angular will run
 * on — but nothing in here is built.
 */
export function stagedManifest({ version, description, server }) {
  return {
    name: 'lamplit',
    version,
    private: true,
    type: 'module',
    description,
    main: 'server/src/index.js',
    scripts: { start: 'node server/src/index.js --open' },
    engines: server.engines,
    dependencies: server.dependencies,
  };
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

export function readmeText({ version, port }) {
  return `Lamplit ${version}
=====================================

Running it
----------
  Windows      double-click start.bat
  macOS        double-click start.command
  Linux        ./start.sh   (start.command is the same script)

One call starts the server and opens http://127.0.0.1:${port}/ in your browser.
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

/**
 * Unix permissions inside the zip. Everything is read-only-ish except the two
 * scripts a Mac or a Linux box has to be allowed to run; a start.sh that
 * arrives without its x bit is a support question, not a download.
 */
export function modeOf(entry) {
  return entry.endsWith('start.sh') || entry.endsWith('start.command') ? 0o755 : 0o644;
}

/**
 * Every file the stage is *given* — as opposed to the trees copied into it,
 * which are listed by {@link stagedCopies}. Path, contents, and the mode where
 * it is not the default; relative to the top of the stage, with forward slashes
 * whatever the platform.
 *
 * One list rather than a run of `writeFile` calls so that "what ships" is
 * something a test can read back. The order matters in one place only:
 * `public/` has to have been copied before the stamp is written into it.
 */
export function stagedFiles({ version, description, server, stamp, stampFile, port }) {
  return [
    // Next to the built app: which commit, which CI run, and when. The server
    // reads it back and /api/health repeats it, so a bug report can name the
    // build it came from rather than a version two dozen builds have carried.
    { path: `public/${stampFile}`, text: `${JSON.stringify(stamp, null, 2)}\n` },
    {
      path: 'package.json',
      text: `${JSON.stringify(stagedManifest({ version, description, server }), null, 2)}\n`,
    },
    // CRLF: a .bat with Unix endings is read by cmd.exe as one long line.
    { path: 'start.bat', text: startBat().replaceAll('\n', '\r\n') },
    { path: 'start.sh', text: startSh(), mode: 0o755 },
    // The same script under the name Finder will run: a double-clicked .sh
    // opens in a text editor, a .command runs. See README.txt.
    { path: 'start.command', text: startSh(), mode: 0o755 },
    { path: 'README.txt', text: readmeText({ version, port }) },
  ];
}

/**
 * Every tree copied in whole, as `from` on this machine → where it goes in the
 * stage. Listed here for the same reason as the files above: the licences are
 * the one entry whose absence breaks a promise rather than the app.
 */
export function stagedCopies({ root, builtApp, licencesFile }) {
  return [
    { from: join(root, 'server', 'src'), to: 'server/src' },
    // The one file the server and the app both read: the header name, the
    // collections, the paths and the words of a refusal. `server/src` imports
    // it as `../../wire/contract.mjs`, so it has to sit beside `server/` in
    // the stage exactly as it sits beside it in the repository — the app's own
    // copy is already inside the bundle below.
    { from: join(root, 'wire'), to: 'wire' },
    { from: builtApp, to: 'public' },
    // The licences of everything bundled into that JavaScript. Angular writes
    // them beside the build rather than inside it, so they have to be asked for
    // — and Apache-2.0 and BSD-3, which several of them are, require the notice
    // to travel with what it covers. NOTICE says this file is here.
    { from: join(dirname(builtApp), licencesFile), to: licencesFile },
  ];
}
