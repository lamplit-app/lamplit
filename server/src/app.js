import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CONFLICT, REV_HEADER, ROUTES } from '../../wire/contract.mjs';
import { HttpError, answerErrors } from './errors.js';
import { COLLECTIONS, DocumentStore, isCollection, isId } from './store.js';
import { createUpdateChecker } from './updates.js';

/**
 * What the page is allowed to load, and from where. Nothing here is load-bearing
 * against a threat this app has today — it serves its own bundle to its own
 * window — but it is the difference between one injected script and none, for
 * the price of a header.
 *
 * The two that are not the strictest thing they could be, and why:
 *
 * - `connect-src *`, because where the story is sent is the reader's own
 *   choice: a URL typed into Connection, any OpenAI-compatible endpoint on the
 *   web. Anything narrower would be this app deciding which providers exist.
 * - `style-src 'unsafe-inline'`, because Angular puts a component's styles on
 *   the page as a `<style>` element when the component is first rendered. The
 *   alternative is a nonce, which means a per-response index.html and a build
 *   that knows about it.
 *
 * `script-src 'self'` is why `optimization.styles.inlineCritical` is off in
 * app/angular.json: that step rewrites the stylesheet link into a deferred one
 * with an `onload=""` attribute, which is an inline script and is forbidden
 * here — and a stylesheet that never applies is an unreadable app.
 *
 * `base-uri 'self'` rather than `'none'`: index.html carries `<base href="/">`,
 * which the router reads. `'self'` still refuses an injected `<base>` pointing
 * anywhere else, which is the trick this directive exists for.
 *
 * Only pages served from here get this. `ng serve` serves its own, and a
 * development server is not what anything ships.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  'connect-src *',
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

/**
 * The whole API, and the built app in front of it.
 *
 * Deliberately tiny: the client owns the document shapes, the server owns
 * nothing but the bytes. Anything the server understood about a document would
 * be a second place to change when the shape changes.
 */
