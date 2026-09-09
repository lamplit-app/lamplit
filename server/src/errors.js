import { SERVER_ERROR } from '../../wire/contract.mjs';
import { defaultLog } from './log.js';

/**
 * A refusal with a status on it, thrown where it is decided and answered in
 * one place.
 *
 * Response shaping used to be scattered: a `notFound()` helper, seven inline
 * `.status(...).json(...)` calls, and one `Object.assign(new Error(), {status})`
 * — which is this class written out at the one site that could not reach a
 * helper. Two of those sites said "body must be a JSON document" in slightly
 * different words. A handler that throws says what is wrong and stops; what a
 * refusal looks like on the wire is then a property of the API rather than of
 * whoever is refusing.
 *
 * Express 5 forwards a rejected promise to the error middleware by itself, so
 * throwing works from an `async` handler with no `try`/`catch` around it. The
 * seven wrappers that used to do that by hand are gone.
 *
 * `extra` is merged into the body, for the one refusal that carries more than
 * a sentence: a 409 comes with the document as it actually stands.
 */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message a sentence for a reader, not a code
   * @param {Record<string, unknown>} [extra]
   */
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.extra = extra;
  }
}

/**
 * The one middleware that answers a thrown refusal.
 *
 * Two rules, and the line between them is who wrote the message.
 *
 * A `HttpError` carries a sentence somebody meant a reader to see, whatever
 * its status: `sharing is off`, `no free port to share on`. Anything else that
 * reaches here is this server having gone wrong, and its message is not ours
 * to publish — an `EACCES` from the data folder names a path on the
 * filesystem, and a paired phone on the network is not the right audience for
 * one. That is said out loud as `server error` and written to the log in full.
 *
 * A 4xx from something that is not ours is still worth passing on: it is
 * Express refusing the request rather than failing at it, and `request entity
 * too large` is the answer the reader needs.
 *
 * @param {{log?: import('./log.js').Log}} [said] where a 5xx is written down
 * @returns {import('express').ErrorRequestHandler}
 */
export function answerErrors({ log = defaultLog } = {}) {
  return (error, request, response, next) => {
    if (response.headersSent) return next(error);
    const status = Number(error.status ?? error.statusCode ?? 500);
    const ours = error instanceof HttpError;
    if (status >= 500) log(`server error: ${error.stack ?? error.message}`);
    const said = status < 500 || ours ? error.message : '';
    response.status(status).json({
      ok: false,
      error: said || SERVER_ERROR,
      ...(ours ? error.extra : {}),
    });
  };
}
