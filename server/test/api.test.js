import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { createUpdateChecker } from '../src/updates.js';

/**
 * Shuts a test server down and does not wait on the sockets to agree.
 *
 * Both `fetch` and `node:http`'s default agent keep their connections alive,
 * and `server.close` waits for every one of them — so a file that has finished
 * asserting sits there holding the event loop open until the idle timeout, and
 * `node --test` over a glob leaves the child process behind for good. That is
 * exactly what it did: two orphaned test runs, on two different days, both
 * stuck in this file. Dropping the sockets is what makes close mean closed.
 */
function stop(server) {
  return new Promise((fulfil) => {
    server.close(fulfil);
    server.closeIdleConnections();
    server.closeAllConnections();
  });
}

/** Starts the real app on a free port and hands back a `fetch` bound to it. */
async function serve({ withApp = false, updates, devCors = false } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'lamplit-api-'));
  let publicDir;
  if (withApp) {
    publicDir = join(dataDir, 'public');
    await mkdir(publicDir, { recursive: true });
    await writeFile(join(publicDir, 'index.html'), '<!doctype html><title>app</title>', 'utf8');
    await writeFile(join(publicDir, 'main.js'), 'console.log(1)', 'utf8');
  }
  const app = createApp({
    dataDir,
    publicDir,
    build: {
      version: '9.9.9',
      commit: 'abc1234',
      builtAt: '2026-09-04T00:00:00.000Z',
      build: '42',
      channel: 'zip',
    },
    previousVersion: '9.9.8',
    devCors,
    ...(updates ? { updates } : {}),
  });
  await app.locals.store.init();
  const server = await new Promise((fulfil) => {
    const instance = app.listen(0, '127.0.0.1', () => fulfil(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    dataDir,
    base,
    close: () => stop(server),
    call: (path, init) => fetch(`${base}${path}`, init),
    put: (path, body, rev) =>
      fetch(`${base}${path}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          ...(rev === undefined ? {} : { 'x-doc-rev': String(rev) }),
        },
        body: JSON.stringify(body),
      }),
  };
}

describe('GET /api/health', () => {
  it('says who it is, which is how the client tells a server from a static host', async () => {
    const api = await serve();
    const response = await api.call('/api/health');
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.name, 'lamplit');
    assert.equal(body.version, '9.9.9');
    assert.equal(body.ok, true);
    await api.close();
  });

  it('carries the build stamp, which is what makes a bug report answerable', async () => {
    const api = await serve();
    const body = await (await api.call('/api/health')).json();
    assert.equal(body.commit, 'abc1234');
    assert.equal(body.builtAt, '2026-09-04T00:00:00.000Z');
    assert.equal(body.build, '42');
    assert.equal(body.channel, 'zip');
    assert.equal(body.previousVersion, '9.9.8');
    await api.close();
  });

  it('tells the app where the writing is kept', async () => {
    const api = await serve();
    // No Origin is what a browser sends on a same-origin GET, and what curl
    // sends always. Naming this server is the same answer said out loud.
    assert.equal((await (await api.call('/api/health')).json()).dataDir, api.dataDir);
    const named = await api.call('/api/health', { headers: { origin: api.base } });
    assert.equal((await named.json()).dataDir, api.dataDir);
    await api.close();
  });

  it('does not tell another page on this machine, whose path it is not', async () => {
    const api = await serve({ devCors: true });
    // On Windows that path carries the account name. Everything else about the
    // build is still answered: which version, which commit, which channel.
    const body = await (
      await api.call('/api/health', { headers: { origin: 'http://localhost:4200' } })
    ).json();
    assert.equal(body.dataDir, undefined);
    assert.equal(body.version, '9.9.9');
    await api.close();
  });

  it('answers with defaults when nothing stamped the build', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'lamplit-api-'));
    const app = createApp({ dataDir });
    const server = await new Promise((fulfil) => {
      const instance = app.listen(0, '127.0.0.1', () => fulfil(instance));
    });
    const body = await (await fetch(`http://127.0.0.1:${server.address().port}/api/health`)).json();
    assert.equal(body.version, '0.0.0');
    assert.equal(body.channel, 'dev');
    assert.equal(body.previousVersion, null);
    await stop(server);
  });
});

describe('GET /api/updates', () => {
  /** GitHub, without GitHub: one release, and a count of who asked for it. */
  function fakeGithub() {
    const calls = [];
    return {
      calls,
      fetchImpl: async (url) => {
        calls.push(url);
        return Response.json([
          {
            tag_name: 'v9.9.10',
            name: 'Lamplit v9.9.10',
            published_at: '2026-10-01T00:00:00Z',
            body: 'A newer one.',
            html_url: 'https://example.invalid/v9.9.10',
            draft: false,
            prerelease: false,
            assets: [
              {
                name: 'Lamplit.zip',
                browser_download_url: 'https://example.invalid/Lamplit.zip',
                size: 10,
              },
            ],
          },
        ]);
      },
    };
  }

  it('hands the app what is newer than the build it is serving', async () => {
    const github = fakeGithub();
    const api = await serve({
      updates: createUpdateChecker({ version: '9.9.9', fetchImpl: github.fetchImpl }),
    });

    const body = await (await api.call('/api/updates')).json();

    assert.equal(body.ok, true);
    assert.equal(body.enabled, true);
    assert.equal(body.version, '9.9.9');
    assert.equal(body.newer.length, 1);
    assert.equal(body.newer[0].version, '9.9.10');
    assert.equal(body.newer[0].body, 'A newer one.');
    assert.equal(github.calls.length, 1);
    await api.close();
  });

  it('asks GitHub once, however many browser tabs are open', async () => {
    const github = fakeGithub();
    const api = await serve({
      updates: createUpdateChecker({ version: '9.9.9', fetchImpl: github.fetchImpl }),
    });

    await Promise.all([api.call('/api/updates'), api.call('/api/updates')]);
    await api.call('/api/updates');

    assert.equal(github.calls.length, 1);
    await api.close();
  });

  it('never asks GitHub when the check is switched off', async () => {
    const github = fakeGithub();
    const api = await serve({
      updates: createUpdateChecker({
        version: '9.9.9',
        enabled: false,
        fetchImpl: github.fetchImpl,
      }),
    });

    const body = await (await api.call('/api/updates')).json();

    assert.equal(github.calls.length, 0);
    assert.equal(body.enabled, false);
    assert.deepEqual(body.newer, []);
    await api.close();
  });

  it('is switched off by default, so a caller has to have meant it', async () => {
    const api = await serve();
    const body = await (await api.call('/api/updates')).json();
    assert.equal(body.enabled, false);
    await api.close();
  });
});

describe('/api/docs', () => {
  it('stores, lists, reads back and deletes a document', async () => {
    const api = await serve();
    const story = { id: 'abc', title: 'The Lighthouse', updatedAt: '2026-01-01T00:00:00.000Z' };

    const written = await api.put('/api/docs/stories/abc', story, '');
    const { ok, rev } = await written.json();
    assert.equal(ok, true);
    assert.match(rev, /^[0-9a-f]{16}$/);

    // Every copy of the document carries the revision the server stamped, so
    // whoever is holding one knows what a later write would be based on.
    const stamped = { ...story, rev };
    assert.deepEqual(await (await api.call('/api/docs/stories')).json(), [stamped]);
    assert.deepEqual(await (await api.call('/api/docs/stories/abc')).json(), stamped);
    assert.deepEqual(await (await api.call('/api/docs/stories?index')).json(), [
      { id: 'abc', updatedAt: '2026-01-01T00:00:00.000Z', rev },
    ]);

    const removed = await api.call('/api/docs/stories/abc', { method: 'DELETE' });
    assert.equal(removed.status, 200);
    assert.equal((await api.call('/api/docs/stories/abc')).status, 404);
    await api.close();
  });

  it('holds the three collections apart', async () => {
    const api = await serve();
    await api.put('/api/docs/settings/settings', { activeStoryId: 'abc' });
    await api.put('/api/docs/stories/abc', { id: 'abc' });
    await api.put('/api/docs/chapters/one', { id: 'one', storyId: 'abc' });
    assert.equal((await (await api.call('/api/docs/settings')).json()).length, 1);
    assert.equal((await (await api.call('/api/docs/stories')).json()).length, 1);
    assert.equal((await (await api.call('/api/docs/chapters')).json()).length, 1);
    await api.close();
  });

  it('answers 409 with the document as it stands when the write is stale', async () => {
    const api = await serve();
    const first = await (await api.put('/api/docs/stories/abc', { title: 'first' }, '')).json();
    await api.put('/api/docs/stories/abc', { title: 'from the phone' }, first.rev);

    const stale = await api.put('/api/docs/stories/abc', { title: 'from the laptop' }, first.rev);
    assert.equal(stale.status, 409);
    const refusal = await stale.json();
    assert.equal(refusal.ok, false);
    assert.equal(refusal.error, 'changed on another device');
    // Everything the laptop needs to reload, in the refusal itself.
    assert.equal(refusal.document.title, 'from the phone');
    assert.equal(refusal.document.rev, refusal.rev);

    // And the retry, based on what came back, lands.
    const retried = await api.put('/api/docs/stories/abc', { title: 'again' }, refusal.rev);
    assert.equal(retried.status, 200);
    await api.close();
  });

  it('takes a write that says nothing about what it was based on', async () => {
    const api = await serve();
    // A command line, a seeded fixture, a copy of the folder from elsewhere.
    await api.put('/api/docs/stories/abc', { title: 'first' });
    const over = await api.put('/api/docs/stories/abc', { title: 'second' });
    assert.equal(over.status, 200);
    assert.equal((await (await api.call('/api/docs/stories/abc')).json()).title, 'second');
    await api.close();
  });

  it('refuses an unknown collection, a bad id and a path that climbs out', async () => {
    const api = await serve();
    assert.equal((await api.call('/api/docs/backups')).status, 404);
    assert.equal((await api.call('/api/docs/stories/..%2F..%2Fsettings')).status, 404);
    assert.equal((await api.put('/api/docs/settings/other', {})).status, 404);
    await api.close();
  });

  it('refuses a body that is not a JSON document', async () => {
    const api = await serve();
    const response = await api.put('/api/docs/stories/abc', 'just a string');
    assert.equal(response.status, 400);
    await api.close();
  });

  it('refuses an empty body and a list, and leaves the document as it was', async () => {
    const api = await serve();
    const first = await (
      await api.put('/api/docs/stories/abc', { id: 'abc', title: 'kept' }, '')
    ).json();

    const empty = await api.call('/api/docs/stories/abc', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-doc-rev': first.rev },
      body: '',
    });
    assert.equal(empty.status, 400);
    assert.deepEqual(await empty.json(), { ok: false, error: 'body must be a JSON document' });

    const list = await api.put('/api/docs/stories/abc', [1, 2, 3], first.rev);
    assert.equal(list.status, 400);

    assert.deepEqual(await (await api.call('/api/docs/stories/abc')).json(), {
      id: 'abc',
      title: 'kept',
      rev: first.rev,
    });
    await api.close();
  });

  it('answers an unknown API path with JSON, never with the app', async () => {
    const api = await serve({ withApp: true });
    const response = await api.call('/api/nothing-here');
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type'), /application\/json/);
    await api.close();
  });
});

