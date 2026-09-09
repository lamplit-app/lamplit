import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { builderArgs, parseArguments } from '../lib/desktop-build.mjs';
import { rootVersion } from '../lib/script.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('the desktop build’s arguments', () => {
  it('stamps the version the repository is at, not the shell’s own', () => {
    const args = builderArgs({ version: '9.9.9', publish: false });
    assert.ok(args.includes('--config.extraMetadata.version=9.9.9'));

    // The shell's package.json is not what `npm version` writes, so a build
    // that trusted it would carry the same version out of every release.
    const shell = JSON.parse(readFileSync(join(ROOT, 'electron', 'package.json'), 'utf8'));
    assert.equal(
      typeof shell.version,
      'string',
      'the shell still needs a version; it is just not the one that ships',
    );
  });

  it('publishes only when it was asked to', () => {
    assert.deepEqual(builderArgs({ version: '1.0.0', publish: true }).slice(-2), [
      '--publish',
      'always',
    ]);
    // Said out loud rather than left out: off a tag, CI makes electron-builder
    // publish "on tag or draft" by default, and a draft is exactly what a
    // release waiting to be looked at is.
    assert.deepEqual(builderArgs({ version: '1.0.0', publish: false }).slice(-2), [
      '--publish',
      'never',
    ]);
  });

  it('reads the version from the root package.json', () => {
    const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.equal(rootVersion(ROOT), root.version);
  });
});

describe('the desktop build’s command line', () => {
  it('is a window by default, which is what `npm run desktop` means', () => {
    assert.deepEqual(parseArguments([]), { mode: 'run', publish: false });
  });

  it('reads the two other modes, and the flag that uploads', () => {
    assert.deepEqual(parseArguments(['--stage-only']), { mode: 'stage', publish: false });
    assert.deepEqual(parseArguments(['--dist']), { mode: 'dist', publish: false });
    assert.deepEqual(parseArguments(['--dist', '--publish']), { mode: 'dist', publish: true });
  });

  it('refuses to publish something it is not building installers for', () => {
    // Uploading nothing to a draft release, with an exit code of zero, is the
    // failure this refusal exists to make loud.
    assert.throws(() => parseArguments(['--publish']), /only means something with --dist/);
    assert.throws(() => parseArguments(['--stage-only', '--publish']), /--dist/);
  });

  it('refuses a pair of modes that ask for opposite things', () => {
    assert.throws(() => parseArguments(['--dist', '--stage-only']), /opposite/);
  });

  it('says what it would have taken, rather than accepting a misspelling', () => {
    assert.throws(() => parseArguments(['--dst']), /Unknown option/);
    assert.throws(() => parseArguments(['--dst']), /--dist, --stage-only or --publish/);
  });
});

/**
 * The `from → to` pairs under `extraResources`, in the order they are listed.
 * Two lines each, which is how the file is written and how electron-builder
 * reads it; a YAML parser for six paths would be a dependency for nothing.
 */
function extraResources(yml) {
  const lines = yml.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i < lines.length; i++) {
    const from = /^\s*-\s*from:\s*(\S+)\s*$/.exec(lines[i]);
    const to = from && /^\s*to:\s*(\S+)\s*$/.exec(lines[i + 1] ?? '');
    if (from && to) pairs.push([from[1], to[1]]);
  }
  return pairs;
}

/**
 * The patterns under `files:`, which is what goes into `app.asar`.
 *
 * The same shape of reader as the pairs below, and for the same reason: one
 * short block of a YAML file is a regular expression, not a dependency.
 */
function packagedFiles(yml) {
  const lines = yml.split(/\r?\n/);
  const start = lines.findIndex((line) => /^files:\s*$/.test(line));
  assert.notEqual(start, -1, 'electron-builder.yml has no files: block');
  const patterns = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break;
    const entry = /^\s*-\s*'?([^'\s]+)'?\s*$/.exec(lines[i]);
    if (entry) patterns.push(entry[1]);
  }
  return patterns;
}

