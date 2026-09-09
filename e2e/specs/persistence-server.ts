import { ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REV_HEADER, SETTINGS_ID } from '../../wire/contract.mjs';
import { builtApp } from '../../server/src/cli.js';
import { DocumentStore } from '../../server/src/store.js';
import { freePort, waitForHealth } from '../../tools/lib/script.mjs';

/**
 * The real persistence server, started per test on its own port with its own
 * empty data folder, serving the real production build.
 *
 * Every spec runs against this, because it is the only arrangement the app has:
 * the browser holds no documents of its own, so a test seeds by writing JSON
 * into the data folder — which is exactly what a person does when they copy a
 * story onto a new machine.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const ENTRY = join(ROOT, 'server', 'src', 'index.js');
export const BUILT_APP: string = builtApp(ROOT);

/** The specs skip rather than fail when the app has not been built. */
export const IS_BUILT = existsSync(join(BUILT_APP, 'index.html'));

export class PersistenceServer {
  readonly dataDir: string;
  readonly port: number;
  readonly url: string;
  /**
   * The port the second listener takes when sharing is switched on. Its own,
   * and free, because the suite runs several servers over a run and 4177 is
   * only the default a person would see.
   */
  readonly sharePort: number;
  /**
   * Where a paired phone would go. The listener is bound to the loopback here
   * rather than to every interface — it is the same listener either way, and
   * binding every interface raises the Windows firewall prompt on `npm run e2e`.
   */
  readonly sharedUrl: string;
  private child: ChildProcess | null = null;

  private constructor(dataDir: string, port: number, sharePort: number) {
    this.dataDir = dataDir;
    this.port = port;
    this.sharePort = sharePort;
    this.url = `http://127.0.0.1:${port}`;
    this.sharedUrl = `http://127.0.0.1:${sharePort}`;
  }

  /** A fresh folder and a free port, so nothing carries over between tests. */
  static async create(): Promise<PersistenceServer> {
    const dataDir = await mkdtemp(join(tmpdir(), 'lamplit-e2e-'));
    return new PersistenceServer(dataDir, await freePort(), await freePort());
  }

  async start(): Promise<void> {
    if (this.child) return;
    this.child = spawn(process.execPath, [ENTRY], {
      env: {
        ...process.env,
        LAMPLIT_DATA_DIR: this.dataDir,
        LAMPLIT_PUBLIC_DIR: BUILT_APP,
        LAMPLIT_PORT: String(this.port),
        LAMPLIT_SHARE_PORT: String(this.sharePort),
        LAMPLIT_SHARE_HOST: '127.0.0.1',
        LAMPLIT_BACKUP: '0',
      },
      stdio: 'ignore',
    });
    await this.waitFor(true);
  }

  /**
   * The pairing token, from the file the server keeps it in. The app is never
   * told it — the server draws it into the QR code and nothing else — so this
   * is the only place a test can read it, which is the point.
   */
  async shareToken(): Promise<string> {
    const saved = JSON.parse(await readFile(join(this.dataDir, 'server.json'), 'utf8')) as {
      token?: string;
    };
    return saved.token ?? '';
  }

  /** What the app's own switch does, for a test that is not about the switch. */
  async setShare(on: boolean): Promise<void> {
    const response = await fetch(`${this.url}/api/server/share`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ share: on }),
    });
    if (!response.ok) throw new Error(`could not set sharing: ${response.status}`);
  }

  /**
   * A write from somewhere that is not the browser under test: the phone, or
   * the second tab. Reads the document to find the revision it is based on, so
   * it is exactly the request another copy of the app would send.
   */
  async writeAs(
    collection: 'settings' | 'stories' | 'chapters',
    id: string,
    change: (document: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void> {
    const url = `${this.url}/api/docs/${collection}/${id}`;
    const current = (await (await fetch(url)).json()) as Record<string, unknown>;
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', [REV_HEADER]: String(current['rev'] ?? '') },
      body: JSON.stringify(change(current)),
    });
    if (!response.ok) throw new Error(`the other device's write failed: ${response.status}`);
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = null;
    const exited = new Promise<void>((fulfil) => child.once('exit', () => fulfil()));
    child.kill();
    await exited;
    await this.waitFor(false);
  }

  async dispose(): Promise<void> {
    await this.stop();
    await rm(this.dataDir, { recursive: true, force: true });
  }

  /**
   * Puts documents on disk before the app is opened, keyed the way the client
   * keys them: `settings`, `story:<id>`, `chapter:<id>`. This is the only way
   * to seed anything now — there is nowhere else for a document to be.
   *
   * Through the server's own store, so that where a document lands is decided
   * once, by the thing that will read it back. This file used to spell out
   * `stories/`, `chapters/` and `settings.json` in four places, and a change
   * to that layout would have left every spec seeding into folders nothing
   * looks in — a suite that fails, but not where the mistake is.
   */
  async seed(documents: Record<string, unknown>): Promise<void> {
    const store = this.store();
    await store.init();
    for (const [key, document] of Object.entries(documents)) {
      const { collection, id } = refOf(key);
      await store.write(collection, id, document);
    }
  }

  /** Takes a document off disk behind the app's back. */
  async remove(collection: 'stories' | 'chapters', id: string): Promise<void> {
    await rm(this.store().pathOf(collection, id), { force: true });
  }

  /** What is actually on disk, which is the whole point of these specs. */
  async document<T = Record<string, unknown>>(
    collection: 'settings' | 'stories' | 'chapters',
    id?: string,
  ): Promise<T | null> {
    try {
      const path = this.store().pathOf(collection, id ?? SETTINGS_ID);
      return JSON.parse(await readFile(path, 'utf8')) as T;
    } catch {
      return null;
    }
  }

  async ids(collection: 'stories' | 'chapters'): Promise<string[]> {
    const index = (await this.store().index(collection)) as { id: string }[];
    return index.map((entry) => entry.id).sort();
  }

  /**
   * A store over the same folder the server has. Not the server's own object —
   * that one is in another process — but the same rules about where a document
   * goes, which is the only thing asked of it here.
   */
  private store(): DocumentStore {
    return new DocumentStore(this.dataDir, { log: () => {} });
  }

  private async waitFor(up: boolean, timeout = 20_000): Promise<void> {
    await waitForHealth(this.url, { up, timeout, every: 100 });
  }
}

/** Where a client storage key lives on the server; the prefixes are the app's. */
function refOf(key: string): { collection: 'settings' | 'stories' | 'chapters'; id: string } {
  if (key.startsWith('story:')) return { collection: 'stories', id: key.slice('story:'.length) };
  if (key.startsWith('chapter:')) {
    return { collection: 'chapters', id: key.slice('chapter:'.length) };
  }
  if (key === SETTINGS_ID) return { collection: SETTINGS_ID, id: SETTINGS_ID };
  throw new Error(`not a document key: ${key}`);
}
