import { Injectable, computed, inject, signal } from '@angular/core';
import { revisionOf } from '@wire';
import { Conflict, Refused } from './api-client';
import { COLLECTIONS, DocRef, DocumentApi, keyOf, refOf } from './document-api';
import { StorageBackend } from './storage';

/**
 * saving   a write is on its way
 * saved    every document on disk matches what is on screen
 * offline  the server stopped answering; the session carries on and retries
 * refused  the server is answering and will not take a document; it is named
 */
type SaveStatus = 'saving' | 'saved' | 'offline' | 'refused';

/** Long enough to coalesce a burst of keystrokes, short enough to feel saved. */
const DEBOUNCE = 300;
const RETRY_FIRST = 1000;
const RETRY_MAX = 15_000;

/** The server is usually still finding its feet when the browser is opened. */
const LOAD_ATTEMPTS = 4;
const LOAD_RETRY = 400;

/**
 * All the keepalive requests a page may leave behind it, together, come to 64
 * KiB — the Fetch standard says so and Chromium enforces it by failing the
 * request, with the page already gone and nobody to hear it. A few dozen
 * exchanges of prose is a chapter document past that on its own, so the size
 * is counted before anything is sent and what will not fit is admitted to
 * rather than dropped. The rest of the allowance is headers.
 */
const BEACON_BUDGET = 60 * 1024;

/**
 * What the one-line notice says when a document under this session turned out
 * to have been written somewhere else. The same words either way — a write that
 * was refused, or a tab that was looked at again after the phone had been busy
 * — because it is the same fact, and two wordings for it would only invite the
 * reader to work out which is which.
 */
const RELOADED = 'Changed on another device; reloaded.';

interface Queued {
  ref: DocRef;
  kind: 'write' | 'delete';
}

/** A document the server said no to, and what it said. */
interface Rejection {
  queued: Queued;
  reason: string;
}

/**
 * The documents, and the server they came from.
 *
 * There is exactly one copy of a document in the browser: this map, filled at
 * startup by a single read of the server and thrown away when the tab closes.
 * The server is the only place a document lives, a reload starts again from
 * what is on disk, and there is nothing to reconcile because there is nothing
 * to reconcile *with*.
 *
 * It did not start out this way. The app was built without a backend and kept
 * its documents in `localStorage`; when the server arrived, that cache stayed
 * on as a "write-through cache" and bought a merge on every startup, a
 * persisted write queue, a rule for which side wins, and a class of bug where
 * the browser quietly uploaded an old story into a new install. None of that
 * was worth the reload being fast, on a local app whose whole database is a few
 * JSON files on the same machine.
 *
 * Writes go into the map and onto a queue: debounced, coalesced per document,
 * one request in flight so the server sees them in the order they happened. If
 * the server stops answering the queue stops draining and retries with a
 * widening delay; the session keeps working, because everything it needs is
 * already in memory.
 *
 * A server that answers and says no is a different thing, and is treated as
 * one. A refused document leaves the queue instead of standing at the head of
 * it for ever: everything behind it still saves, and the indicator names the
 * document and repeats what the server said, rather than blaming the network.
 *
 * Since a phone can be looking at the same documents (Preferences → Advanced),
 * there is a third answer: the document moved. Every document carries the
 * `rev` the server stamped it with, every write says which `rev` it was based
 * on, and a write based on one the document has moved past comes back refused
 * with the document as it now stands. This session takes that copy — losing
 * whatever it had typed over it, which is the honest outcome and is why the
 * notice says so — and `refresh` does the same thing the other way round, for
 * the tab that was in the background while the phone was being written in.
 *
 * There is no live push, and that is a choice rather than a gap. The use this
 * was built for is one person moving between a desk and an armchair, not two
 * people writing at once, and a socket held open for the second case would
 * have to be held open for the first as well.
 */
@Injectable({ providedIn: 'root' })
export class Persistence implements StorageBackend {
  private readonly api = inject(DocumentApi);

  private readonly documents = new Map<string, unknown>();
  /** The revision each document was at when this session last saw it. */
  private readonly revs = new Map<string, string>();
  private readonly statusState = signal<SaveStatus>('saved');
  private readonly errorState = signal('');
  private readonly readyState = signal(false);
  private readonly changedState = signal(0);
  private readonly noticeState = signal('');

