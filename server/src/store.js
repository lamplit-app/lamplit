import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * The three document kinds the app persists, and where each one lives.
 * `settings` is one file rather than a folder because there is exactly one.
 */
export const COLLECTIONS = {
  settings: { single: 'settings', file: 'settings.json' },
  stories: { dir: 'stories' },
  chapters: { dir: 'chapters' },
};

/** Ids come from `crypto.randomUUID()`; this also keeps `..` out of paths. */
const ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isCollection(name) {
  return Object.hasOwn(COLLECTIONS, name);
}

export function isId(collection, id) {
  if (!ID.test(id)) return false;
  const config = COLLECTIONS[collection];
  return config.single ? id === config.single : true;
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
  #chains = new Map();

  constructor(dataDir) {
    this.#dataDir = dataDir;
  }

  get dataDir() {
    return this.#dataDir;
  }

  async init() {
    await mkdir(this.#dataDir, { recursive: true });
    for (const config of Object.values(COLLECTIONS)) {
      if (config.dir) await mkdir(join(this.#dataDir, config.dir), { recursive: true });
    }
  }

  pathOf(collection, id) {
    const config = COLLECTIONS[collection];
    return config.single
      ? join(this.#dataDir, config.file)
      : join(this.#dataDir, config.dir, `${id}.json`);
  }

  /** Every document in the collection, unparseable files skipped. */
  async list(collection) {
    const config = COLLECTIONS[collection];
    if (config.single) {
      const document = await this.read(collection, config.single);
      return document === null ? [] : [document];
    }
    const files = await readdir(join(this.#dataDir, config.dir)).catch(() => []);
    const documents = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const id = file.slice(0, -'.json'.length);
      // One entry that cannot be read — a folder wearing the name, a file held
      // open, a permission — costs that entry, not the collection. The listing
      // is what the app starts from; a 500 here is a no-server screen.
      const document = await this.read(collection, id).catch((error) => {
        console.warn(`[lamplit] skipping ${collection}/${file}: ${error.message}`);
        return null;
      });
      if (document !== null) documents.push(document);
    }
    return documents;
  }

  /**
   * The light listing: enough to know what is there, how fresh it is, and
   * whether the copy in a browser is still the copy on disk. `rev` is what
   * makes the last of those a comparison rather than a download — the app asks
   * for this when its tab is looked at again and fetches only what moved.
   */
  async index(collection) {
    const documents = await this.list(collection);
    return documents.map((document, position) => ({
      id: document?.id ?? COLLECTIONS[collection].single ?? String(position),
      updatedAt: document?.updatedAt ?? null,
      rev: revisionOf(document),
    }));
  }

  async read(collection, id) {
    try {
      return JSON.parse(await readFile(this.pathOf(collection, id), 'utf8'));
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
          return { ok: false, conflict: true, rev: current.rev, document: current.document };
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
    this.#chains.set(
      key,
      run.catch(() => {}),
    );
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

/** The `rev` a document carries, or `''` for one written before there were any. */
function revisionOf(document) {
  const rev = document?.['rev'];
  return typeof rev === 'string' ? rev : '';
}

/**
 * Writes a file by writing another one and renaming it over the target, which
 * is atomic on both Windows and POSIX: a reader sees the old bytes or the new
 * ones, and a run that dies half way leaves the old file intact.
 *
 * Here rather than inside the store's own write because `share.js` keeps a file
 * of its own beside the documents and wants exactly this, the Windows rename
 * failure included — where something holds the target open the write has failed
 * either way, and it must not also leave a stray `.tmp` behind for the backup
 * to pick up.
 *
 * @param {string} path
 * @param {string} text
 */
export async function writeAtomic(path, text) {
  const temporary = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporary, text, 'utf8');
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}