describe('serving the built app', () => {
  it('serves files, and the app itself for any other path', async () => {
    const api = await serve({ withApp: true });
    assert.match(await (await api.call('/main.js')).text(), /console\.log/);
    assert.match(await (await api.call('/')).text(), /<title>app<\/title>/);
    // A single page: a deep link is still the app, not a 404.
    assert.match(await (await api.call('/some/deep/link')).text(), /<title>app<\/title>/);
    await api.close();
  });

  it('never lets the browser keep index.html, which is what names the bundles', async () => {
    const api = await serve({ withApp: true });
    for (const path of ['/', '/index.html', '/some/deep/link']) {
      const response = await api.call(path);
      assert.match(response.headers.get('cache-control'), /no-cache/, path);
    }
    // The bundles themselves are named by their content and can be kept.
    assert.match((await api.call('/main.js')).headers.get('cache-control'), /max-age=3600/);
    await api.close();
  });

  it('answers 404 for a file that is not there, rather than handing over the app', async () => {
    const api = await serve({ withApp: true });
    const response = await api.call('/main-OLDHASH.js');
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /<title>app<\/title>/);
    await api.close();
  });

  it('says so plainly when there is no build to serve', async () => {
    const api = await serve();
    const response = await api.call('/');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /API is running/);
    await api.close();
  });
});

