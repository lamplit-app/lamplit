import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { HttpError } from './errors.js';
import { DEFAULT_PORT, listenWalking } from './ports.js';
import { writeAtomic } from './fs-atomic.js';
import { defaultLog } from './log.js';

/**
 * The second front door, and the lock on it.
 *
 * Lamplit's own listener never moves: `127.0.0.1`, this machine, nothing else.
 * Sharing does not change it. It opens a *second* listener on `0.0.0.0`, with
 * the same Express app behind it and one thing in front — a pairing check that
 * every request arriving that way has to pass. Turning sharing off closes that
 * listener and leaves the first one exactly as it was, so the tab already open
 * on the computer never notices either.
 *
 * Why a lock at all, when the phone is on your own Wi-Fi: because the API has
 * no accounts and never has. `GET /api/docs/settings/settings` answers with the
 * connection settings, and the API key is in them in plain text. A switch that
 * only changed the bind address would hand that key, and every story, to
 * anything else on the network — a guest's laptop, a games console, whatever
 * the router is also serving. So the address and the lock arrive together.
 *
 * The lock is deliberately the smallest thing that works. One secret, 128 bits
 * of it, which the phone gets by opening `/pair/<token>` once — the URL the QR
 * code on the computer encodes. That sets an `HttpOnly` cookie and redirects to
 * the app, and from then on the phone is simply a browser with a cookie.
 * Anything without it gets a page saying to scan the code. "New code" rotates
 * the token, which unpairs every phone at once, because the cookie they hold is
 * the old one.
 *
 * What it is not: HTTPS. The traffic is plain HTTP across your own network, and
 * a paired phone can read and change everything the computer can, the key
 * included. Both facts are said out loud in the dialog and in the guide,
 * because a lock that is quiet about its limits is worse than no lock. See #21
 * for why a certificate is not a thing this can simply add.
 */

/** The file this owns, beside the documents. Not `settings.json`: see app.js. */
export const SHARE_FILE = 'server.json';

const COOKIE = 'lamplit_pair';
/** A year. Scanning once should mean once; "New code" is the way to undo it. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Sharing, as an object something else owns the lifetime of.
 *
 * Made before the Express app so the app can register the routes that read and
 * change it, then handed the app with `serve`. `init` is what reads the saved
 * state off disk and, if it says so, opens the listener.
 *
 * `host` is every interface, which is the whole point. It is an option because
 * two things want it narrower: a machine with a reason to offer only one
 * adapter, and this project's own tests, where binding every interface on a
 * developer's Windows laptop raises the firewall prompt on `npm test`.
 */
export function createSharing({
  dataDir,
  port = DEFAULT_PORT,
  host = '0.0.0.0',
  log = defaultLog,
}) {
  return new Sharing(dataDir, port, host, log);
}

class Sharing {
  #dataDir;
  #wantedPort;
  #host;
  /** @type {import('node:http').RequestListener | null} */
  #handler = null;
  /** @type {import('node:http').Server | null} */
  #server = null;
  #port = 0;
  #token = '';
  #log;

  constructor(dataDir, wantedPort, host, log) {
    this.#dataDir = dataDir;
    this.#wantedPort = wantedPort;
    this.#host = host;
    this.#log = log;
  }

  /** The Express app to put behind the pairing check. */
  serve(handler) {
    this.#handler = handler;
  }

