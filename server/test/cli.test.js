import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { builtApp, findBuiltApp, parseArguments, wantedPort } from '../src/cli.js';
import { DEFAULT_PORT } from '../src/ports.js';

/**
 * The command line, which nothing could ask a question of until it moved out
 * of `index.js`. Everything here was previously reachable only by starting the
 * whole process and watching what happened — which is why `--port abc` got as
 * far as a stack trace out of `net`, and a misspelt flag got nowhere at all
 * without saying so.
 */

describe('parseArguments', () => {
  it('reads the four things the start scripts and a person actually pass', () => {
    assert.deepEqual(parseArguments(['--open']), { open: true });
    assert.deepEqual(parseArguments([]), { open: false });
    assert.deepEqual(parseArguments(['--data', 'D:\\stories', '--port', '4177']), {
      open: false,
      data: 'D:\\stories',
      port: 4177,
    });
    // `--flag=value` too, because `parseArgs` takes it and people type it.
    assert.deepEqual(parseArguments(['--public=/srv/app']), { open: false, public: '/srv/app' });
  });

  it('turns the port into a number, so nothing downstream has to wonder', () => {
    assert.equal(parseArguments(['--port', '4177']).port, 4177);
    // Zero is the useful edge: the desktop shell and every test ask for
    // whatever is free, and that is what 0 means to a socket.
    assert.equal(parseArguments(['--port', '0']).port, 0);
  });

  it('refuses a port that is not one, in one line', () => {
    // What this used to do: `Number('abc')` is NaN, `listen(NaN)` is a stack
    // trace from inside node:net, and the reader is looking at a terminal.
    for (const said of ['abc', '', '4177.5', '70000', '0x10', ' 80 ']) {
      assert.throws(() => parseArguments(['--port', said]), {
        message: /whole number from 0 to 65535/,
      });
    }
    // A negative one is refused a step earlier, by `parseArgs`, which reads a
    // leading dash as the next flag and says the argument is ambiguous. Also a
    // refusal, and also a sentence.
    assert.throws(() => parseArguments(['--port', '-1']), { message: /ambiguous/ });
    assert.throws(() => parseArguments(['--port=-1']), {
      message: /whole number from 0 to 65535/,
    });
  });

  it('refuses a flag it does not know, rather than accepting and ignoring it', () => {
    // `--prot 4177` used to be read as `{prot: '4177'}`, silently, and the
    // server started on the default port with nobody any the wiser.
    assert.throws(() => parseArguments(['--prot', '4177']), { message: /Unknown option/ });
    assert.throws(() => parseArguments(['--open', '--dat', 'x']), { message: /Unknown option/ });
    // And says what it would have taken.
    assert.throws(() => parseArguments(['--nope']), {
      message: /--data, --public, --port, --open/,
    });
  });

  it('refuses a loose word, which is always a flag that lost its dashes', () => {
    assert.throws(() => parseArguments(['4177']), { message: /./ });
  });
});

describe('wantedPort', () => {
  it('takes the flag over the environment, because somebody just typed it', () => {
    assert.equal(wantedPort({ port: 5000 }, { LAMPLIT_PORT: '6000' }), 5000);
  });

  it('reads LAMPLIT_PORT, and PORT because a great many things set that one', () => {
    assert.equal(wantedPort({}, { LAMPLIT_PORT: '6000' }), 6000);
    assert.equal(wantedPort({}, { PORT: '7000' }), 7000);
    assert.equal(wantedPort({}, { LAMPLIT_PORT: '6000', PORT: '7000' }), 6000);
  });

  it('falls back to the one number a reader may end up typing', () => {
    assert.equal(wantedPort({}, {}), DEFAULT_PORT);
    // Set and empty is what a shell script that did not fill it in leaves.
    assert.equal(wantedPort({}, { LAMPLIT_PORT: '' }), DEFAULT_PORT);
  });

  it('refuses an environment that is as wrong as a flag can be', () => {
    assert.throws(() => wantedPort({}, { LAMPLIT_PORT: 'abc' }), {
      message: /LAMPLIT_PORT needs a whole number/,
    });
  });
});

describe('findBuiltApp', () => {
  it('is the one place the Angular output path is spelt', () => {
    // The acceptance criterion of the change this file came with: the server,
    // the shell, three tools and the e2e harness all ask here now.
    assert.equal(builtApp('/repo'), join('/repo', 'app', 'dist', 'app', 'browser'));
  });

  it('prefers the packaged layout, which is what an unzipped copy has', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lamplit-cli-'));
    await mkdir(join(root, 'public'), { recursive: true });
    await writeFile(join(root, 'public', 'index.html'), '<!doctype html>', 'utf8');
    assert.equal(findBuiltApp(root), join(root, 'public'));
  });

  it('names where the build will be when there is no build yet', async () => {
    // A checkout before `npm run build`. The path is handed back all the same,
    // because what the caller does with it is say so — see index.js's `app`
    // line, which prints `(not built; API only)`.
    const root = await mkdtemp(join(tmpdir(), 'lamplit-cli-'));
    assert.equal(findBuiltApp(root), builtApp(root));
  });

  it('ignores a public folder with no page in it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lamplit-cli-'));
    await mkdir(join(root, 'public'), { recursive: true });
    assert.equal(findBuiltApp(root), builtApp(root));
  });
});
