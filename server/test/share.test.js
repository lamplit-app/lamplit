import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { SERVER_ERROR } from '../../wire/contract.mjs';
import { createApp } from '../src/app.js';
import { PORT_ATTEMPTS } from '../src/ports.js';
import { SHARE_FILE, createSharing, localAddresses, newToken } from '../src/share.js';
import { DocumentStore } from '../src/store.js';

/**
 * Sharing, from both sides of the lock.
 *
 * Everything here runs against the real Express app behind the real pairing
 * middleware, because the middleware's whole job is what does and does not
 * reach that app. The shared listener is bound to the loopback rather than to
 * every interface: it is the same listener either way, and binding every
 * interface would raise the Windows firewall prompt on `npm test`.
 */
async function serve({ share = false, token = '' } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'lamplit-share-'));
  return await open(dataDir, { share, token });
}

/** Starts the loopback listener, the sharing object, and the app behind both. */
async function open(dataDir, { share = false, token = '' } = {}) {
  const sharing = createSharing({ dataDir, port: 0, host: '127.0.0.1' });
  const store = new DocumentStore(dataDir);
  const app = createApp({ dataDir, sharing, store });
  sharing.serve(app);
  await store.init();
  if (share || token) {
    await sharing.set(false);
    // `set` has written the file; putting the wanted state in it and reading
    // it back is what a restart is, and is how a test gets a known token.
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      join(dataDir, SHARE_FILE),
      `${JSON.stringify({ share, token: token || newToken() }, null, 2)}\n`,
      'utf8',
    );
  }
  const started = await sharing.init();

  const own = await new Promise((fulfil) => {
    const instance = app.listen(0, '127.0.0.1', () => fulfil(instance));
  });
  const base = `http://127.0.0.1:${own.address().port}`;

  return {
    dataDir,
    sharing,
    started,
    base,
    /** The computer's own listener, which is the one that never moves. */
    call: (path, init) => fetch(`${base}${path}`, init),
    /** The shared one, as a phone reaches it. */
    shared: (path, init) => fetch(`http://127.0.0.1:${sharing.port}${path}`, init),
    saved: async () => JSON.parse(await readFile(join(dataDir, SHARE_FILE), 'utf8')),
    close: async () => {
      await sharing.close();
      await new Promise((fulfil) => {
        own.close(fulfil);
        // `fetch` keeps its connections alive, and a server holding one never
        // finishes closing. The suite would otherwise wait out undici's idle
        // timeout once per test.
        own.closeIdleConnections();
        own.closeAllConnections();
      });
    },
  };
}

/** The secret, from the only place a test is allowed to know it. */
async function tokenOf(api) {
  return (await api.saved()).token;
}

/** Follows nothing and keeps the cookie, which is what pairing is made of. */
function cookieFrom(response) {
  const header = response.headers.get('set-cookie') ?? '';
  return header.split(';')[0];
}

describe('sharing, off', () => {
  it('starts off, listening on nothing but the machine itself', async () => {
    const api = await serve();
    assert.equal(api.sharing.on, false);
    assert.deepEqual(await (await api.call('/api/server/share')).json(), {
      share: false,
      port: 0,
      addresses: [],
    });
    await api.close();
  });

  it('has no shared listener to answer with', async () => {
    const api = await serve();
    assert.equal(api.sharing.port, 0);
    await api.close();
  });

  it('refuses the QR code, because there is nothing to pair with', async () => {
    const api = await serve();
    assert.equal((await api.call('/api/server/share/qr')).status, 409);
    await api.close();
  });
});