/**
 * A request whose Host header says what the test wants. `fetch` will only ever
 * send the URL's own, which is the one thing these tests are not about.
 */
function callAs(base, host, path, { method = 'GET', body, rev } = {}) {
  const { hostname, port } = new URL(base);
  const headers = {
    host,
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(rev === undefined ? {} : { 'x-doc-rev': String(rev) }),
  };
  return new Promise((fulfil, reject) => {
    const request = httpRequest({ hostname, port, path, method, headers }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (text += chunk));
      response.on('end', () =>
        fulfil({ status: response.statusCode, json: () => JSON.parse(text) }),
      );
    });
    request.on('error', reject);
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

describe('the Host header', () => {
  it('answers the machine it runs on, by any of its names', async () => {
    const api = await serve();
    const names = [
      'localhost',
      '127.0.0.1:1234',
      '[::1]:4177',
      '[fe80::1]',
      'app.localhost',
      '192.168.1.5:4177',
    ];
    for (const host of names) {
      assert.equal((await callAs(api.base, host, '/api/health')).status, 200, host);
    }
    await api.close();
  });

  it('refuses a request that names somebody else’s domain, which is what DNS rebinding sends', async () => {
    const api = await serve();
    const first = await (await api.put('/api/docs/stories/abc', { id: 'abc' }, '')).json();

    const read = await callAs(api.base, 'evil.example', '/api/docs/stories');
    assert.equal(read.status, 421);
    assert.deepEqual(read.json(), { ok: false, error: 'misdirected request' });

    const written = await callAs(api.base, 'evil.example:80', '/api/docs/stories/abc', {
      method: 'PUT',
      body: { id: 'abc', title: 'rebound' },
      rev: first.rev,
    });
    assert.equal(written.status, 421);
    assert.deepEqual(await (await api.call('/api/docs/stories/abc')).json(), {
      id: 'abc',
      rev: first.rev,
    });
    await api.close();
  });

  it('refuses a domain that happens to be spelt in hex, which reads like a v6 literal', async () => {
    const api = await serve();
    // No colon, so no address: these are names somebody can register, and the
    // rebinding page would be served from one of them. Answers come back before
    // the assertions so that a regression fails rather than leaving a listener.
    const names = ['cafe.ba', 'abcdef.de', 'dead.cf', 'beef.cafe'];
    const answers = [];
    for (const host of names) answers.push(await callAs(api.base, host, '/api/health'));
    await api.close();

    for (const [index, response] of answers.entries()) {
      assert.equal(response.status, 421, names[index]);
      assert.deepEqual(response.json(), { ok: false, error: 'misdirected request' });
    }
  });

  it('answers to a name it was told to answer to', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'lamplit-api-'));
    const app = createApp({ dataDir, hosts: ['study.lan'] });
    const server = await new Promise((fulfil) => {
      const instance = app.listen(0, '127.0.0.1', () => fulfil(instance));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await callAs(base, 'study.lan', '/api/health')).status, 200);
    assert.equal((await callAs(base, 'other.lan', '/api/health')).status, 421);
    await stop(server);
  });
});

