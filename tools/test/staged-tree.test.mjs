import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  modeOf,
  parseArguments,
  readmeText,
  stagedCopies,
  stagedFiles,
  stagedManifest,
} from '../lib/staged-tree.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SERVER = {
  engines: { node: '>=20.19' },
  dependencies: { express: '^5.2.1', qrcode: '^1.5.4' },
};

function staged(patch = {}) {
  const files = stagedFiles({
    version: '9.9.9',
    description: 'A description.',
    server: SERVER,
    stamp: { version: '9.9.9', commit: 'a1b2c3d', build: 'local' },
    stampFile: 'version.json',
    port: 4471,
    ...patch,
  });
  return new Map(files.map((file) => [file.path, file]));
}

describe('reading the command line', () => {
  it('takes the flags the release workflow and the desktop build pass', () => {
    assert.deepEqual(parseArguments([]), {});
    assert.deepEqual(parseArguments(['--no-build', '--no-zip', '--stage', '/tmp/x']), {
      build: false,
      zip: false,
      stage: '/tmp/x',
    });
    assert.deepEqual(parseArguments(['--zip-only', '--stage', '/tmp/x', '--out', '/tmp/o']), {
      zipOnly: true,
      stage: '/tmp/x',
      out: '/tmp/o',
    });
  });

  it('refuses to zip a folder it was not told the name of', () => {
    // Silently zipping build/lamplit-<version> instead would publish whatever
    // was staged there last, which is not what the installers were built from.
    assert.throws(() => parseArguments(['--zip-only']), /--stage/);
  });

  it('refuses a pair of flags that ask for opposite things', () => {
    assert.throws(
      () => parseArguments(['--zip-only', '--stage', '/tmp/x', '--no-zip']),
      /opposite/,
    );
  });

  it('says which option it did not recognise', () => {
    assert.throws(() => parseArguments(['--zipp']), /unknown option --zipp/);
  });
});

describe('the package.json the stage runs from', () => {
  it('takes engines and dependencies from the server, not the root', () => {
    const manifest = stagedManifest({
      version: '9.9.9',
      description: 'A description.',
      server: SERVER,
    });
    assert.deepEqual(manifest.engines, SERVER.engines);
    assert.deepEqual(manifest.dependencies, SERVER.dependencies);
    assert.equal(manifest.main, 'server/src/index.js');
    assert.equal(manifest.scripts.start, 'node server/src/index.js --open');
    assert.equal(manifest.version, '9.9.9');

    // The root's own engines are stricter — Angular has to run on it — and
    // nothing in the staged folder is built, so shipping them would refuse a
    // machine that can run everything it was sent.
    const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.notDeepEqual(root.engines, SERVER.engines);
  });

  it('names only what the server actually needs', () => {
    // The dev dependencies of a repository with Angular, Playwright and
    // Electron in it are what `productionClosure` exists to keep out; the
    // manifest beside it must not ask for them either.
    const manifest = stagedManifest({ version: '1', description: '', server: SERVER });
    assert.equal(manifest.devDependencies, undefined);
    assert.equal(manifest.workspaces, undefined);
    assert.equal(manifest.private, true);
    assert.equal(manifest.type, 'module');
  });

  it('is what the real server package.json says, as it is written today', () => {
    const server = JSON.parse(readFileSync(join(ROOT, 'server', 'package.json'), 'utf8'));
    const files = staged({ server });
    const written = JSON.parse(files.get('package.json').text);
    assert.deepEqual(written.dependencies, server.dependencies);
    assert.deepEqual(written.engines, server.engines);
  });
});

