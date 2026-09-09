import { Injectable } from '@angular/core';
import { CONFLICT, ROUTES } from '@wire';

/**
 * Every request this app makes to its own server, with one timeout on it and
 * one reading of what a refusal means.
 *
 * There were four ways of asking. `DocumentApi` had a `request` with a ten
 * second timeout and a `Refused`/`Error` split, and it was private; the three
 * stores that ask about something other than a document each had a `fetch` of
 * their own — five seconds for the build stamp, eight for the update check, and
 * no timeout at all for the sharing switch, which is the one a reader waits on
 * with their finger still on it. The extraction of an error message out of a
 * refusal body was written twice, the second time by copy.
 *
 * One timeout, because the difference between them was never a decision: it is
 * long enough for a document worth having and short enough that a server that
 * has gone away is noticed. Nothing in the app waits on any of these — the
 * build stamp is a line in About, the update check is a pill, the share switch
 * says what happened — so the number is about not hanging, not about latency.
 */
const TIMEOUT = 10_000;

/**
 * The server's considered no, as opposed to its silence.
 *
 * A 4xx is a document this server will never take: a body it cannot parse, an
 * id it will not have, a document past the body limit, a Host it does not
 * answer to. Sending it again changes nothing, so whatever is holding it has
 * to stop and say so rather than retry for ever.
 *
 * `status` is the code the server answered with.
 */
export class Refused extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'Refused';
  }
}

/**
 * The document was written somewhere else between this session reading it and
 * writing it back — the phone, or a second tab.
 *
 * Carries the document as the server actually holds it, because the server
 * sends it with the refusal: reloading is therefore something the client can
 * simply do, rather than a second request that could itself be overtaken.
 * `document` is null when the answer is that there is no document any more,
 * which is what a stale write on top of a delete gets.
 *
 * The sentence is the wire's, not this file's: the server answers with it and
 * the app shows what it was told.
 */
export class Conflict extends Error {
  constructor(
    readonly rev: string,
    readonly document: unknown,
  ) {
    super(CONFLICT);
    this.name = 'Conflict';
  }
}

@Injectable({ providedIn: 'root' })
export class ApiClient {
  /** Same origin: the packaged server serves the app, and `ng serve` proxies. */
  readonly base = ROUTES.api;

  /**
   * One request, with the timeout on it, and no opinion about the answer.
   *
   * For the three places where a status is an answer rather than a failure: a
   * 404 from a read is a document something else deleted, a 404 from a delete
   * is the outcome that was wanted, and a 409 from a write is a conflict with
   * the recovery inside it.
   */
  send(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(path, { ...init, signal: init.signal ?? AbortSignal.timeout(TIMEOUT) });
  }

  /** The same, refusing anything the server did not answer `ok` to. */
  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.send(path, init);
    if (!response.ok) throw await failure(response);
    return response;
  }

  /** ...and its body, which is JSON on every route this app calls. */
  async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    return (await (await this.request(path, init)).json()) as T;
  }
}

/**
 * What went wrong, in the server's own words where it gave any.
 *
 * A 5xx is a server having a bad moment and worth asking again; a 4xx is an
 * answer about the request itself and will be the same answer next time.
 */
export async function failure(response: Response): Promise<Error> {
  const text = (await said(response)) || `${response.status} ${response.statusText}`;
  return response.status < 500 ? new Refused(text, response.status) : new Error(text);
}

/** A 409 and the document it came with, which is the whole of the recovery. */
export async function conflictFrom(response: Response): Promise<Conflict> {
  const body: unknown = await response.json().catch(() => undefined);
  const answer = (body ?? {}) as { rev?: unknown; document?: unknown };
  return new Conflict(typeof answer.rev === 'string' ? answer.rev : '', answer.document ?? null);
}

/** The sentence in a refusal body, or nothing when there was not one. */
async function said(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => undefined);
  return typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'string'
    ? body.error
    : '';
}