describe('CORS', () => {
  it('authorises nobody by default, which is every packaged copy', async () => {
    const api = await serve();
    await api.put('/api/docs/stories/abc', { id: 'abc' }, 1);

    // A page on some other loopback port asking to read the stories, or the
    // settings the API key is in. Nothing comes back that would let it.
    for (const path of ['/api/health', '/api/docs/stories/abc']) {
      const response = await api.call(path, { headers: { origin: 'http://localhost:4200' } });
      assert.equal(response.headers.get('access-control-allow-origin'), null, path);
    }
    const preflight = await api.call('/api/docs/stories/abc', {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:4200' },
    });
    assert.equal(preflight.headers.get('access-control-allow-methods'), null);
    await api.close();
  });

  it('lets a localhost dev server through when it was asked to, and nobody else', async () => {
    const api = await serve({ devCors: true });
    const allowed = await api.call('/api/health', { headers: { origin: 'http://localhost:4200' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:4200');

    const refused = await api.call('/api/health', { headers: { origin: 'https://evil.example' } });
    assert.equal(refused.headers.get('access-control-allow-origin'), null);
    await api.close();
  });

  it('answers a preflight without reaching the routes', async () => {
    const api = await serve({ devCors: true });
    const response = await api.call('/api/docs/stories/abc', {
      method: 'OPTIONS',
      headers: { origin: 'http://127.0.0.1:4200' },
    });
    assert.equal(response.status, 204);
    assert.match(response.headers.get('access-control-allow-methods'), /PUT/);
    await api.close();
  });
});

describe('the content security policy', () => {
  it('travels with the page it governs, and with the API beside it', async () => {
    const api = await serve({ withApp: true });
    for (const path of ['/', '/api/health']) {
      const policy = (await api.call(path)).headers.get('content-security-policy');
      assert.match(policy, /default-src 'self'/, path);
    }
    await api.close();
  });

  it('allows no script the app did not ship, and no page but its own', async () => {
    const api = await serve({ withApp: true });
    const policy = (await api.call('/')).headers.get('content-security-policy');
    assert.match(policy, /script-src 'self'/);
    assert.doesNotMatch(policy, /script-src[^;]*unsafe-inline/);
    assert.match(policy, /object-src 'none'/);
    assert.match(policy, /frame-ancestors 'none'/);
    assert.match(policy, /base-uri 'self'/);
    await api.close();
  });

  it('leaves the endpoint open, because whose it is was never ours to say', async () => {
    // Any OpenAI-compatible URL the reader types into Connection.
    const api = await serve({ withApp: true });
    const policy = (await api.call('/')).headers.get('content-security-policy');
    assert.match(policy, /connect-src \*/);
    // And Angular writes a component's styles onto the page as it renders it.
    assert.match(policy, /style-src 'self' 'unsafe-inline'/);
    await api.close();
  });
});
