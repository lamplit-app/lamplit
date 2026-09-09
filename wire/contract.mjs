// @ts-check

/**
 * The wire between the app and the server, said once.
 *
 * The two sides are deliberately ignorant of each other: the server owns the
 * bytes and understands nothing about a document, and the client owns every
 * document shape in `core/models.ts`. What sat between them, though — the
 * header name, the words of a refusal, the collections, the paths, the shapes
 * of the three answers that are not documents — was written twice, by hand,
 * and each side's tests checked that side against itself. Both were right and
 * nothing said they were right about the same protocol.
 *
 * So: one file, imported by `server/src` as ESM and by `app/src` through the
 * `@wire` path in `app/tsconfig.json`. Plain JavaScript with JSDoc types
 * rather than TypeScript, because the server runs from source and has no build
 * step to put one through — and with `// @ts-check` above, so the types here
 * are checked rather than decorative. TypeScript reads them straight out of
 * this file; there is no `.d.ts` to drift from it.
 *
 * `wire/`, not `shared/`: the app already has a `shared/` folder meaning
 * something else entirely, and two folders of that name in one repository
 * would be a question every reader has to answer twice.
 *
 * Nothing here imports anything. It is read by a browser bundle and by Node,
 * so it must be true in both and needs nothing from either.
 */

// -- the documents -----------------------------------------------------------

/**
 * Every collection there is, in the order the bootstrap read asks for them:
 * settings first, because the open story is named in it, then the stories,
 * then their chapters.
 *
 * The names are the wire. Where each one lives on disk is the server's own
 * business and stays in `store.js` — keyed off these, so a fourth collection
 * is a name here and a layout there, and nothing at all on the client.
 *
 * @type {readonly ['settings', 'stories', 'chapters']}
 */
export const COLLECTIONS = ['settings', 'stories', 'chapters'];

/** @typedef {(typeof COLLECTIONS)[number]} Collection */

/**
 * The settings document's id, which is also its collection's name: there is
 * exactly one of it, so it is a file rather than a folder and the id is fixed.
 */
export const SETTINGS_ID = 'settings';

/**
 * The revision a write says it was based on.
 *
 * Absent means "unconditionally", which is a command line or a test fixture;
 * the app always sends one, and `''` is what it sends for a document it
 * believes is not there yet. See `DocumentStore.write`.
 */
export const REV_HEADER = 'x-doc-rev';

/**
 * What a 409 says, in the words the reader sees.
 *
 * The client shows it, a server test asserts on it and a client test serves it.
 * Three readers of one sentence, which is exactly how many places it used to be
 * typed out in.
 */
export const CONFLICT = 'changed on another device';

/**
 * What the server says out loud when it has gone wrong rather than refused.
 *
 * The real message goes to its log and no further: an `EACCES` or a failed
 * rename names a path on the computer's filesystem, and a paired phone on the
 * network is not the right audience for one. A refusal the server *means* —
 * `sharing is off`, `no free port to share on` — carries its own sentence at
 * whatever status it chose; see `server/src/errors.js`.
 */
export const SERVER_ERROR = 'server error';

/** Every path the API answers to, and the one prefix they all share. */
export const ROUTES = {
  api: '/api',
  health: '/api/health',
  updates: '/api/updates',
  /** `${docs}/:collection` and `${docs}/:collection/:id`. */
  docs: '/api/docs',
  share: '/api/server/share',
  shareQr: '/api/server/share/qr',
};

// -- what the answers look like ----------------------------------------------
//
// Every 2xx body below carries `ok: true`, and every refusal is
// `{ ok: false, error }` — the envelope, which is the one thing every route
// has in common and the reason `ok` is in these shapes rather than beside them.

/**
 * A refusal, whatever the status. `error` is a sentence, not a code: it is
 * shown to a reader who has just pressed something.
 *
 * @typedef {object} ErrorBody
 * @property {false} ok
 * @property {string} error
 */

/**
 * A 409 from a write, carrying the document as the server actually holds it —
 * so reloading is something the client can simply do rather than a second
 * request that could itself be overtaken. `document` is null when the answer is
 * that there is no document there any more, which is what a stale write on top
 * of a delete gets.
 *
 * @typedef {ErrorBody & { rev: string, document: unknown }} ConflictBody
 */

/**
 * One line of a collection's index: what is there, how fresh it is, and
 * whether the copy in a browser is still the copy on disk.
 *
 * @typedef {object} IndexEntry
 * @property {string} id
 * @property {string | null} updatedAt
 * @property {string} rev
 */

