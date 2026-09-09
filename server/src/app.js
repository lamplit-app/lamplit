import express from 'express';
import { ROUTES } from '../../wire/contract.mjs';
import { documentsRouter } from './documents-router.js';
import { HttpError, answerErrors } from './errors.js';
import { defaultLog } from './log.js';
import { contentSecurityPolicy, corsFor, jsonBody, sameMachineOnly } from './security.js';
import { sharingRouter } from './sharing-router.js';
import { staticApp } from './static-app.js';
import { statusRouter } from './status-router.js';
import { DocumentStore } from './store.js';
import { createUpdateChecker } from './updates.js';

/**
 * The whole API, and the built app in front of it.
 *
 * Nothing but the order things go in. Every rule the requests pass through is
 * in `security.js`, every route is in one of the three routers, the page is in
 * `static-app.js` and the refusals are in `errors.js` — so a change to caching,
 * to pairing or to the document API lands in the file that is about it, and
 * each of those files can be asked what it does without a socket. This one is
 * only ever wrong about the order, which is the one thing it is for.
 *
 * @param {object} options
 * @param {string} [options.dataDir]     the documents, when the store is left to us
 * @param {string} [options.publicDir]   the built app, or somewhere it is not
 * @param {object} [options.build]       the stamp this copy was built with
 * @param {string | null} [options.previousVersion]
 * @param {object} [options.updates]     the update checker the API serves
 * @param {string[]} [options.hosts]     names the API answers to besides the machine's own
 * @param {boolean} [options.devCors]    whether another page on this machine may call the API
 * @param {object} [options.sharing]     the second listener and the lock on it, when something owns one
 * @param {import('./log.js').Log} [options.log]
 * @param {object} [options.store]       the documents; the one collaborator a test may replace
 * @returns {import('express').Express}
 */
export function createApp({
  dataDir,
  publicDir,
  build = {},
  previousVersion = null,
  updates = createUpdateChecker({ version: build.version ?? '0.0.0', enabled: false }),
  hosts = [],
  devCors = false,
  sharing = null,
  log = defaultLog,
  // Made here only when nobody else has one, which is a test and a command
  // line. `bootstrap` owns the store it starts, opens it before it listens,
  // and hands it in — the two-phase `init()` every caller used to reach
  // through `app.locals` for is the owner's business now, and a test that
  // wants to know what a failing read does can pass something that fails.
  store = new DocumentStore(dataDir, { log }),
}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(contentSecurityPolicy());
  app.use(corsFor(devCors));
  app.use(ROUTES.api, sameMachineOnly(hosts), jsonBody());

  app.use(ROUTES.api, statusRouter({ build, previousVersion, updates, dataDir: store.dataDir }));
  app.use(ROUTES.docs, documentsRouter({ store }));
  if (sharing) app.use(ROUTES.share, sharingRouter({ sharing }));
  app.use(ROUTES.api, () => {
    throw new HttpError(404, 'no such endpoint');
  });

  app.use(staticApp({ publicDir }));
  app.use(answerErrors({ log }));
  return app;
}