describe('the files the stage is given', () => {
  it('is the whole list, and every path is relative with forward slashes', () => {
    assert.deepEqual(
      [...staged().keys()],
      [
        'public/version.json',
        'package.json',
        'start.bat',
        'start.sh',
        'start.command',
        'README.txt',
      ],
    );
    for (const path of staged().keys()) {
      assert.doesNotMatch(path, /\\|^\/|^\.\./, path);
    }
  });

  it('writes the stamp where the server looks for it', () => {
    // server/src/version.js reads it back out of the built app's own folder,
    // and /api/health repeats it; the About sheet says "unknown" without it.
    const stamp = staged().get('public/version.json');
    assert.deepEqual(JSON.parse(stamp.text), {
      version: '9.9.9',
      commit: 'a1b2c3d',
      build: 'local',
    });
    assert.ok(stamp.text.endsWith('\n'));
    assert.equal(staged({ stampFile: 'stamp.json' }).has('public/stamp.json'), true);
  });

  it('ships start.command as start.sh under another name, byte for byte', () => {
    const files = staged();
    assert.equal(files.get('start.command').text, files.get('start.sh').text);
    // Finder runs a .command and opens a .sh in a text editor; the docs say
    // both names, so the two must not drift.
    assert.match(files.get('start.sh').text, /^#!\/bin\/sh\n/);
  });

  it('writes the batch file with the endings cmd.exe reads', () => {
    // A .bat with Unix endings is one long line to cmd.exe, and the repository
    // is checked out with whatever the platform gives.
    const bat = staged().get('start.bat').text;
    assert.match(bat, /^@echo off\r\n/);
    assert.equal(/[^\r]\n/.test(bat), false, 'every newline is CRLF');
    // The two shell scripts are not: the machines that run them want LF.
    for (const path of ['start.sh', 'start.command']) {
      assert.equal(staged().get(path).text.includes('\r'), false, path);
    }
  });

  it('marks the two scripts executable, and nothing else', () => {
    const executable = [...staged().values()]
      .filter((file) => file.mode === 0o755)
      .map((file) => file.path);
    assert.deepEqual(executable, ['start.sh', 'start.command']);
  });

  it('marks in the zip exactly what it wrote executable on disk', () => {
    // Two rules about the same two files, in two places: a start.sh that
    // arrives without its x bit is a support question, not a download.
    for (const file of staged().values()) {
      assert.equal(modeOf(file.path), file.mode ?? 0o644, file.path);
    }
    assert.equal(modeOf('lamplit-9.9.9/start.command'), 0o755, 'named as the zip names it');
    assert.equal(modeOf('lamplit-9.9.9/public/index.html'), 0o644);
  });

  it('checks for the Node the manifest asks for, in both start scripts', () => {
    const files = staged();
    const asked = stagedManifest({ version: '1', description: '', server: SERVER }).engines.node;
    const [, wanted] = /([\d.]+)/.exec(asked);
    for (const path of ['start.bat', 'start.sh']) {
      assert.ok(
        files.get(path).text.includes(wanted),
        `${path} does not mention Node ${wanted}, which is the version it lets the app start on`,
      );
    }
  });

  it('offers a fix rather than a link that will go stale', () => {
    const sh = staged().get('start.sh').text;
    assert.match(sh, /brew install node/);
    assert.match(sh, /sudo apt install nodejs npm/);
    // The download page, not a file: every direct link on that site carries a
    // version number and would be wrong within weeks.
    assert.match(sh, /https:\/\/nodejs\.org\/en\/download/);
    assert.doesNotMatch(sh, /nodejs\.org\/dist/);
    assert.match(staged().get('start.bat').text, /winget install OpenJS\.NodeJS\.LTS/);
  });

  it('installs nothing without an answer', () => {
    // The one thing in the folder that can change the reader's machine.
    assert.match(staged().get('start.sh').text, /Run that now\? \[y\/N\]/);
    assert.match(staged().get('start.bat').text, /Run that now\? \[y\/N\]/);
  });
});

describe('the README beside them', () => {
  it('says the version, the port and where the stories are kept', () => {
    const text = readmeText({ version: '9.9.9', port: 4471 });
    assert.match(text, /^Lamplit 9\.9\.9\n/);
    assert.match(text, /http:\/\/127\.0\.0\.1:4471\//);
    assert.match(text, /"data" folder next to this file/);
  });

  it('names each of the three ways to start it', () => {
    const text = readmeText({ version: '1', port: 1 });
    for (const script of ['start.bat', 'start.command', 'start.sh']) {
      assert.ok(text.includes(script), script);
    }
  });

  it('is honest about the key on disk', () => {
    // The one thing a reader could not guess and would mind: it is why the
    // paragraph is there, and why nothing may quietly drop it.
    assert.match(readmeText({ version: '1', port: 1 }), /stored in plain text/);
  });
});

describe('what is copied in whole', () => {
  it('is the server, the wire, the built app, and the licences of what is in it', () => {
    const copies = stagedCopies({
      root: '/repo',
      builtApp: join('/repo', 'app', 'dist', 'app', 'browser'),
      licencesFile: '3rdpartylicenses.txt',
    });
    assert.deepEqual(
      copies.map((copy) => copy.to),
      ['server/src', 'wire', 'public', '3rdpartylicenses.txt'],
    );
    // `server/src/app.js` imports `../../wire/contract.mjs`, so the wire has
    // to land beside the server and not inside it. A stage without it is a
    // server that cannot start, which no other check here would catch.
    assert.equal(copies[1].from, join('/repo', 'wire'));
    // Angular writes the licences beside the build rather than inside it, and
    // Apache-2.0 and BSD-3 require the notice to travel with what it covers.
    assert.equal(
      copies.at(-1).from,
      join('/repo', 'app', 'dist', 'app', '3rdpartylicenses.txt'),
      'the licences come from beside the browser folder, not inside it',
    );
  });

  it('copies from where this repository’s build actually puts things', () => {
    const builtApp = join(ROOT, 'app', 'dist', 'app', 'browser');
    const copies = stagedCopies({ root: ROOT, builtApp, licencesFile: '3rdpartylicenses.txt' });
    assert.equal(copies[0].from, join(ROOT, 'server', 'src'));
    assert.equal(copies[1].from, join(ROOT, 'wire'));
    assert.equal(copies[2].from, builtApp);
  });

  it('leaves nothing to be copied over something already written', () => {
    // package.mjs writes the generated files after these copies, so no copy
    // may land on a path the file list also claims.
    const copies = stagedCopies({ root: '/repo', builtApp: '/repo/b', licencesFile: 'l.txt' });
    for (const { to } of copies) {
      for (const path of staged().keys()) {
        assert.notEqual(path, to);
      }
    }
  });
});
