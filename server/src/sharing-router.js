import { Router } from 'express';
import { HttpError } from './errors.js';
import { computerOnly } from './security.js';

/**
 * Sharing: read it, change it, and the picture that pairs a phone with it.
 *
 * All three are the computer's own business and are refused on the shared
 * listener, paired or not. The switch belongs to whoever is sitting at the
 * machine — a phone that could turn sharing off would be a phone that could
 * lock the computer out of its own setting, and a phone that could ask for the
 * QR code would be a phone that could pass the lock on to another one.
 *
 * Mounted at `ROUTES.share`, and only when something owns a second listener:
 * left out — by a test, and by anything that only wants the document API —
 * these routes are simply not there, and the app hides the switch that reads
 * them.
 *
 * @param {{sharing: object}} what
 * @returns {import('express').Router}
 */
export function sharingRouter({ sharing }) {
  const router = Router();
  router.use(computerOnly);

  router.get('/', (request, response) => {
    response.json(sharing.status());
  });

  router.put('/', async (request, response) => {
    const body = request.body ?? {};
    // Rotating first, so "off, and a new code" leaves nothing listening that
    // is still answering to the old one for the moment in between.
    if (body.rotate === true) await sharing.rotate();
    if (typeof body.share === 'boolean') await sharing.set(body.share);
    response.json(sharing.status());
  });

  router.get('/qr', async (request, response) => {
    if (!sharing.on) throw new HttpError(409, 'sharing is off');
    const { addresses } = sharing.status();
    const asked = request.query['address'];
    // Only an address this machine actually has: the token is about to be
    // drawn into a picture, and a query string must not choose whose.
    const address = addresses.includes(asked) ? asked : addresses[0];
    if (!address) throw new HttpError(409, 'no network address to share on');
    const svg = await sharing.qr(address);
    // The pairing URL is the secret, so the picture of it is too: nothing
    // between here and the screen may keep a copy.
    response.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
  });

  return router;
}