export function createApp({
  dataDir,
  publicDir,
  build = {},
  previousVersion = null,
  updates = createUpdateChecker({ version: build.version ?? '0.0.0', enabled: false }),
  /** Names the API answers to besides the machine's own; see sameMachineOnly. */
  hosts = [],
  /** Whether another page on this machine may call the API; see devCors. */
  devCors = false,
  /**
   * The second listener and the lock on it, when something owns one. Left out
   * — by a test, and by anything that only wants the API — the three routes
   * below are simply not there, and the app hides the switch that reads them.
   */
  sharing = null,
}) {
  const store = new DocumentStore(dataDir);
  const app = express();

  app.disable('x-powered-by');
  app.use((request, response, next) => {
    response.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    next();
  });
  app.use(corsFor(devCors));
  app.use(ROUTES.api, sameMachineOnly(hosts));
  // An empty body parses as `{}`, which would then be written over a document
  // as if somebody had meant it; nobody sends nothing on purpose. The same
  // refusal, in the same words, as the one the PUT route makes below.
  app.use(
    ROUTES.api,
    express.json({
      limit: '16mb',
      verify: (request, response, body) => {
        if (!body.length) throw new HttpError(400, NOT_A_DOCUMENT);
      },
    }),
  );

  /**
   * Who is answering, and which build of it. The client reads this for the
   * About sheet and for the notice it shows after an upgrade, so every field
   * the build was stamped with is here rather than in a second endpoint.
   */
  app.get(ROUTES.health, (request, response) => {
    /** @type {import('../../wire/contract.mjs').Health} */
    const health = {
      ok: true,
      name: 'lamplit',
      version: build.version ?? '0.0.0',
      commit: build.commit ?? '',
      builtAt: build.builtAt ?? '',
      build: build.build ?? 'local',
      channel: build.channel ?? 'dev',
      previousVersion,
      // Where the writing is kept — a path that on Windows carries the account
      // name — so About can show it under developer mode. To the app itself
      // and to a command line, not to another page that happened to ask, and
      // not to a phone: the folder is on the computer and is no use over there.
      ...(sameOrigin(request) && !request.lamplitShared ? { dataDir } : {}),
    };
    response.json(health);
  });

  /**
   * Whether a newer Lamplit has been published. Nothing asks GitHub until this
   * is called, and it is called only by an app whose reader left the check on —
   * so switching it off in Preferences means the request does not happen,
   * rather than happening and being ignored.
   */
  app.get(ROUTES.updates, async (request, response) => {
    response.json(await updates.check());
  });

  app.get(`${ROUTES.docs}/:collection`, async (request, response) => {
    const { collection } = request.params;
    if (!isCollection(collection)) throw new HttpError(404, 'unknown collection');
    const light = request.query['index'] !== undefined;
    response.json(light ? await store.index(collection) : await store.list(collection));
  });

  app.get(`${ROUTES.docs}/:collection/:id`, async (request, response) => {
    const { collection, id } = named(request);
    const document = await store.read(collection, id);
    if (document === null) throw new HttpError(404, NOT_FOUND);
    response.json(document);
  });

  app.put(`${ROUTES.docs}/:collection/:id`, async (request, response) => {
    const { collection, id } = named(request);
    if (!isDocument(request.body)) throw new HttpError(400, NOT_A_DOCUMENT);
    // The URL says where this document goes and the body may not disagree.
    // Without this, `PUT stories/A` carrying `{id: 'B'}` wrote a document to
    // `A.json` that every listing then called B — read as B, written back to
    // `B.json`, and `A.json` left behind to be listed again at every start.
    // Absent is allowed: the settings document has no id of its own.
    if (request.body.id !== undefined && request.body.id !== id) {
      throw new HttpError(400, 'the document’s id is not the one in the URL');
    }
    const result = await store.write(collection, id, request.body, revOf(request));
    // Not an error the client did anything wrong to deserve: the document
    // moved on somewhere else. It comes back with the refusal, so reloading
    // it is not a second request.
    if (result.conflict) {
      throw new HttpError(409, CONFLICT, { rev: result.rev, document: result.document });
    }
    response.json(result);
  });

  app.delete(`${ROUTES.docs}/:collection/:id`, async (request, response) => {
    const { collection, id } = named(request);
    response.json(await store.remove(collection, id));
  });

  /**
   * Sharing: read it, change it, and the picture that pairs a phone with it.
   *
   * All three are the computer's own business and are refused on the shared
   * listener, paired or not. The switch belongs to whoever is sitting at the
   * machine — a phone that could turn sharing off would be a phone that could
   * lock the computer out of its own setting, and a phone that could ask for
   * the QR code would be a phone that could pass the lock on to another one.
   */
  if (sharing) {
    app.get(ROUTES.share, computerOnly, (request, response) => {
      response.json(sharing.status());
    });

    app.put(ROUTES.share, computerOnly, async (request, response) => {
      const body = request.body ?? {};
      // Rotating first, so "off, and a new code" leaves nothing listening
      // that is still answering to the old one for the moment in between.
      if (body.rotate === true) await sharing.rotate();
      if (typeof body.share === 'boolean') await sharing.set(body.share);
      response.json(sharing.status());
    });

    app.get(ROUTES.shareQr, computerOnly, async (request, response) => {
      if (!sharing.on) throw new HttpError(409, 'sharing is off');
      const { addresses } = sharing.status();
      const asked = request.query['address'];
      // Only an address this machine actually has: the token is about to be
      // drawn into a picture, and a query string must not choose whose.
      const address = addresses.includes(asked) ? asked : addresses[0];
      if (!address) throw new HttpError(409, 'no network address to share on');
      const svg = await sharing.qr(address);
      // The pairing URL is the secret, so the picture of it is too: nothing
      // between here and the screen may keep a copy.
      response.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
    });
  }

  app.use(ROUTES.api, () => {
    throw new HttpError(404, 'no such endpoint');
  });

  if (publicDir && existsSync(join(publicDir, 'index.html'))) {
    // The bundles carry a hash in their names and can be cached for as long as
    // anyone likes; index.html is what names them, so it has to be asked about
    // every time or an upgrade leaves the browser asking for bundles that are
    // no longer there.
    app.use(
      express.static(publicDir, {
        index: 'index.html',
        maxAge: '1h',
        setHeaders: (response, path) => {
          if (path.endsWith('index.html')) response.set('Cache-Control', 'no-cache');
        },
      }),
    );
    // A single page, so a path that is not a file is still the app. Express 5
    // has no `*` route any more; a middleware is the way to say "everything".
    // A path with an extension is a file that is not there, and saying so is
    // worth more than an HTML page where a script was expected.
    app.use((request, response, next) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return next();
      if (/\.[a-z0-9]+$/i.test(request.path)) return next();
      response.set('Cache-Control', 'no-cache');
      response.sendFile(join(publicDir, 'index.html'));
    });
  } else {
    app.get('/', (request, response) => {
      response
        .status(200)
        .type('text/plain')
        .send(
          'Lamplit API is running. The built app is not being served from here.\n' +
            'Run `npm start` in the repository to develop, or `npm run package` to build a copy that is.\n',
        );
    });
  }

  app.use(answerErrors());

  app.locals['store'] = store;
  return app;
}