describe('sharing, on', () => {
  it('opens a second listener and writes the choice down', async () => {
    const api = await serve();
    const status = await (await api.call('/api/server/share', put({ share: true }))).json();
    assert.equal(status.share, true);
    assert.ok(status.port > 0);
    assert.deepEqual(status.addresses, localAddresses());
    assert.equal((await api.saved()).share, true);
    await api.close();
  });

  it('closes it again, and the machine’s own listener never notices', async () => {
    const api = await serve();
    await api.call('/api/server/share', put({ share: true }));
    const port = api.sharing.port;

    await api.call('/api/server/share', put({ share: false }));
    assert.equal(api.sharing.on, false);
    assert.equal((await api.saved()).share, false);
    // The one that was there all along is still answering.
    assert.equal((await api.call('/api/health')).status, 200);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`));
    await api.close();
  });

  it('comes back shared after a restart, with the same code', async () => {
    const api = await serve();
    await api.call('/api/server/share', put({ share: true }));
    const token = await tokenOf(api);
    await api.close();

    // The same folder, a new process: what the next start is.
    const again = await open(api.dataDir);
    assert.equal(again.started.share, true);
    assert.equal(again.sharing.on, true);
    // The same code, so a phone that scanned yesterday is still paired.
    assert.equal(await tokenOf(again), token);
    await again.close();
  });
});

describe('pairing', () => {
  it('turns away a phone that has not scanned the code', async () => {
    const api = await serve({ share: true });
    const response = await api.shared('/');
    assert.equal(response.status, 401);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await response.text(), /Scan the code on the computer/);
    await api.close();
  });

  it('turns away a phone asking the API, not only one asking for the page', async () => {
    const api = await serve({ share: true });
    // This is the request the lock exists for: the settings document has the
    // API key in it in plain text.
    const response = await api.shared('/api/docs/settings/settings');
    assert.equal(response.status, 401);
    await api.close();
  });

  it('pairs a phone that opened the URL in the code, and then lets it in', async () => {
    const api = await serve({ share: true });
    const scanned = await api.shared(`/pair/${await tokenOf(api)}`, { redirect: 'manual' });
    assert.equal(scanned.status, 302);
    assert.equal(scanned.headers.get('location'), '/');
    const cookie = cookieFrom(scanned);
    assert.match(cookie, /^lamplit_pair=[0-9a-f]{32}$/);
    // HttpOnly so a script on the page cannot read the secret back out.
    assert.match(scanned.headers.get('set-cookie') ?? '', /HttpOnly/);
    assert.match(scanned.headers.get('set-cookie') ?? '', /SameSite=Lax/);
    // And nothing between here and the phone may keep a copy of the URL.
    assert.equal(scanned.headers.get('cache-control'), 'no-store');

    const paired = await api.shared('/api/health', { headers: { cookie } });
    assert.equal(paired.status, 200);
    assert.equal((await paired.json()).name, 'lamplit');
    await api.close();
  });

  it('turns away a phone that scanned something else', async () => {
    const api = await serve({ share: true });
    const wrong = await api.shared(`/pair/${newToken()}`, { redirect: 'manual' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.get('set-cookie'), null);
    await api.close();
  });

  it('turns away a phone holding a cookie from a code that has been changed', async () => {
    const api = await serve({ share: true });
    const cookie = cookieFrom(
      await api.shared(`/pair/${await tokenOf(api)}`, { redirect: 'manual' }),
    );
    assert.equal((await api.shared('/api/health', { headers: { cookie } })).status, 200);

    await api.call('/api/server/share', put({ rotate: true }));
    // No list of devices anywhere; the phone is simply holding the old secret.
    assert.equal((await api.shared('/api/health', { headers: { cookie } })).status, 401);
    // And it is still shared, so scanning the new code is the way back in.
    assert.equal(api.sharing.on, true);
    const again = cookieFrom(
      await api.shared(`/pair/${await tokenOf(api)}`, { redirect: 'manual' }),
    );
    assert.notEqual(again, cookie);
    assert.equal((await api.shared('/api/health', { headers: { cookie: again } })).status, 200);
    await api.close();
  });

  it('lets the machine’s own listener through without any of this', async () => {
    const api = await serve({ share: true });
    assert.equal((await api.call('/api/health')).status, 200);
    assert.equal((await api.call('/api/docs/stories')).status, 200);
    await api.close();
  });
});

describe('what a paired phone still may not do', () => {
  async function paired() {
    const api = await serve({ share: true });
    const cookie = cookieFrom(
      await api.shared(`/pair/${await tokenOf(api)}`, { redirect: 'manual' }),
    );
    return { api, cookie };
  }

  it('cannot read the sharing setting', async () => {
    const { api, cookie } = await paired();
    const response = await api.shared('/api/server/share', { headers: { cookie } });
    assert.equal(response.status, 403);
    await api.close();
  });

  it('cannot turn sharing off and lock the computer out of its own switch', async () => {
    const { api, cookie } = await paired();
    const response = await api.shared('/api/server/share', {
      ...put({ share: false }),
      headers: { 'content-type': 'application/json', cookie },
    });
    assert.equal(response.status, 403);
    assert.equal(api.sharing.on, true);
    await api.close();
  });

  it('cannot ask for the QR code and pass the lock on to another phone', async () => {
    const { api, cookie } = await paired();
    assert.equal((await api.shared('/api/server/share/qr', { headers: { cookie } })).status, 403);
    await api.close();
  });

  it('is not told where on the computer the writing is kept', async () => {
    const { api, cookie } = await paired();
    const shared = await (await api.shared('/api/health', { headers: { cookie } })).json();
    assert.equal(shared.dataDir, undefined);
    // The computer's own tab is, which is what developer mode shows.
    assert.equal((await (await api.call('/api/health')).json()).dataDir, api.dataDir);
    await api.close();
  });
});

describe('the QR code', () => {
  it('is an SVG of the pairing URL, and is never cached', async () => {
    const api = await serve({ share: true });
    const address = localAddresses()[0];
    if (!address) return; // a machine with no network at all has nothing to draw
    const response = await api.call(`/api/server/share/qr?address=${address}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /image\/svg\+xml/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const svg = await response.text();
    assert.match(svg, /^<svg[\s\S]*<\/svg>\s*$/);
    await api.close();
  });

  it('draws only an address this machine actually has', async () => {
    const api = await serve({ share: true });
    if (!localAddresses().length) return;
    // Whatever the query string asks for, the URL in the picture is one of
    // ours: the token is being drawn into it.
    const response = await api.call('/api/server/share/qr?address=10.9.9.9');
    assert.equal(response.status, 200);
    assert.ok(localAddresses().some((own) => api.sharing.pairUrl(own).includes(own)));
    await api.close();
  });

  it('puts the token in the URL and the token nowhere else', async () => {
    const api = await serve({ share: true });
    const token = await tokenOf(api);
    assert.ok(api.sharing.pairUrl('192.168.1.5').endsWith(`/pair/${token}`));
    // The app is never told it: the status the dialog reads has no token in it.
    const status = await (await api.call('/api/server/share')).json();
    assert.deepEqual(Object.keys(status).sort(), ['addresses', 'port', 'share']);
    await api.close();
  });
});

