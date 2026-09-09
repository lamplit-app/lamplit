import { Injectable, inject } from '@angular/core';
import { COLLECTIONS, REV_HEADER, ROUTES, SETTINGS_ID, revisionOf } from '@wire';
import type { Collection, IndexEntry } from '@wire';
import { ApiClient, conflictFrom, failure } from './api-client';
import { KEYS } from './documents';

/**
 * The wire side of persistence: where a storage key lives on the server, and
 * the calls that move a document across. Nothing here knows what is in a
 * document — the server does not either, beyond the `rev` it stamps on one.
 *
 * The header name, the collections, the paths and the shape of an index entry
 * are `wire/contract.mjs`'s, which is the file the server reads them from too.
 * What is left here is the half only a client has: which storage key a
 * document is filed under, and which of them lives where.
 */

export type { Collection, IndexEntry };
export { COLLECTIONS };

export interface DocRef {
  collection: Collection;
  id: string;
}

/** Where a storage key lives on the server, or null if it lives nowhere. */
export function refOf(key: string): DocRef | null {
  if (key === KEYS.settings) return { collection: 'settings', id: SETTINGS_ID };
  if (key.startsWith(KEYS.storyPrefix)) {
    return { collection: 'stories', id: key.slice(KEYS.storyPrefix.length) };
  }
  if (key.startsWith(KEYS.chapterPrefix)) {
    return { collection: 'chapters', id: key.slice(KEYS.chapterPrefix.length) };
  }
  return null;
}

export function keyOf(ref: DocRef): string {
  if (ref.collection === 'settings') return KEYS.settings;
  return ref.collection === 'stories' ? KEYS.story(ref.id) : KEYS.chapter(ref.id);
}

/** Everything the server holds, in one shape, for the bootstrap read. */
export interface Snapshot {
  documents: Map<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class DocumentApi {
  private readonly api = inject(ApiClient);

  /** Every document the server holds, keyed the way the client files them. */
  async snapshot(): Promise<Snapshot> {
    const documents = new Map<string, unknown>();
    const lists = await Promise.all(COLLECTIONS.map((collection) => this.list(collection)));
    COLLECTIONS.forEach((collection, index) => {
      for (const document of lists[index] ?? []) {
        // The server files a folder collection's document under the name on
        // disk and answers with that as its `id`, so this is the filename
        // rather than whatever the document claims about itself.
        const id = collection === 'settings' ? KEYS.settings : idOf(document);
        if (id) documents.set(keyOf({ collection, id }), document);
      }
    });
    return { documents };
  }

  list(collection: Collection): Promise<Record<string, unknown>[]> {
    return this.api.json(`${ROUTES.docs}/${collection}`);
  }

  /** What is there now and whether it has moved, without fetching any of it. */
  index(collection: Collection): Promise<IndexEntry[]> {
    return this.api.json(`${ROUTES.docs}/${collection}?index`);
  }

  async get(ref: DocRef): Promise<unknown> {
    const response = await this.api.send(this.urlOf(ref));
    // Not an error: something else deleted it, and that is an answer.
    if (response.status === 404) return null;
    if (!response.ok) throw await failure(response);
    return await response.json();
  }

  /**
   * Writes the document, saying which revision it was based on, and answers
   * with the revision it now has. `''` is "there was nothing here", which is
   * both a fresh document and the honest thing to say when this session has
   * never seen one.
   */
  async put(ref: DocRef, document: unknown, basedOn: string): Promise<string> {
    const response = await this.api.send(this.urlOf(ref), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', [REV_HEADER]: basedOn },
      body: JSON.stringify(document),
    });
    if (response.status === 409) throw await conflictFrom(response);
    if (!response.ok) throw await failure(response);
    return revisionOf(await response.json().catch(() => null));
  }

  /**
   * Unconditional, as it is on the server: deleting is a person saying so, and
   * a story takes chapters with it that nobody has looked at. See the comment
   * on `DocumentStore.remove`.
   */
  async remove(ref: DocRef): Promise<void> {
    const response = await this.api.send(this.urlOf(ref), { method: 'DELETE' });
    // A document that is already gone is the outcome we wanted.
    if (response.status === 404) return;
    if (!response.ok) throw await failure(response);
  }

  /**
   * The last write of a session, sent from `beforeunload`. `keepalive` is what
   * lets it outlive the page; it is fire-and-forget by nature.
   */
  sendBeacon(ref: DocRef, body: string, basedOn: string): void {
    this.beacon(ref, 'PUT', basedOn, body);
  }

  /** The same, for a document the session deleted and then closed the tab on. */
  sendBeaconRemove(ref: DocRef): void {
    this.beacon(ref, 'DELETE');
  }

  /**
   * Not through `ApiClient`: a beacon must outlive the page, which is what
   * `keepalive` is for, and it must not carry an abort signal that the page
   * going away would fire.
   */
  private beacon(ref: DocRef, method: 'PUT' | 'DELETE', basedOn?: string, body?: string): void {
    try {
      void fetch(this.urlOf(ref), {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(basedOn === undefined ? {} : { [REV_HEADER]: basedOn }),
        },
        ...(body === undefined ? {} : { body }),
        keepalive: true,
      }).catch(() => {
        /* the page is leaving; there is nobody left to tell */
      });
    } catch {
      /* nothing left to do at this point in the page's life */
    }
  }

  private urlOf(ref: DocRef): string {
    return `${ROUTES.docs}/${ref.collection}/${encodeURIComponent(ref.id)}`;
  }
}

function idOf(document: Record<string, unknown>): string {
  return typeof document['id'] === 'string' ? document['id'] : '';
}
