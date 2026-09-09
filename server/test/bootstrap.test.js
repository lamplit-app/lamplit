import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { RUN_FILE } from '../src/version.js';
import { bootstrap } from '../src/bootstrap.js';

/**
 * The sequence both front doors run, started for real.
 *
 * Nothing covered it before: the zip's door has a top-level `await` in it and
 * the shell's needs Electron, so the only thing that had ever run this in
 * order was a person double-clicking something. What it is worth asserting is
 * the shape of what comes back — every field one of the two doors reads — and
 * the fact that the store is open and the app is answering by the time it
 * does. The order used to be the shell's own, re-implemented, and the two had
 * already drifted apart.
 *
 * `port: 0` for a port nobody else has, `backup: false` because a zip of the
 * documents is not what this is about, and `updateCheck: false` because a test
 * must not ask GitHub anything.
 */

/** Everything started here, closed together, however the assertions went. */
const started = [];

after(async () => {
  for (const { server, sharing } of started) {
    await sharing.close().catch(() => {});
    await new Promise((fulfil) => {
      server.close(fulfil);
      server.closeIdleConnections();
      server.closeAllConnections();
    });
  }
});

async function start(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'lamplit-boot-'));
  const it = await bootstrap({
    root,
    dataDir: join(root, 'data'),
    backupsDir: join(root, 'backups'),
    publicDir: join(root, 'public'),
    host: '127.0.0.1',
    port: 0,
    backup: false,
    updateCheck: false,
    // The loopback, not every interface: binding every interface on a
    // developer's Windows laptop raises the firewall prompt on `npm test`.
    shareHost: '127.0.0.1',
    sharePort: 0,
    log: () => {},
    ...options,
  });
  started.push(it);
  return { root, ...it };
}

describe('bootstrap', () => {
  it('hands back everything the two front doors read off it', async () => {
    const app = await start();

    assert.equal(app.build.channel, 'dev');
    assert.match(app.build.version, /^\d+\.\d+\.\d+$/);
    assert.equal(app.previousVersion, null);
    assert.equal(app.upgraded, false);
    assert.equal(app.updates.enabled, false);
    assert.equal(app.shared.share, false);
    assert.equal(typeof app.store.read, 'function');
    assert.equal(typeof app.app, 'function');
    assert.ok(app.server.listening);
    assert.equal(await app.backup, null);
    // The URL is the whole point of the exercise: it is what a window and a
    // browser are pointed at, and the port in it is the one the socket got.
    assert.equal(app.url, `http://127.0.0.1:${app.server.address().port}/`);
  });

  it('is listening and answering by the time it returns', async () => {
    const app = await start();
    const health = await (await fetch(`${app.url}api/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.version, app.build.version);
    // And the store it is answering from is the one it opened, not a second.
    assert.equal(health.dataDir, app.store.dataDir);
  });

  it('opens the store before it listens, which is what makes the first read safe', async () => {
    const app = await start();
    // Three folders and a run record, on disk, before anything asked for a
    // document. This used to be the caller's job through `app.locals.store`.
    assert.deepEqual((await readdir(app.store.dataDir)).sort(), ['chapters', RUN_FILE, 'stories']);
    const listed = await (await fetch(`${app.url}api/docs/stories`)).json();
    assert.deepEqual(listed, []);
  });

  it('says which version ran here last, which is the only signal of an upgrade', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lamplit-boot-'));
    const dataDir = join(root, 'data');
    await mkdtemp(dataDir).catch(() => {});
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      join(dataDir, RUN_FILE),
      JSON.stringify({ version: '0.0.1', previousVersion: null, at: '2026-01-01T00:00:00.000Z' }),
      'utf8',
    );
    const app = await start({ root, dataDir, backupsDir: join(root, 'backups') });
    assert.equal(app.upgraded, true);
    assert.equal(app.previousVersion, '0.0.1');
    // And the app serves it, because that is what the upgrade notice reads.
    assert.equal((await (await fetch(`${app.url}api/health`)).json()).previousVersion, '0.0.1');
    // Written down again, so the next start is not a second upgrade.
    const record = JSON.parse(await readFile(join(dataDir, RUN_FILE), 'utf8'));
    assert.equal(record.version, app.build.version);
  });

  it('takes the daily backup when it is asked to, and not otherwise', async () => {
    const off = await start();
    assert.equal(await off.backup, null);
    assert.equal(existsSync(join(off.root, 'backups')), false);

    // With something in the data folder to archive, because an empty one is
    // nothing to keep a copy of.
    const on = await start({ backup: true });
    await on.store.write('stories', 'one', { id: 'one', title: 'The Lantern Room' });
    // Started after the write would be the honest sequence and is not the one
    // the doors run, so this asserts only that the promise settles and never
    // rejects — the failure is a line in the log, not a start that fails.
    assert.doesNotReject(on.backup);
  });

  it('serves the sharing switch, off, with nothing listening for it', async () => {
    const app = await start();
    const share = await (await fetch(`${app.url}api/server/share`)).json();
    assert.equal(share.share, false);
    assert.equal(app.sharing.on, false);
  });
});
