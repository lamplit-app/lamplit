import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

/**
 * The half-dozen things every script in `tools/` was written with.
 *
 * Each of them existed two, three or four times over before this file did, and
 * the copies had begun to disagree in ways that only show up on one operating
 * system: `run`'s Windows shell rule was "always, on Windows" in
 * `package.mjs` and "always, unless you remember to say otherwise" in
 * `desktop.mjs`, where a path with a space in it would have been split;
 * `readJson` threw in three places and swallowed in a fourth;
 * `waitForHealth` was written three times, once with a stop flag and twice
 * without. One of each, here, and the rule that is right is the only one left.
 *
 * Nothing here knows what any particular script does. Anything that does —
 * what ships, what electron-builder is handed, what the docs must say — is in
 * a module of its own beside this one, with a `node:test` on it.
 */

/**
 * One script's voice: the steps it announces, and the one line it stops on.
 *
 * `run` here is the throwing `run` below with that line wrapped around it, so
 * a script says `run(...)` and gets a sentence rather than a stack trace when
 * npm is not where it thought.
 *
 * @param {string} name what to call this script when it has bad news
 */
export function script(name) {
  const stop = (message) => fail(name, message);
  return {
    step,
    fail: stop,
    /** @type {typeof run} */
    run: (command, args, options) => {
      try {
        run(command, args, options);
      } catch (error) {
        stop(error.message);
      }
    },
  };
}

/** A thing about to happen, said out loud, because these scripts take a while. */
export function step(message) {
  console.log(`\n• ${message}`);
}

/**
 * The end of a script, in its own name and in one line. A stack trace is for a
 * fault in the script; everything these say is a fault in what it was asked to
 * do, and the reader is looking at a terminal.
 *
 * @param {string} name
 * @param {string} message
 * @returns {never}
 */
export function fail(name, message) {
  console.error(`\n${name}: ${message}`);
  process.exit(1);
}

/**
 * A command, run to completion, with its output going where this script's does.
 * Throws on anything that is not a clean exit.
 *
 * The `shell` rule, which is the whole reason this is worth sharing: npm and
 * npx are `.cmd` files on Windows and Node will not spawn one directly, so
 * they need a shell — and a shell splits every argument on its spaces, so
 * anything carrying a path must not have one. Naming the four commands that
 * are batch files is the rule that gets both right without the caller having
 * to remember, which is what `desktop.mjs` had to and `package.mjs` did not.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd?: string, shell?: boolean}} [where]
 */
export function run(command, args, { cwd, shell = isBatch(command) } = {}) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

/** The commands that are `.cmd` on Windows, and are nothing special anywhere else. */
function isBatch(command) {
  return process.platform === 'win32' && /^(npm|npx|yarn|pnpm)$/.test(command);
}

/**
 * A JSON file, parsed, with the path in the message when it is not one.
 *
 * Throws, unlike the server's own reader in `version.js`, which answers `null`
 * because a missing build stamp is a normal thing for a checkout to have. A
 * script asking for a package.json that is not there has nothing to go on.
 *
 * @param {string} path
 */
export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`could not read ${path}: ${error.message}`, { cause: error });
  }
}

/**
 * The version the whole repository is at: `npm version` writes only this one,
 * and four scripts used to read it for themselves.
 *
 * @param {string} root
 */
export function rootVersion(root) {
  return readJson(join(root, 'package.json')).version;
}

/**
 * Waits until the server at `base` answers `/api/health`, or until it stops.
 *
 * `up: false` is the other half, and it is the one a test harness needs: a
 * server that has been killed is not down until the port is actually free, and
 * starting the next one before then takes the port from under it.
 *
 * @param {string} base    `http://127.0.0.1:4177` or the same with a slash
 * @param {object} [until]
 * @param {boolean} [until.up]      whether to wait for it to answer, or to stop answering
 * @param {number} [until.timeout]  how long to wait before saying it never happened
 * @param {number} [until.every]    how often to ask
 * @param {() => boolean} [until.stopped] whether to give up because we are shutting down
 */
export async function waitForHealth(
  base,
  { up = true, timeout = 30_000, every = 200, stopped } = {},
) {
  const health = new URL('api/health', base.endsWith('/') ? base : `${base}/`);
  const deadline = Date.now() + timeout;
  for (;;) {
    if (stopped?.()) return false;
    const answering = await fetch(health).then(
      (response) => response.ok,
      () => false,
    );
    if (answering === up) return true;
    if (Date.now() > deadline) {
      throw new Error(`the server never came ${up ? 'up' : 'down'} on ${base}`);
    }
    await new Promise((fulfil) => setTimeout(fulfil, every));
  }
}

/**
 * Ask the operating system for a port, then give it straight back.
 *
 * A race in principle and never one in practice: nothing else on the machine
 * is handing out ports in the second between. It is what several tools want
 * over asking for a fixed number — a suite that starts a dozen servers over a
 * run must not collide with itself, or with whatever is already on 4177.
 *
 * @returns {Promise<number>}
 */
export function freePort() {
  return new Promise((fulfil, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {{port: number}} */ (probe.address());
      probe.close(() => fulfil(port));
    });
  });
}
