import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from '../server/src/ports.js';
import { collectEntries, writeZip } from '../server/src/zip.js';
import { STAMP_FILE, buildStamp } from '../server/src/version.js';
import { productionClosure } from './lib/production-closure.mjs';
import { modeOf, parseArguments, stagedCopies, stagedFiles } from './lib/staged-tree.mjs';

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
 * What that folder is made of — the generated package.json, the two start
 * scripts, the README, the trees copied in whole — is in tools/lib/staged-tree.mjs,
 * where a node:test can read it back. This file builds, stages and zips.
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

const options = readOptions(process.argv.slice(2));
/** `npm version` writes this one and no other, and the description is here too. */
const rootManifest = readJson(join(ROOT, 'package.json'));
const version = rootManifest.version;
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
  for (const { from, to } of stagedCopies({
    root: ROOT,
    builtApp: BUILT_APP,
    licencesFile: LICENCES_FILE,
  })) {
    await cp(from, join(stageDir, ...to.split('/')), { recursive: true });
  }
  // The stamp is written into public/, so it goes after the copies above.
  const stamp = buildStamp({ version, root: ROOT });
  for (const { path, text, mode } of stagedFiles({
    version,
    description: rootManifest.description,
    server: readJson(join(ROOT, 'server', 'package.json')),
    stamp,
    stampFile: STAMP_FILE,
    port: DEFAULT_PORT,
  })) {
    const at = join(stageDir, ...path.split('/'));
    await writeFile(at, text, mode ? { encoding: 'utf8', mode } : 'utf8');
  }

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

/** A throw from the option reader is one line here, not a stack. */
function readOptions(argv) {
  try {
    return parseArguments(argv);
  } catch (error) {
    fail(error.message);
  }
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
