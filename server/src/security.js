import express from 'express';
import { REV_HEADER } from '../../wire/contract.mjs';
import { HttpError } from './errors.js';

/**
 * Who is allowed to talk to this server, and what the page it serves is
 * allowed to load.
 *
 * Every one of these is a rule about the request rather than about a story, so
 * they sit together and away from the routes: `createApp` puts them in front,
 * in order, and no handler below them has to think about any of it. What is
 * here is a header, two gates and a body limit — nothing that reads a
 * document, and nothing a document could change.
 */

/**
 * What the page is allowed to load, and from where. Nothing here is
 * load-bearing against a threat this app has today — it serves its own bundle
 * to its own window — but it is the difference between one injected script and
 * none, for the price of a header.
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
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  'connect-src *',
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

/** The policy above, on every response this server sends. */
export function contentSecurityPolicy() {
  return (request, response, next) => {
    response.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    next();
  };
}

/**
 * A page on the web cannot read this API through CORS, but it can point a
 * domain of its own at 127.0.0.1 and then talk to "itself" — DNS rebinding —
 * and the browser sees nothing cross-origin about it. What gives it away is
 * the `Host` header, which names the attacker's domain: a request from this
 * machine names the machine. Loopback by name, `*.localhost`, any IP literal
 * (a phone on the LAN types one; an attacker's page cannot be served from one)
 * and whatever the server was told to answer to. Anything else is misdirected.
 *
 * @param {string[]} extra names the API answers to besides the machine's own
 */
export function sameMachineOnly(extra = []) {
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
 * A route the machine's own listener answers and the shared one does not.
 * `lamplitShared` is set by the wrapper in share.js, before Express sees the
 * request at all, so there is nothing a header can say to get out of it.
 */
export function computerOnly(request, response, next) {
  if (!request.lamplitShared) return next();
  throw new HttpError(403, 'that is the computer’s own setting');
}

/**
 * Whether a request came from the app itself: a browser sends no `Origin` on a
 * same-origin GET, and always sends one cross-origin. No `Origin` at all is
 * curl, or the app; an `Origin` naming this server is the app; anything else is
 * some other page that happens to be running on this machine.
 */
export function sameOrigin(request) {
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
export function corsFor(enabled) {
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

/** What the API will read as a body, and what it says about anything else. */
export const BODY_LIMIT = '16mb';

/**
 * The body, parsed, with one refusal of its own.
 *
 * An empty body parses as `{}`, which would then be written over a document as
 * if somebody had meant it; nobody sends nothing on purpose. The same refusal,
 * in the same words, as the one the PUT route makes about a body that is not
 * an object.
 */
export function jsonBody() {
  return express.json({
    limit: BODY_LIMIT,
    verify: (request, response, body) => {
      if (!body.length) throw new HttpError(400, NOT_A_DOCUMENT);
    },
  });
}

/** Said by two places about the same thing, so it is written once. */
export const NOT_A_DOCUMENT = 'body must be a JSON document';