  /**
   * Reads `server.json` and honours it, so a machine that was sharing when it
   * was shut down is sharing again when it comes back. A listener that will not
   * open is reported rather than thrown: the app must still start.
   */
  async init() {
    const saved = await readState(this.#dataDir);
    this.#token = saved.token || newToken();
    if (!saved.share) return { share: false, error: '' };
    try {
      await this.#open();
      return { share: true, error: '' };
    } catch (error) {
      // The saved intent stays saved: the port may be free at the next start,
      // and forgetting the setting because of one busy port would be worse.
      return { share: false, error: error.message };
    }
  }

  /**
   * What the dialog shows, and what it never shows: the token is not in here.
   *
   * @returns {import('../../wire/contract.mjs').ShareState}
   */
  status() {
    return {
      share: this.#server !== null,
      port: this.#port,
      addresses: this.#server === null ? [] : localAddresses(),
    };
  }

  get on() {
    return this.#server !== null;
  }

  get port() {
    return this.#port;
  }

  /**
   * Opens or closes the second listener, and writes the choice down.
   *
   * A busy range is the one failure this can have that is nobody's mistake:
   * ten ports tried and every one of them taken. It used to escape as a raw
   * 500 carrying `listen EADDRINUSE 0.0.0.0:8788`, so a reader who pressed the
   * switch was told "500 Internal Server Error" and a phone was told a port
   * number — while the identical failure at start-up is `init`'s return value
   * and a sentence. It is a 503 with a sentence now: the switch is refused,
   * not broken, and asking again later is the right thing to do.
   */
  async set(on) {
    try {
      if (on && !this.#server) await this.#open();
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      throw new HttpError(503, 'no free port to share on — something else is using them');
    }
    if (!on && this.#server) await this.#close();
    await this.#persist(on);
    return this.status();
  }

  /**
   * A new secret. Every phone that scanned the old one is holding a cookie that
   * no longer matches, which is what "unpairs every phone" means — there is no
   * list of devices anywhere to remove anything from.
   */
  async rotate() {
    this.#token = newToken();
    await this.#persist(this.#server !== null);
    return this.status();
  }

  /** The URL the QR code encodes, for one of the addresses the machine has. */
  pairUrl(address) {
    return `http://${address}:${this.#port}/pair/${this.#token}`;
  }

  /**
   * The QR code, as SVG, rendered here rather than in the browser: the token is
   * the one thing the app is never told, so the picture of it has to be made on
   * this side. `M` recovers a quarter of the code, which is what a phone camera
   * at arm's length off a laptop screen wants.
   */
  qr(address) {
    return QRCode.toString(this.pairUrl(address), {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
    });
  }

  async close() {
    if (this.#server) await this.#close();
  }

  async #open() {
    if (!this.#handler) throw new Error('nothing to serve: call serve(app) first');
    const server = createServer((request, response) => {
      // Marked before anything else looks at it: the API refuses the routes
      // that are the computer's own business on the strength of this.
      request.lamplitShared = true;
      if (this.#refuseUnpaired(request, response)) return;
      this.#handler(request, response);
    });
    const listening = await listenWalking(server, this.#wantedPort, this.#host, this.#log);
    // What it actually got, not what it asked for: port 0 is how a test takes
    // whatever is free, and the answer only the socket knows.
    this.#port = listening.address().port;
    this.#server = server;
  }

  async #close() {
    const server = this.#server;
    this.#server = null;
    this.#port = 0;
    await new Promise((fulfil) => {
      server.close(() => fulfil());
      // A phone that walked out of range still holds a keep-alive socket, and a
      // server holding one never finishes closing. The switch has to be a
      // switch, so the sockets go with it.
      server.closeIdleConnections();
      server.closeAllConnections();
    });
  }

  /**
   * The whole of the lock. Returns true when it has answered the request itself,
   * which is either the redirect that pairs a phone or the page that turns one
   * away.
   */
  #refuseUnpaired(request, response) {
    const path = (request.url ?? '/').split('?')[0];
    const scanned = /^\/pair\/([A-Za-z0-9]{1,128})\/?$/.exec(path);
    if (scanned) {
      if (!sameSecret(scanned[1], this.#token)) return refuse(request, response);
      response.writeHead(302, {
        location: '/',
        // Path=/ so it is sent for the API as well as the page; HttpOnly so a
        // script that got onto the page cannot read it out; Lax so another
        // site cannot make the phone use it. Not `Secure`: there is no HTTPS
        // here, and a `Secure` cookie over http is a cookie that is never set.
        'set-cookie': `${COOKIE}=${this.#token}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax`,
        // The pairing URL is the secret. Nothing may keep a copy of it.
        'cache-control': 'no-store',
      });
      response.end();
      return true;
    }
    if (sameSecret(cookieOf(request.headers['cookie'], COOKIE), this.#token)) return false;
    return refuse(request, response);
  }

  async #persist(share) {
    const path = join(this.#dataDir, SHARE_FILE);
    await mkdir(this.#dataDir, { recursive: true });
    const body = `${JSON.stringify({ share, token: this.#token }, null, 2)}\n`;
    await writeAtomic(path, body);
  }
}

/**
 * Every address a phone on the same network could reach this machine at.
 * Non-internal IPv4 only: loopback is not somewhere else, and a v6 literal is
 * not something anybody reads off a screen and types into a phone.
 *
 * On Windows this is usually more than one — Hyper-V and WSL each have an
 * adapter, and a VPN adds another — and there is no reliable way from here to
 * tell which one the phone is on. So they are all offered, in the order the
 * machine lists them, and scanning the one that works is quicker than any
 * guess this could make.
 */
export function localAddresses() {
  const found = new Set();
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      // Node 18 and later say 'IPv4'; the number is what older ones said, and
      // costs one comparison to keep working.
      if (entry.internal || (entry.family !== 'IPv4' && entry.family !== 4)) continue;
      found.add(entry.address);
    }
  }
  return [...found];
}

/** 128 bits, hex, so it survives being put in a URL and read by a camera. */
export function newToken() {
  return randomBytes(16).toString('hex');
}

/**
 * The page a phone gets when it has not scanned the code, or has scanned an
 * old one. Deliberately a dead end: it says where to look and offers no way in
 * from here, because there is none — the secret is on the other screen.
 */
function refuse(request, response) {
  // Nothing here reads the request body, and a body left unread is a socket
  // Node has to throw away rather than answer on. It costs a line to drain.
  request.resume();
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Lamplit</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 2rem 1.5rem;
        box-sizing: border-box;
        background: #14151a;
        color: #e8e6e1;
        font: 1rem/1.6 system-ui, sans-serif;
      }
      main { max-width: 26rem; text-align: center; }
      h1 { font-size: 1.35rem; font-weight: 600; margin: 0 0 0.75rem; }
      p { margin: 0 0 0.75rem; color: #a8a49c; }
    </style>
  </head>
  <body>
    <main>
      <h1>Scan the code on the computer</h1>
      <p>
        This is Lamplit, but it does not know this phone yet — or the code has
        been changed since it last did.
      </p>
      <p>
        On the computer running Lamplit, open <strong>Preferences &rarr; Advanced</strong>
        and scan the QR code under &ldquo;Share on this network&rdquo;.
      </p>
    </main>
  </body>
</html>
`;
  response.writeHead(401, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    // This page loads nothing and runs nothing; the only thing it needs
    // allowing is the stylesheet written into it.
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
  });
  response.end(body);
  return true;
}

async function readState(dataDir) {
  try {
    const parsed = JSON.parse(await readFile(join(dataDir, SHARE_FILE), 'utf8'));
    return {
      share: parsed?.share === true,
      token: typeof parsed?.token === 'string' ? parsed.token : '',
    };
  } catch {
    // Missing on a first run, unreadable if somebody edited it: either way,
    // not shared, and a token will be made for the next time it is.
    return { share: false, token: '' };
  }
}

/** One cookie out of the header, without a parser and without a dependency. */
function cookieOf(header, name) {
  for (const pair of (header ?? '').split(';')) {
    const at = pair.indexOf('=');
    if (at < 0) continue;
    if (pair.slice(0, at).trim() !== name) continue;
    return pair.slice(at + 1).trim();
  }
  return '';
}

/**
 * Constant time, so the answer cannot be found one character at a time by
 * asking a few thousand times — which is exactly what something on the network
 * is in a position to do. Lengths are compared first because `timingSafeEqual`
 * throws on a mismatch, and a length is not the secret.
 */
function sameSecret(given, expected) {
  if (!given || !expected || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
