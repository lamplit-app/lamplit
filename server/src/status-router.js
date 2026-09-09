import { Router } from 'express';
import { ROUTES } from '../../wire/contract.mjs';
import { sameOrigin } from './security.js';

/**
 * Who is answering, which build of it, and whether there is a newer one.
 *
 * Two routes, one shape between them: everything the client needs in order to
 * say something true about the copy it is talking to. Neither reads a document
 * and neither writes anything, which is why they are here and not beside the
 * document API.
 *
 * @param {object} what
 * @param {object} what.build            the stamp this copy was built with
 * @param {string | null} what.previousVersion the version that ran here last
 * @param {object} what.updates          the update checker, asked on request only
 * @param {string} what.dataDir          where the writing is kept
 * @returns {import('express').Router}
 */
export function statusRouter({ build = {}, previousVersion = null, updates, dataDir }) {
  const router = Router();

  /**
   * The client reads this for the About sheet and for the notice it shows
   * after an upgrade, so every field the build was stamped with is here rather
   * than in a second endpoint.
   */
  router.get(routeUnder(ROUTES.health), (request, response) => {
    /** @type {import('../../wire/contract.mjs').Health} */
    const health = {
      ok: true,
      name: 'lamplit',
      version: build.version ?? '0.0.0',
      commit: build.commit ?? '',
      builtAt: build.builtAt ?? '',
      build: build.build ?? 'local',
      channel: build.channel ?? 'dev',
      previousVersion,
      // Where the writing is kept — a path that on Windows carries the account
      // name — so About can show it under developer mode. To the app itself
      // and to a command line, not to another page that happened to ask, and
      // not to a phone: the folder is on the computer and is no use over there.
      ...(sameOrigin(request) && !request.lamplitShared ? { dataDir } : {}),
    };
    response.json(health);
  });

  /**
   * Whether a newer Lamplit has been published. Nothing asks GitHub until this
   * is called, and it is called only by an app whose reader left the check on —
   * so switching it off in Preferences means the request does not happen,
   * rather than happening and being ignored.
   */
  router.get(routeUnder(ROUTES.updates), async (request, response) => {
    response.json(await updates.check());
  });

  return router;
}

/**
 * A path from the contract, as a path inside a router mounted at `/api`. The
 * contract spells the whole URL because that is what the client asks for; two
 * of them are answered here, and neither may be spelt a second time.
 */
function routeUnder(route) {
  return route.slice(ROUTES.api.length);
}
