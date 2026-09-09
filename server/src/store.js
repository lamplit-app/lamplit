import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { SETTINGS_ID, revisionOf } from '../../wire/contract.mjs';
import { writeAtomic } from './fs-atomic.js';
import { defaultLog } from './log.js';

/**
 * Where each collection lives on disk, as one of two shapes.
 *
 * `settings` is one file rather than a folder because there is exactly one of
 * it — and everything that follows from that, the fixed id, the listing with
 * at most one entry, the document nothing invents an id for, used to be five
 * separate `if (config.single)` branches spread through the store below. It is
 * now one choice made here, once, and the store asks the shape rather than
 * reading the shape's flags: a third layout would be a third function beside
 * these two and nothing else.
 *
 * The names are the wire's — `wire/contract.mjs` — and only the layout is
 * here, so a fourth collection is a name over there and an entry here. A test
 * holds the two lists against each other.
 */
export const COLLECTIONS = {
  [SETTINGS_ID]: oneFile(SETTINGS_ID),
  stories: aFolder('stories'),
  chapters: aFolder('chapters'),
};

/**
 * @typedef {object} Shape
 * @property {(dataDir: string) => Promise<void>} make          the folder it needs, if any
 * @property {(dataDir: string, id: string) => string} pathOf   the file one document is in
 * @property {(id: string) => boolean} holds                    whether it files anything under that id
 * @property {(dataDir: string) => Promise<string[]>} ids       what is filed there now
 * @property {(id: string, document: unknown) => unknown} named a read document, id and all
 */

/**
 * One document, in one file, under one id — which is the collection's own name.
 *
 * Nothing is added to it on the way out: the client's settings document has no
 * `id` field, and inventing one would put a field on the wire that the app
 * never wrote and would then write back.
 *
 * @param {string} name
 * @returns {Shape}
 */
function oneFile(name) {
  const file = `${name}.json`;
  return {
    // The data folder itself is made by init; there is nothing under it.
    make: async () => {},
    pathOf: (dataDir) => join(dataDir, file),
    holds: (id) => id === name,
    ids: async () => [name],
    named: (id, document) => document,
  };
}

/**
 * A folder of documents, one file each, named by id.
 *
 * @param {string} dir
 * @returns {Shape}
 */
function aFolder(dir) {
  return {
    make: async (dataDir) => {
      await mkdir(join(dataDir, dir), { recursive: true });
    },
    pathOf: (dataDir, id) => join(dataDir, dir, `${id}.json`),
    holds: () => true,
    ids: async (dataDir) => {
      const files = await readdir(join(dataDir, dir)).catch(() => []);
      return files
        .filter((file) => file.endsWith('.json'))
        .map((file) => file.slice(0, -'.json'.length));
    },
    named: named,
  };
}

/**
 * A document from a folder collection, filed under the name it is filed under.
 *
 * The filename wins, and that is the whole of it. A folder collection keys
 * everything — the listing, the client's snapshot, the write it sends back —
 * off the id *inside* the document, so `stories/A.json` carrying `{id: 'B'}`
 * was loaded as story B, written back to `stories/B.json`, and `A.json` was
 * left behind to be listed again at every start and duplicated once `B.json`
 * existed. Only a hand-edited file or a curl could do it, and the API now
 * refuses the write that would (see the id check in `documents-router.js`) —
 * but a file on disk is not something the API was ever asked about, so disk
 * truth wins here too and the next write puts the document straight.
 */
function named(id, document) {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    return document;
  }
  return { ...document, id };
}

/** Ids come from `crypto.randomUUID()`; this also keeps `..` out of paths. */
const ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The names Windows will not give a file, whatever extension follows them.
 * `CON.json` is the console, and opening it succeeds and reads nothing — so a
 * document filed under that id would silently never exist. A curl-only
 * foot-gun, since every id the app makes is a UUID, and one line to close.
 */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function isCollection(name) {
  return Object.hasOwn(COLLECTIONS, name);
}

export function isId(collection, id) {
  if (!ID.test(id) || RESERVED.test(id)) return false;
  return COLLECTIONS[collection].holds(id);
}

/**
 * JSON documents on disk, one file each.
 *
 * Two rules make concurrent writes safe. Whoever comes first gets written
 * first: every path has its own FIFO promise chain, so two writes to the same
 * document never interleave and never land out of order. And every write goes
 * to a temporary file that is then renamed over the target, which is atomic on
 * both Windows and POSIX — a reader sees the old document or the new one, and
 * a crash mid-write leaves the old one intact.
 *
 * Two writers are what the third rule is for. Every document carries a `rev`
 * the server stamps on it, and a conditional write says which `rev` it was
 * based on: the same one the file has now, and the write lands; a different
 * one, and it is refused with the document as it actually stands, for the
 * client to reload. Nothing is silently dropped and nothing is silently
 * overwritten — which is what the sequence number this replaced did, and why
 * a phone and a laptop editing one story would have lost the phone's writing.
 *
 * The current `rev` is read off the disk on every conditional write rather
 * than remembered here. It costs one read of a file that is about to be
 * rewritten anyway, and it buys two things worth more than that: the guard
 * still holds after a restart, and it still holds when the file was changed by
 * something that is not this process at all — a hand edit, a restored backup.
 */
export class DocumentStore {
  #dataDir;
  #log;
  #chains = new Map();

  /**
   * @param {string} dataDir
   * @param {{log?: import('./log.js').Log}} [said] where a skipped document is reported
   */
  constructor(dataDir, { log = defaultLog } = {}) {
    this.#dataDir = dataDir;
    this.#log = log;
  }

