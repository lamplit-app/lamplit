import { defaultLog } from './log.js';

/**
 * The number in the URL, and what to do when something else already has it.
 *
 * Both of Lamplit's listeners want the same port and neither may insist on it,
 * so both facts live here rather than once per listener: the number a person
 * may end up reading off a screen, and the walk that keeps a busy port from
 * turning a double-click into a stack trace.
 */

/**
 * The port the packaged app asks for, and the port sharing asks for.
 *
 * The same number on purpose. It is what somebody may end up typing into a
 * phone, and a port that moved between runs would make the QR code the only
 * way in. The two never collide in one process: the zip's own listener takes
 * this and sharing walks past it, and in Electron the window's port is
 * whatever the operating system handed out — the shared one is the fixed one
 * precisely because a person reads it.
 *
 * `tools/smoke.mjs` and `tools/probe-providers.mjs` import it as well: what
 * they exercise is the app as it is actually started.
 */
export const DEFAULT_PORT = 4177;

/** How far past a busy port to walk before giving up and saying why. */
export const PORT_ATTEMPTS = 10;

/**
 * Listens, taking the next free port when the wanted one is in use.
 *
 * The server is handed in already made rather than created here, because the
 * two callers have different ones — an Express app wrapped in `http`, and the
 * bare `http` server sharing puts its pairing check in front of. Resolves with
 * that same server once it is listening; ask it for `address().port` to learn
 * what it actually got, which is the only place the answer exists when the
 * port asked for was 0.
 *
 * @template {import('node:http').Server} T
 * @param {T} server
 * @param {number} from
 * @param {string} host
 * @param {import('./log.js').Log} [log] where a port stepped over is reported
 * @returns {Promise<T>}
 */
export function listenWalking(server, from, host, log = defaultLog) {
  return new Promise((fulfil, reject) => {
    let port = from;
    const attempt = () => {
      // Named, and each removed by the other: a walk of ten ports on one
      // server object would otherwise leave nine dead listeners behind it,
      // and the 'error' one would still be there to catch a later fault.
      const listening = () => {
        server.removeListener('error', failed);
        fulfil(server);
      };
      const failed = (error) => {
        server.removeListener('listening', listening);
        if (error.code !== 'EADDRINUSE' || port >= from + PORT_ATTEMPTS) return reject(error);
        log(`port ${port} is busy, trying ${port + 1}`);
        port += 1;
        attempt();
      };
      server.once('listening', listening);
      server.once('error', failed);
      server.listen(port, host);
    };
    attempt();
  });
}
