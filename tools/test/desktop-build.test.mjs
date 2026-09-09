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