  get dataDir() {
    return this.#dataDir;
  }

  async init() {
    await mkdir(this.#dataDir, { recursive: true });
    for (const shape of Object.values(COLLECTIONS)) await shape.make(this.#dataDir);
  }

  pathOf(collection, id) {
    return COLLECTIONS[collection].pathOf(this.#dataDir, id);
  }

  /** Every document in the collection, unreadable files skipped. */
  async list(collection) {
    return (await this.#entries(collection)).map(({ document }) => document);
  }

  /**
   * The light listing: enough to know what is there, how fresh it is, and
   * whether the copy in a browser is still the copy on disk. `rev` is what
   * makes the last of those a comparison rather than a download — the app asks
   * for this when its tab is looked at again and fetches only what moved.
   */
  async index(collection) {
    return (await this.#entries(collection)).map(({ id, document }) => ({
      id: document?.id ?? id,
      updatedAt: document?.updatedAt ?? null,
      rev: revisionOf(document),
    }));
  }

  /**
   * Everything filed in the collection, each with the id it is filed under.
   *
   * One entry that cannot be read — a folder wearing the name, a file held
   * open, a permission — costs that entry, not the collection. The listing is
   * what the app starts from; a 500 here is a no-server screen.
   */
  async #entries(collection) {
    const found = [];
    for (const id of await COLLECTIONS[collection].ids(this.#dataDir)) {
      const document = await this.read(collection, id).catch((error) => {
        this.#log(`skipping ${collection}/${id}.json: ${error.message}`);
        return null;
      });
      if (document !== null) found.push({ id, document });
    }
    return found;
  }

  /**
   * The document filed under this id, with `id` set to the id it was filed
   * under — see `named` above, which is where that rule and its reasons are.
   */
  async read(collection, id) {
    try {
      const document = JSON.parse(await readFile(this.pathOf(collection, id), 'utf8'));
      return COLLECTIONS[collection].named(id, document);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      // A truncated or hand-edited file reads as missing rather than as a 500:
      // the client still has its own copy and will write over it.
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  }

  /**
   * Overwrites the document and stamps it with a new `rev`.
   *
   * `basedOn` is the `rev` the writer last saw. Leave it out and the write is
   * unconditional, which is what a command line and a test fixture are. Give
   * it, and a document that has moved on since is not overwritten: the answer
   * is `{ conflict: true }` carrying the document as it stands, which is
   * everything the client needs to reload it without a second request. A
   * document that is not there has no revision, so `''` is the `basedOn` that
   * creates one — and a real `rev` against a missing file is a conflict, which
   * is how a stale write cannot resurrect a chapter somebody deleted.
   */
  async write(collection, id, document, basedOn) {
    return this.#enqueue(collection, id, async (path) => {
      if (basedOn !== undefined) {
        const current = await this.#current(path);
        if (current.rev !== basedOn) {
          // Through the shape as well, because the client files whatever comes
          // back with the refusal and must file it where it actually lives.
          const document =
            current.document === null ? null : COLLECTIONS[collection].named(id, current.document);
          return { ok: false, conflict: true, rev: current.rev, document };
        }
      }
      const rev = newRevision();
      // Spread first, so a `rev` the client echoed back inside the document it
      // is sending cannot be the one that ends up written down.
      const stamped = { ...document, rev };
      await writeAtomic(path, `${JSON.stringify(stamped, null, 2)}\n`);
      return { ok: true, rev };
    });
  }

  /**
   * Unconditional, unlike a write, and on purpose: deleting is a person saying
   * so about a whole document, and a story taking its chapters with it deletes
   * chapters nobody has looked at. Refusing that because a phone had touched
   * one of them would leave half a story on disk. What a guard here would be
   * for — a stale write landing on top of a delete — is caught on the writing
   * side instead, where the missing file is a revision nothing can match.
   */
  async remove(collection, id) {
    return this.#enqueue(collection, id, async (path) => {
      await rm(path, { force: true });
      return { ok: true, rev: '' };
    });
  }

  /** The revision on disk now, and the document it belongs to. */
  async #current(path) {
    let document;
    try {
      document = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      // Missing, truncated, hand-edited into something that will not parse:
      // all three are "there is nothing here to have been based on".
      return { rev: '', document: null };
    }
    return { rev: revisionOf(document), document };
  }

  /** Serialises work on one document, whoever asked first. */
  #enqueue(collection, id, work) {
    // Lower-cased, because Windows and macOS give `abc.json` and `ABC.json`
    // the same file: two chains over one document would order neither. Ids are
    // UUIDs, so nothing is lost by folding them.
    const key = `${collection}/${String(id).toLowerCase()}`;
    const path = this.pathOf(collection, id);
    const previous = this.#chains.get(key) ?? Promise.resolve();
    const run = previous.then(() => work(path));
    // The chain must survive a failed write, or the document jams for good.
    const settled = run.catch(() => {});
    this.#chains.set(key, settled);
    // And it must not outlive the work. One entry per document ever touched,
    // in a process that runs for weeks, is a map that only grows. The entry
    // goes only if it is still the last link — whoever queued behind it in the
    // meantime is waiting on it and keeps it — so the last writer clears up
    // and nothing in flight loses its order.
    void settled.finally(() => {
      if (this.#chains.get(key) === settled) this.#chains.delete(key);
    });
    return run;
  }
}

/**
 * Eight random bytes rather than a counter: a revision has to be unique across
 * a restart, and a counter starting again at one would hand the second run's
 * first write the number the first run's first write already used.
 */
function newRevision() {
  return randomBytes(8).toString('hex');
}
