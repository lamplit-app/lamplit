import express, { Router } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The built app, in front of the API, when there is one to serve.
 *
 * @param {{publicDir?: string}} where
 * @returns {import('express').Router}
 */
export function staticApp({ publicDir }) {
  return publicDir && existsSync(join(publicDir, 'index.html'))
    ? servedFrom(publicDir)
    : nothingBuilt();
}

function servedFrom(publicDir) {
  const router = Router();

  // The bundles carry a hash in their names and can be cached for as long as
  // anyone likes; index.html is what names them, so it has to be asked about
  // every time or an upgrade leaves the browser asking for bundles that are no
  // longer there.
  router.use(
    express.static(publicDir, {
      index: 'index.html',
      maxAge: '1h',
      setHeaders: (response, path) => {
        if (path.endsWith('index.html')) response.set('Cache-Control', 'no-cache');
      },
    }),
  );

  // A single page, so a path that is not a file is still the app. Express 5
  // has no `*` route any more; a middleware is the way to say "everything". A
  // path with an extension is a file that is not there, and saying so is worth
  // more than an HTML page where a script was expected.
  router.use((request, response, next) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return next();
    if (/\.[a-z0-9]+$/i.test(request.path)) return next();
    response.set('Cache-Control', 'no-cache');
    response.sendFile(join(publicDir, 'index.html'));
  });

  return router;
}

/** The API on its own: a sentence at the root, so a browser is not confused. */
function nothingBuilt() {
  const router = Router();
  router.get('/', (request, response) => {
    response
      .status(200)
      .type('text/plain')
      .send(
        'Lamplit API is running. The built app is not being served from here.\n' +
          'Run `npm start` in the repository to develop, or `npm run package` to build a copy that is.\n',
      );
  });
  return router;
}