  readonly status = this.statusState.asReadonly();
  readonly error = this.errorState.asReadonly();
  /** False until the server has handed over its documents. Nothing runs before. */
  readonly ready = this.readyState.asReadonly();
  readonly isOffline = computed(() => this.statusState() === 'offline');
  /**
   * Bumped whenever a document in the map was replaced by one from the server
   * rather than by this session. Nothing here can put it on screen — the stores
   * read at construction — so `Workspace` watches this and tells them to read
   * again, which it can do at a moment it knows is safe.
   */
  readonly changed = this.changedState.asReadonly();
  /** The one line to show for it, or nothing. Dismissed, not timed out. */
  readonly notice = this.noticeState.asReadonly();

  private readonly pending = new Map<string, Queued>();
  /** Documents the server refused, kept so they can be named and tried again. */
  private readonly rejected = new Map<string, Rejection>();
  private listening = false;
  private draining = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 0;
  private refreshing = false;

  // -- startup ---------------------------------------------------------------

  /**
   * Runs before the app is created. Everything the session will read is fetched
   * here, once; if it cannot be, the app does not start and says so, because
   * without the server there is nothing to show and nowhere to put what you
   * write.
   */
  async load(): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        const { documents } = await this.api.snapshot();
        this.documents.clear();
        this.revs.clear();
        for (const [key, document] of documents) {
          this.documents.set(key, document);
          this.revs.set(key, revisionOf(document));
        }
        this.readyState.set(true);
        this.errorState.set('');
        return;
      } catch (error) {
        if (attempt >= LOAD_ATTEMPTS) {
          this.errorState.set(message(error));
          this.readyState.set(false);
          return;
        }
        await delay(LOAD_RETRY * attempt);
      }
    }
  }

  /** The "try again" on the no-server screen. */
  async retryLoad(): Promise<boolean> {
    await this.load();
    if (this.readyState()) this.listen();
    return this.readyState();
  }

  /** Called once the app has actually started, to arm the unload handler. */
  listen(): void {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener('beforeunload', (event) => {
      if (!this.pending.size) {
        // A refused document is not queued and never will be: it is lost on
        // reload all the same, and that is worth being stopped for.
        if (this.rejected.size) event.preventDefault();
        return;
      }
      // One keepalive request per document is all the browser will still carry.
      // Deletes go too: a chapter deleted and then closed on is a file still on
      // disk, and the next start reads it back as a chapter that is there again.
      let carried = 0;
      let tooBig = false;
      for (const [key, queued] of this.pending) {
        if (queued.kind === 'delete') {
          this.api.sendBeaconRemove(queued.ref);
          continue;
        }
        const body = JSON.stringify(this.documents.get(key));
        carried += sizeOf(body);
        // Over the allowance the browser fails the request without a word, so
        // the honest thing is to say the writing is not saved yet.
        if (carried > BEACON_BUDGET) {
          tooBig = true;
          continue;
        }
        this.api.sendBeacon(queued.ref, body, this.revs.get(key) ?? '');
      }
      // Debounced writes almost always make it. A queue that is already failing
      // almost certainly will not, and neither will a chapter too long to carry
      // — and both are worth stopping someone for.
      if (tooBig || this.rejected.size || this.statusState() === 'offline') event.preventDefault();
    });
    window.addEventListener('online', () => this.retryNow());
  }

  /**
   * Catches this session up with the disk: what is there now, and which of it
   * has moved since this session last looked. Only the documents whose `rev`
   * changed are fetched, so the usual answer costs three small requests and no
   * downloads at all.
   *
   * Called by `Workspace` when the tab is looked at again, and not from here,
   * because whether this is a safe moment is a question about what is on
   * screen — a turn that is still streaming, most of all — and this class is
   * deliberately the one part of the app that knows nothing about that.
   */
  async refresh(): Promise<void> {
    // Anything this session has not managed to send yet is about to change
    // what the index says. Refreshing over the top of it would report this
    // session's own unsent writing as a change from somewhere else.
    if (!this.readyState() || this.refreshing) return;
    if (this.pending.size || this.draining || this.rejected.size) return;
    this.refreshing = true;
    try {
      const moved: string[] = [];
      const unaccounted = new Set(this.documents.keys());
      for (const collection of COLLECTIONS) {
        for (const entry of await this.api.index(collection)) {
          const key = keyOf({ collection, id: entry.id });
          unaccounted.delete(key);
          if (this.revs.get(key) !== entry.rev) moved.push(key);
        }
      }
      for (const key of moved) {
        const ref = refOf(key);
        // Gone between the index and the read: rare, and the same outcome as
        // not having been in the index at all.
        const document = ref ? await this.api.get(ref) : null;
        if (document === null) this.forget(key);
        else {
          this.documents.set(key, document);
          this.revs.set(key, revisionOf(document));
        }
      }
      // Whatever the index never mentioned was deleted somewhere else.
      for (const key of unaccounted) this.forget(key);
      if (moved.length || unaccounted.size) this.reloaded();
    } catch {
      // Not worth interrupting anyone for. What is in memory is still what
      // this session is writing, and the next time the tab is looked at is
      // another chance to catch up.
    } finally {
      this.refreshing = false;
    }
  }

  /** The notice has been read. */
  dismissNotice(): void {
    this.noticeState.set('');
  }

  // -- the documents ---------------------------------------------------------

  read<T>(key: string): T | null {
    return (this.documents.get(key) as T | undefined) ?? null;
  }

  write(key: string, value: unknown): void {
    this.documents.set(key, value);
    this.enqueue(key, 'write');
  }

  remove(key: string): void {
    this.documents.delete(key);
    this.enqueue(key, 'delete');
  }

  keys(prefix: string): string[] {
    return [...this.documents.keys()].filter((key) => key.startsWith(prefix));
  }

  // -- the queue -------------------------------------------------------------

  /**
   * The indicator is a button; this is what it does. Refused documents go back
   * on the queue: the reason may have been the server's rather than theirs — a
   * Host it was not yet answering to, a limit that has since been raised — and
   * asking again is the only way anyone can find out.
   */
  retryNow(): void {
    this.retryDelay = 0;
    for (const [key, rejection] of this.rejected) {
      if (!this.pending.has(key)) this.pending.set(key, rejection.queued);
    }
    this.rejected.clear();
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.schedule(0);
  }

  private enqueue(key: string, kind: Queued['kind']): void {
    const ref = refOf(key);
    if (!ref) return;
    this.pending.set(key, { ref, kind });
    // The document has changed since the server refused it — shorter, perhaps,
    // or deleted outright — so the answer it was given no longer applies.
    this.rejected.delete(key);
    // Queued is not saved. "Offline" and "refused" are the truer words while
    // they last, and each has its own way back to "saved" as the queue drains.
    if (!stuck(this.statusState())) this.statusState.set('saving');
    this.schedule(DEBOUNCE);
  }

  private schedule(delayMs: number): void {
    if (this.timer !== null || this.draining) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, delayMs);
  }

  private async drain(): Promise<void> {
    if (this.draining || !this.pending.size) return;
    this.draining = true;
    this.statusState.set('saving');
    let failure: unknown = null;
    try {
      while (this.pending.size) {
        const [key, queued] = this.pending.entries().next().value!;
        // Stays queued while it is in flight, so that a window closing in that
        // moment still beacons it and the queue is never seen as empty when it
        // is not. A failure therefore needs nothing done to it: it is already
        // where the retry will find it.
        try {
          await this.send(key, queued);
        } catch (error) {
          // The document moved under this session. Nothing is wrong with the
          // server or with the document; there is simply a newer one, and it
          // came back with the refusal.
          if (error instanceof Conflict) {
            this.adopt(key, error);
            continue;
          }
          // Only the server's silence stops the queue. Its refusal stops the
          // one document, which comes off the queue so the rest can go on.
          if (!(error instanceof Refused)) throw error;
          // Written to again while it was in flight: that version has not been
          // refused, and goes on its own account like any other write.
          if (this.pending.get(key) !== queued) continue;
          this.pending.delete(key);
          this.rejected.set(key, { queued, reason: message(error) });
          continue;
        }
        this.rejected.delete(key);
        // Gone only if this is still the entry that was sent: `enqueue` writes
        // a fresh object every time, so identity is the whole question, and
        // anything queued during the flight has to go on its own account.
        if (this.pending.get(key) === queued) this.pending.delete(key);
      }
    } catch (error) {
      failure = error;
    } finally {
      this.draining = false;
    }

    if (failure) {
      this.errorState.set(message(failure));
      this.statusState.set('offline');
      this.retryDelay = Math.min(this.retryDelay ? this.retryDelay * 2 : RETRY_FIRST, RETRY_MAX);
      this.schedule(this.retryDelay);
      return;
    }
    this.retryDelay = 0;
    // Only with nothing left is every document on disk what is on screen,
    // which is what "saved" is written on the indicator to mean.
    if (this.pending.size) {
      this.schedule(DEBOUNCE);
    } else if (this.rejected.size) {
      this.errorState.set(this.refusal());
      this.statusState.set('refused');
    } else {
      this.errorState.set('');
      this.statusState.set('saved');
    }
  }

  /** What the indicator says: which document, in the server's own words. */
  private refusal(): string {
    const [key, rejection] = this.rejected.entries().next().value!;
    const first = `${this.nameOf(key, rejection.queued)}: ${rejection.reason}`;
    const others = this.rejected.size - 1;
    if (!others) return first;
    return `${first} (and ${others} other ${others === 1 ? 'document' : 'documents'})`;
  }

  /**
   * A document by the name its writer would know it by. An id is no use to
   * anyone reading an indicator, and a deleted document has nothing else left.
   */
  private nameOf(key: string, queued: Queued): string {
    if (queued.ref.collection === 'settings') return 'Your preferences';
    const document = this.documents.get(key);
    const title =
      typeof document === 'object' && document !== null && 'title' in document
        ? titleOf(document.title)
        : '';
    if (title) return title;
    return queued.ref.collection === 'stories' ? 'A story' : 'A chapter';
  }

  private async send(key: string, queued: Queued): Promise<void> {
    if (queued.kind === 'delete') {
      await this.api.remove(queued.ref);
      this.revs.delete(key);
      return;
    }
    // Always what the document says now: a write that sat through a retry
    // should carry the latest version, not the one that was queued. The
    // revision goes with it, and `''` says this session has never seen one,
    // which for a document it has just made is exactly true.
    const rev = await this.api.put(queued.ref, this.documents.get(key), this.revs.get(key) ?? '');
    this.revs.set(key, rev);
  }

  /**
   * Takes the server's copy of a document in place of this session's.
   *
   * Whatever was typed here since the other device wrote is gone with it. That
   * is the honest outcome of two people editing one paragraph and the reason
   * the notice is shown rather than the merge being attempted: there is no
   * rule this app could apply to two versions of a sentence that would not
   * sometimes produce a third nobody wrote.
   */
  private adopt(key: string, conflict: Conflict): void {
    if (conflict.document === null) this.forget(key);
    else {
      this.documents.set(key, conflict.document);
      this.revs.set(key, conflict.rev);
    }
    // Off the queue: what was queued was the version that has just been
    // replaced, and sending it again would only be refused again.
    this.pending.delete(key);
    this.rejected.delete(key);
    this.reloaded();
  }

  private forget(key: string): void {
    this.documents.delete(key);
    this.revs.delete(key);
  }

  /** One notice, and one nudge to whoever can put the documents back on screen. */
  private reloaded(): void {
    this.noticeState.set(RELOADED);
    this.changedState.update((count) => count + 1);
  }
}

/** A title worth showing, or nothing: a document may carry anything at all. */
function titleOf(title: unknown): string {
  return typeof title === 'string' ? title.trim() : '';
}

/** A state the queue owns until it drains, and that a fresh write must not hide. */
function stuck(status: SaveStatus): boolean {
  return status === 'offline' || status === 'refused';
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Bytes on the wire, not characters: an accented line is longer than it looks. */
function sizeOf(body: string): number {
  return new TextEncoder().encode(body).length;
}

function delay(ms: number): Promise<void> {
  return new Promise((fulfil) => setTimeout(fulfil, ms));
}
