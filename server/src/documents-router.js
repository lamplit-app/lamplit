import { Router } from 'express';
import { CONFLICT, REV_HEADER } from '../../wire/contract.mjs';
import { HttpError } from './errors.js';
import { NOT_A_DOCUMENT } from './security.js';
import { isCollection, isId } from './store.js';

/**
 * The document API: list, read, write, delete, and nothing else.
 *
 * Deliberately tiny: the client owns the document shapes, the server owns
 * nothing but the bytes. Anything the server understood about a story would be
 * a second place to change when the shape of a story changes.
 *
 * The store is handed in rather than reached for. It is the one collaborator
 * here that touches a disk, so a test that wants to know what this router does
 * with a read that throws can pass something that throws, and does not need a
 * temporary folder to find out.
 *
 * @param {{store: object}} what
 * @returns {import('express').Router}
 */
export function documentsRouter({ store }) {
  const router = Router();

  router.get('/:collection', async (request, response) => {
    const { collection } = request.params;
    if (!isCollection(collection)) throw new HttpError(404, 'unknown collection');
    const light = request.query['index'] !== undefined;
    response.json(light ? await store.index(collection) : await store.list(collection));
  });

  router.get('/:collection/:id', async (request, response) => {
    const { collection, id } = named(request);
    const document = await store.read(collection, id);
    if (document === null) throw new HttpError(404, NOT_FOUND);
    response.json(document);
  });

  router.put('/:collection/:id', async (request, response) => {
    const { collection, id } = named(request);
    if (!isDocument(request.body)) throw new HttpError(400, NOT_A_DOCUMENT);
    // The URL says where this document goes and the body may not disagree.
    // Without this, `PUT stories/A` carrying `{id: 'B'}` wrote a document to
    // `A.json` that every listing then called B — read as B, written back to
    // `B.json`, and `A.json` left behind to be listed again at every start.
    // Absent is allowed: the settings document has no id of its own.
    if (request.body.id !== undefined && request.body.id !== id) {
      throw new HttpError(400, 'the document’s id is not the one in the URL');
    }
    const result = await store.write(collection, id, request.body, revOf(request));
    // Not an error the client did anything wrong to deserve: the document
    // moved on somewhere else. It comes back with the refusal, so reloading
    // it is not a second request.
    if (result.conflict) {
      throw new HttpError(409, CONFLICT, { rev: result.rev, document: result.document });
    }
    response.json(result);
  });

  router.delete('/:collection/:id', async (request, response) => {
    const { collection, id } = named(request);
    response.json(await store.remove(collection, id));
  });

  return router;
}

/**
 * The collection and id in the path, refused if either is not one this server
 * will have. Three routes ask the same question and used to answer it in the
 * same two lines each; a 404 rather than a 400 on purpose — an id this server
 * will not have names nothing that exists.
 */
function named(request) {
  const { collection, id } = request.params;
  if (!isCollection(collection) || !isId(collection, id)) throw new HttpError(404, NOT_FOUND);
  return { collection, id };
}

/** What the client says it read. The empty string is a document it is creating. */
function revOf(request) {
  const raw = request.get(REV_HEADER);
  return raw === undefined ? undefined : String(raw);
}

/** One JSON object: not a string, not a number, not a list, not nothing. */
function isDocument(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body);
}

const NOT_FOUND = 'not found';