describe('addresses', () => {
  it('offers what a phone could reach, and never the loopback', async () => {
    for (const address of localAddresses()) {
      assert.ok(!address.startsWith('127.'), address);
      assert.match(address, /^\d{1,3}(\.\d{1,3}){3}$/);
    }
  });
});

/** A PUT of one small JSON object, which is all this API takes. */
function put(body) {
  return {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * The switch pressed when there is nowhere for the listener to go.
 *
 * The walk tries `PORT_ATTEMPTS` ports past the one it wanted and then gives
 * up with an `EADDRINUSE`, and that used to escape the route as a raw 500
 * carrying `listen EADDRINUSE 0.0.0.0:4177` — so the reader who pressed the
 * switch was told "500 Internal Server Error" and a paired phone was told a
 * port number. The identical failure at start-up has always been a sentence
 * (`init` returns one), and that is the whole of the inconsistency.
 */
describe('sharing, with no free port to open on', () => {
  const close = (servers) =>
    Promise.all(servers.map((server) => new Promise((fulfil) => server.close(fulfil))));

  /**
   * A run of `PORT_ATTEMPTS + 1` ports, every one of them held by this test.
   *
   * Held by *this* test and not merely observed to be busy: the rest of the
   * suite is opening and closing listeners the whole time, so a port that
   * refused a bind a moment ago may be free by the time the walk reaches it —
   * which is what this test saw, passing alone and failing in the run. The base
   * comes from a port the operating system has just said is free; if the run
   * above it is not free too, the whole range is dropped and another is tried.
   */
  async function occupyARange() {
    for (let attempt = 0; attempt < 20; attempt++) {
      const first = createServer();
      await new Promise((fulfil) => first.listen(0, '127.0.0.1', fulfil));
      const from = first.address().port;
      const held = [first];
      let whole = true;
      for (let port = from + 1; whole && port <= from + PORT_ATTEMPTS; port++) {
        const server = createServer();
        whole = await new Promise((fulfil) => {
          server.once('listening', () => fulfil(true));
          server.once('error', () => fulfil(false));
          server.listen(port, '127.0.0.1');
        });
        if (whole) held.push(server);
      }
      if (whole) return { from, release: () => close(held) };
      await close(held);
    }
    throw new Error(`no run of ${PORT_ATTEMPTS + 1} free ports to take`);
  }

  it('answers a sentence and a 503, and says nothing about ports', async () => {
    const range = await occupyARange();
    const dataDir = await mkdtemp(join(tmpdir(), 'lamplit-busy-'));
    // The walk warns once per busy port on its way up, and the refusal is
    // logged: both are wanted in a real run and neither is wanted in this one,
    // so the log is handed in and read rather than patched onto the console.
    const said = [];
    const log = (message) => said.push(message);
    const sharing = createSharing({ dataDir, port: range.from, host: '127.0.0.1', log });
    const store = new DocumentStore(dataDir);
    const app = createApp({ dataDir, sharing, log, store });
    sharing.serve(app);
    await store.init();
    const own = await new Promise((fulfil) => {
      const instance = app.listen(0, '127.0.0.1', () => fulfil(instance));
    });
    const base = `http://127.0.0.1:${own.address().port}`;

    try {
      const refused = await fetch(`${base}/api/server/share`, put({ share: true }));

      assert.equal(refused.status, 503);
      const body = await refused.json();
      assert.equal(body.ok, false);
      assert.match(body.error, /no free port to share on/);
      // A sentence, not the operating system's: the error middleware only
      // hides a 5xx's message, and this one is meant to be read.
      assert.notEqual(body.error, SERVER_ERROR);
      assert.ok(!/EADDRINUSE|\d{4}/.test(body.error), body.error);
      // And the switch is off rather than half on.
      assert.equal(sharing.on, false);
      assert.equal((await (await fetch(`${base}/api/server/share`)).json()).share, false);
      // The reason is in the log as well, where somebody can act on it —
      // among the lines the port walk left on its way up.
      assert.equal(said.filter((line) => /server error/.test(line)).length, 1);
    } finally {
      await sharing.close();
      await new Promise((fulfil) => {
        own.close(fulfil);
        own.closeIdleConnections();
        own.closeAllConnections();
      });
      await range.release();
    }
  });
});