/** Every `./x.mjs` the shell reaches from `main.mjs`, following them onwards. */
function shellModules() {
  const seen = new Set();
  const queue = ['main.mjs'];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(join(ROOT, 'electron', file), 'utf8');
    for (const [, imported] of source.matchAll(/from '\.\/([^']+)'/g)) {
      queue.push(imported);
    }
  }
  return [...seen].sort();
}

/** One `files:` pattern against one path; `*` stops at a separator. */
function matches(pattern, file) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`).test(file);
}

/**
 * The shell has to be in the asar in whole, and the list that says so has to
 * follow the code.
 *
 * It did not. `main.mjs` was one file when `files:` was written out by hand and
 * is eight after the split; the seven new ones were named nowhere, so 0.2.0's
 * installers built, uploaded, installed, and then died on the first import of
 * the run — `Cannot find module …app.asar\chromium.mjs`. Nothing else in this
 * repository would have noticed: `npm run desktop` and the desktop spec both
 * launch `electron/` as a folder on disk, where all eight are present, and the
 * zip ships no shell at all.
 */
describe('what the shell ships as', () => {
  const patterns = packagedFiles(
    readFileSync(join(ROOT, 'electron', 'electron-builder.yml'), 'utf8'),
  );

  it('packages every module main.mjs reaches, however many there come to be', () => {
    const missing = shellModules().filter(
      (file) => !patterns.some((pattern) => matches(pattern, file)),
    );
    assert.deepEqual(missing, [], `not in app.asar: ${missing.join(', ')}`);
  });

  it('reaches the whole shell, so the check above has something to check', () => {
    // If a refactor ever makes main.mjs import nothing, this test is the one
    // that says so rather than the one above quietly passing on an empty list.
    const modules = shellModules();
    assert.ok(modules.length >= 8, `main.mjs reaches only ${modules.length} module(s)`);
    assert.ok(modules.includes('chromium.mjs'), 'chromium.mjs is the one 0.2.0 died on');
  });

  it('still packages the preload, the splash and the manifest', () => {
    for (const file of ['preload.cjs', 'splash.html', 'package.json']) {
      assert.ok(
        patterns.some((pattern) => matches(pattern, file)),
        `${file} is not in the files list`,
      );
    }
  });

  it('reads the list it is given, and a name is not a glob', () => {
    assert.ok(matches('*.mjs', 'chromium.mjs'));
    assert.ok(matches('main.mjs', 'main.mjs'));
    assert.ok(!matches('*.mjs', 'preload.cjs'));
    assert.ok(!matches('main.mjs', 'chromium.mjs'));
    // `*` is one segment, which is why `icons/` needs no excluding.
    assert.ok(!matches('*.mjs', 'icons/deep.mjs'));
  });
});

/**
 * What the installers lay down beside the shell, and the one thing about it
 * that is a path rather than a file list.
 *
 * `electron/main.mjs` imports the server out of `resources/app/server/src`, and
 * `server/src` imports the wire as `../../wire/contract.mjs` — so the wire has
 * to land at `app/wire`, beside `app/server` and not inside it. Get that wrong
 * and every installer builds, ships, and fails on the first import of the run;
 * nothing else in this repository would notice, because the zip resolves the
 * same import through a differently-shaped folder.
 */
describe('what the desktop build lays down beside the shell', () => {
  const pairs = extraResources(
    readFileSync(join(ROOT, 'electron', 'electron-builder.yml'), 'utf8'),
  );

  it('puts the wire beside the server, where the server’s import expects it', () => {
    assert.deepEqual(
      pairs.find(([, to]) => to === 'app/wire'),
      ['../build/desktop-stage/wire', 'app/wire'],
    );
  });

  it('still puts the server, the built app and the dependencies where it did', () => {
    assert.deepEqual(pairs, [
      ['../build/desktop-stage/server', 'app/server'],
      ['../build/desktop-stage/wire', 'app/wire'],
      ['../build/desktop-stage/public', 'app/public'],
      ['../build/desktop-stage/node_modules', 'app/node_modules'],
      ['../build/desktop-stage/package.json', 'app/package.json'],
    ]);
  });
});