export { COLLECTIONS };

/**
 * The collection and id in the path, refused if either is not one this server
 * will have. Three routes ask the same question and used to answer it in the
 * same two lines each; a 404 rather than a 400 on purpose — an id this server
 * will not have names nothing that exists.
 */
function named(request) {
  const { collection, id } = request.params;
  if (!isCollection(collection) || !isId(collection, id)) throw new HttpError(404, NOT_FOUND);
  return { collection, id };
}

/** What the client says it read. The empty string is a document it is creating. */
function revOf(request) {
  const raw = request.get(REV_HEADER);
  return raw === undefined ? undefined : String(raw);
}

/**
 * A route the machine's own listener answers and the shared one does not.
 * `lamplitShared` is set by the wrapper in share.js, before Express sees the
 * request at all, so there is nothing a header can say to get out of it.
 */
function computerOnly(request, response, next) {
  if (!request.lamplitShared) return next();
  throw new HttpError(403, 'that is the computer’s own setting');
}

const NOT_FOUND = 'not found';
const NOT_A_DOCUMENT = 'body must be a JSON document';

/** One JSON object: not a string, not a number, not a list, not nothing. */
function isDocument(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body);
}

/**
 * A page on the web cannot read this API through CORS, but it can point a
 * domain of its own at 127.0.0.1 and then talk to "itself" — DNS rebinding —
 * and the browser sees nothing cross-origin about it. What gives it away is
 * the `Host` header, which names the attacker's domain: a request from this
 * machine names the machine. Loopback by name, `*.localhost`, any IP literal
 * (a phone on the LAN types one; an attacker's page cannot be served from one)
 * and whatever the server was told to answer to. Anything else is misdirected.
 */
function sameMachineOnly(extra) {
  const allowed = new Set(['localhost', '127.0.0.1', '::1', ...extra.map(String)]);
  return (request, response, next) => {
    const header = request.get('host');
    // No Host at all is HTTP/1.0 on the command line, not a browser.
    if (!header || isOwnHost(hostnameOf(header), allowed)) return next();
    response.status(421).json({ ok: false, error: 'misdirected request' });
  };
}

/** The name in a Host header, without its port or its IPv6 brackets. */
function hostnameOf(header) {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(header);
  if (bracketed) return bracketed[1].toLowerCase();
  return header.replace(/:\d+$/, '').toLowerCase();
}

function isOwnHost(hostname, allowed) {
  if (allowed.has(hostname) || hostname.endsWith('.localhost')) return true;
  // An IP literal: dotted v4, or the v6 that came in brackets. A v6 literal
  // always has a colon left after the brackets came off, and requiring one is
  // what keeps a hex-only domain name — `cafe.ba`, `dead.cf` — out.
  return (
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ||
    (hostname.includes(':') && /^[0-9a-f:.]+$/.test(hostname))
  );
}

/**
 * Whether a request came from the app itself: a browser sends no `Origin` on a
 * same-origin GET, and always sends one cross-origin. No `Origin` at all is
 * curl, or the app; an `Origin` naming this server is the app; anything else is
 * some other page that happens to be running on this machine.
 */
function sameOrigin(request) {
  const origin = request.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === request.get('host');
  } catch {
    return false;
  }
}

/**
 * Whether another page on this machine may read what this API answers.
 *
 * Off, because nothing needs it on: the app asks for `/api/...` relative to
 * wherever it was served, so a packaged copy is same-origin, and `npm start`
 * proxies `/api` from the dev server (app/proxy.conf.json) rather than calling
 * across. What was on the other side of that allowance was every story, every
 * setting and the API key in plain text, readable by any page the reader
 * happened to have open on any loopback port.
 *
 * `LAMPLIT_DEV_CORS=1` puts it back, for a dev server run without the proxy.
 * Localhost origins only, even then.
 */
function corsFor(enabled) {
  return enabled ? localhostCors : noCors;
}

function noCors(request, response, next) {
  // Answered, but with nothing that authorises anything: a browser refuses the
  // request it was asking permission for, which is the point.
  if (request.method === 'OPTIONS') return response.sendStatus(204);
  next();
}

function localhostCors(request, response, next) {
  const origin = request.get('origin');
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
    response.set('Access-Control-Allow-Origin', origin);
    response.set('Vary', 'Origin');
    response.set('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS');
    response.set('Access-Control-Allow-Headers', `Content-Type,${REV_HEADER}`);
    response.set('Access-Control-Max-Age', '600');
  }
  if (request.method === 'OPTIONS') return response.sendStatus(204);
  next();
}