/**
 * `GET /api/health`: who is answering, and which build of it.
 *
 * `name` is what tells a Lamplit server from a static host that happens to
 * answer on that path. `dataDir` is left out unless the asker is the app on
 * this machine — the folder is on the computer and is no use to a phone, and
 * on Windows the path carries the account name.
 *
 * @typedef {object} Health
 * @property {true} ok
 * @property {'lamplit'} name
 * @property {string} version
 * @property {string} commit      short SHA, `+` when built from a dirty tree
 * @property {string} builtAt     ISO date, empty for a build nothing stamped
 * @property {string} build       the CI run number, or `local`
 * @property {'desktop' | 'zip' | 'dev' | (string & {})} channel
 * @property {string | null} previousVersion  the version whose data folder this is
 * @property {string} [dataDir]
 */

/**
 * @typedef {object} ReleaseAsset
 * @property {string} name
 * @property {string} url
 * @property {number} size
 */

/**
 * @typedef {object} Release
 * @property {string} tag          `v0.2.0`, as published
 * @property {string} version      the tag without its `v`
 * @property {string} name         the release's title, or the tag
 * @property {string} publishedAt  ISO date
 * @property {string} body         the release notes, as markdown
 * @property {string} url          the release page
 * @property {ReleaseAsset[]} assets
 */

/**
 * `GET /api/updates`: whether a newer Lamplit has been published, as the
 * server found out. `checked` is true once an answer came back, good or bad,
 * which is what lets the app tell "still asking" from "asked, and nothing".
 *
 * @typedef {object} UpdateReport
 * @property {boolean} ok
 * @property {boolean} enabled     false when this run was told not to ask
 * @property {boolean} checked
 * @property {string} version      the version doing the asking
 * @property {Release | null} latest
 * @property {Release[]} newer     newer than `version`, newest first
 * @property {Release[]} releases  every published release, newest first
 */

/**
 * `GET`/`PUT /api/server/share`: whether the second listener is open, on which
 * port, and every address a phone could reach it on. The pairing token is
 * never in here — it exists on the server and inside the picture of it.
 *
 * @typedef {object} ShareState
 * @property {boolean} share
 * @property {number} port
 * @property {string[]} addresses
 */

/**
 * The `rev` a document carries, or `''` for one written before there were any.
 *
 * The server stamps it and reads it back off the disk to guard a write; the app
 * reads it off a document it has just loaded, to say what its next write is
 * based on. Three lines, and it was those three lines twice — `revisionOf` on
 * one side and `revIn` on the other, which is also two names for one question.
 *
 * Deliberately forgiving of anything that is not a string: a hand-edited file,
 * a document from a version before revisions, and `null` are all "there is no
 * revision here", which is exactly what `''` means to a conditional write.
 *
 * @param {unknown} document
 * @returns {string}
 */
export function revisionOf(document) {
  if (typeof document !== 'object' || document === null) return '';
  const rev = /** @type {Record<string, unknown>} */ (document)['rev'];
  return typeof rev === 'string' ? rev : '';
}

// -- the one comparison both sides make --------------------------------------

/**
 * Numeric, segment by segment: 0.10.0 is newer than 0.9.9, and 0.1.0 is not.
 *
 * Both sides ask this and they must agree. The server asks it of GitHub's
 * releases against the running version; the app asks it of the running version
 * against the one whose data folder this is, to decide whether an upgrade
 * notice is worth showing. Two copies of the rule would eventually disagree
 * about one release, and the one they would disagree about is a pre-release:
 * `0.2.0-beta.1` reads as a beta *of* 0.2.0 — below the release, not a fourth
 * segment above it.
 *
 * @param {string} candidate
 * @param {string} than
 * @returns {boolean}
 */
export function isNewer(candidate, than) {
  const left = parse(candidate);
  const right = parse(than);
  for (let i = 0; i < Math.max(left.numbers.length, right.numbers.length); i++) {
    const a = left.numbers[i] ?? 0;
    const b = right.numbers[i] ?? 0;
    if (a !== b) return a > b;
  }
  // The same numbers: the release outranks its own pre-release, and two
  // pre-releases are left alone rather than guessed at.
  return !left.pre && right.pre;
}

/**
 * The dotted numbers at the front, and whether anything hyphenated follows.
 *
 * @param {string} version
 * @returns {{ numbers: number[], pre: boolean }}
 */
function parse(version) {
  const match = /^v?(\d+(?:\.\d+)*)(-\S+)?/.exec(String(version).trim());
  return {
    numbers: match?.[1] ? match[1].split('.').map((part) => Number.parseInt(part, 10)) : [],
    pre: Boolean(match?.[2]),
  };
}
