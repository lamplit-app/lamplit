import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_PORT } from './ports.js';

/**
 * The command line, and where to find the built app.
 *
 * Both of them used to be private functions at the bottom of `index.js`, under
 * a top-level `await` — so nothing could import them, and the only thing that
 * ever exercised them was spawning the whole process from the e2e suite. What
 * they get wrong is quiet: `--port abc` became `NaN` and an uncaught stack
 * trace from deep inside `net`, and a misspelt flag was accepted in silence
 * and then ignored. Here they are two functions a test can simply call.
 *
 * @typedef {object} Options
 * @property {string} [data]    where the documents are
 * @property {string} [public]  where the built app is
 * @property {number} [port]    the port to ask for
 * @property {boolean} open     whether to open a browser at it
 */

/**
 * What `node server/src/index.js` accepts. Anything else is a mistake worth
 * saying so about rather than ignoring — `tools/lib/staged-tree.mjs` has
 * refused unknown options since it was written, and this is the same rule on
 * the door a reader actually walks through.
 */
const FLAGS = {
  data: { type: 'string' },
  public: { type: 'string' },
  port: { type: 'string' },
  open: { type: 'boolean', default: false },
};

/**
 * Reads the command line, or throws one sentence saying why not.
 *
 * `port` is a string to `parseArgs` and a number here, because the check is
 * the point: a port is a whole number in the range a socket will accept, and
 * `0` is the useful edge — it means "whatever is free", which is what the
 * desktop shell and every test ask for.
 *
 * @param {string[]} argv `process.argv.slice(2)`
 * @returns {Options}
 */
export function parseArguments(argv) {
  let parsed;
  try {
    ({ values: parsed } = parseArgs({ args: argv, options: FLAGS, allowPositionals: false }));
  } catch (error) {
    // `parseArgs` says "Unknown option '--prot'. To specify a positional
    // argument, use -- …", which is advice about an interface this has not
    // got. The first sentence of it is the part worth passing on.
    throw new Error(`${String(error.message).split('. ')[0]}. ${expected()}`, { cause: error });
  }
  const options = { open: parsed.open === true };
  if (parsed.data !== undefined) options.data = parsed.data;
  if (parsed.public !== undefined) options.public = parsed.public;
  if (parsed.port !== undefined) options.port = port(parsed.port);
  return options;
}

/**
 * The port to ask for, from all the places it can be said. The command line
 * wins over the environment, `PORT` is honoured because a great many things
 * set it, and anything unusable is a sentence rather than a stack trace.
 *
 * @param {Options} options
 * @param {Record<string, string | undefined>} env
 * @returns {number}
 */
export function wantedPort(options, env = process.env) {
  if (options.port !== undefined) return options.port;
  const said = env['LAMPLIT_PORT'] ?? env['PORT'];
  return said === undefined || said === '' ? DEFAULT_PORT : port(said, 'LAMPLIT_PORT');
}

/**
 * A whole number a socket will take, or a sentence saying it is not one.
 *
 * Digits and nothing else, before the range: `Number` is far too willing — it
 * reads `''` as 0, `'0x10'` as 16 and `' 80 '` as 80, and none of those is
 * something a person typed meaning a port.
 */
function port(said, from = '--port') {
  const digits = /^\d{1,5}$/.test(String(said));
  const value = digits ? Number(said) : NaN;
  if (!Number.isInteger(value) || value > 65535) {
    throw new Error(`${from} needs a whole number from 0 to 65535, not ${JSON.stringify(said)}`);
  }
  return value;
}

function expected() {
  return `Expected ${Object.keys(FLAGS)
    .map((flag) => `--${flag}`)
    .join(', ')}.`;
}

/**
 * Where the Angular build puts the app, relative to a repository root.
 *
 * The one definition of that path. It was spelt out in six files — the server,
 * the shell, three tools and the e2e harness — and the day the Angular output
 * moves, five of them are wrong and none of them says so.
 *
 * @param {string} root
 * @returns {string}
 */
export function builtApp(root) {
  return join(root, 'app', 'dist', 'app', 'browser');
}

/**
 * The built app to serve: the packaged layout first, then the repository's
 * Angular output. A packaged copy has `public/` beside the server; a checkout
 * has neither until `npm run build`, and is handed the path it will appear at.
 *
 * @param {string} root the folder the app was unzipped or cloned into
 * @returns {string}
 */
export function findBuiltApp(root) {
  const packaged = join(root, 'public');
  if (existsSync(join(packaged, 'index.html'))) return packaged;
  return builtApp(root);
}
