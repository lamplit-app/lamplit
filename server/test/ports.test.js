import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { after, describe, it } from 'node:test';
import { DEFAULT_PORT, PORT_ATTEMPTS, listenWalking } from '../src/ports.js';

/**
 * The walk past a busy port, which is what keeps a second copy of Lamplit — or
 * an `npm start` left running from this morning — from turning a double-click
 * into a stack trace. Both listeners go through it now, so it is worth one test
 * rather than the none it had while it was written twice.
 *
 * How far the walk goes, and what it says on the way, is asked of a listener
 * that answers the way the operating system would rather than of real sockets,
 * because the ports it would need are not this file's to promise. The rest of
 * the suite runs beside this one and opens loopback listeners of its own on
 * ports of the operating system's choosing — which are the ports just above
 * ours, that being what it hands out next. On the run that had this file
 * rewritten, three of the ten above ours were somebody else's, and one of the
 * three was let go before the walk reached it: a walk that should have run out
 * of tries landed on a port that had been busy a moment earlier. Which ports
 * were asked for, in what order, and what came back was never really about
 * sockets, and that is all the pretend listener below is for.
 *
 * Two real ones stay, because the walk reads a code off an error it did not
 * write: what the operating system puts there when a port is taken, and that
 * `listen` may be called again on a server that has already refused once, are
 * only true if they are true of `node:http`. Neither of them asserts where the
 * walk came down, which is nobody here's to say.
 */

const HOST = '127.0.0.1';

/** Every listener this file opened, closed when it is done with them. */
const opened = new Set();

function keep(server) {
  opened.add(server);
  return server;
}

/** A real listener on a port of the operating system's choosing. */
async function occupy() {
  const server = keep(
    await listenWalking(
      createServer(() => {}),
      0,
      HOST,
    ),
  );
  return server.address().port;
}

/**
 * A listener that answers `listen` with whatever `refused` says about the port
 * it was handed — a code for a port it cannot have, nothing at all for one it
 * can — and remembers every port it was asked for.
 *
 * It answers on a later turn of the loop, as a real one does, because the walk
 * has both of its handlers on before either may fire.
 */
function pretendServer(refused) {
  const server = new EventEmitter();
  server.tried = [];
  server.listen = (port) => {
    server.tried.push(port);
    setImmediate(() => {
      const code = refused[port];
      if (!code) return server.emit('listening');
      const error = new Error(`listen ${code}: ${HOST}:${port}`);
      error.code = code;
      server.emit('error', error);
    });
  };
  return server;
}

/** That many ports from there, every one of them taken. */
const allBusy = (from, count) =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [from + i, 'EADDRINUSE']));

/**
 * Whatever the walk said out loud while `work` ran. It warns on every port it
 * steps over, because a server that moved quietly would leave the reader
 * typing the number they were given yesterday.
 *
 * `work` is handed the log to pass in. It used to be read off `console.warn`,
 * patched for the duration — which worked, and told every other test in the
 * suite nothing about where the walk actually says things.
 */
async function saidWhile(work) {
  const said = [];
  await work((line) => said.push(line));
  return said;
}

// Each of them holds the event loop open, and a test run that does not end is
// worse than one that fails.
after(() => Promise.all([...opened].map((server) => new Promise((done) => server.close(done)))));

describe('listenWalking', () => {
  it('takes the port it asked for when nothing else has it', async () => {
    const server = keep(
      await listenWalking(
        createServer(() => {}),
        0,
        HOST,
      ),
    );
    assert.equal(server.listening, true);
    assert.ok(server.address().port > 0);
  });

  it('takes the next one up when the wanted port is in use, and says so', async () => {
    const server = pretendServer(allBusy(DEFAULT_PORT, 1));
    const said = await saidWhile((log) => listenWalking(server, DEFAULT_PORT, HOST, log));
    assert.deepEqual(server.tried, [DEFAULT_PORT, DEFAULT_PORT + 1]);
    assert.deepEqual(said, [`port ${DEFAULT_PORT} is busy, trying ${DEFAULT_PORT + 1}`]);
  });

  it('keeps walking, and lands on the first port nobody has', async () => {
    const server = pretendServer(allBusy(DEFAULT_PORT, 3));
    const said = await saidWhile((log) => listenWalking(server, DEFAULT_PORT, HOST, log));
    assert.deepEqual(server.tried, [
      DEFAULT_PORT,
      DEFAULT_PORT + 1,
      DEFAULT_PORT + 2,
      DEFAULT_PORT + 3,
    ]);
    assert.equal(said.length, 3);
    // Three hops on one server object, and nothing of the walk's left on it. A
    // walk that registered a pair of handlers per hop and removed neither would
    // leave several of each here, and a stale 'error' one would still be in
    // place to catch a later fault.
    assert.equal(server.listenerCount('error'), 0);
    assert.equal(server.listenerCount('listening'), 0);
  });

  it('gives up after a fixed number of tries rather than climbing for ever', async () => {
    // Exactly as many ports as it will try: the one it starts on, and the
    // PORT_ATTEMPTS above it, with nothing free anywhere in the range.
    const range = allBusy(DEFAULT_PORT, PORT_ATTEMPTS + 1);
    const server = pretendServer(range);
    const said = await saidWhile((log) =>
      assert.rejects(listenWalking(server, DEFAULT_PORT, HOST, log), { code: 'EADDRINUSE' }),
    );
    assert.deepEqual(server.tried, Object.keys(range).map(Number));
    // It says something about every port it steps over and nothing about the
    // last one, which it gives up on rather than steps over.
    assert.equal(said.length, PORT_ATTEMPTS);
    assert.equal(server.listenerCount('error'), 0);
    assert.equal(server.listenerCount('listening'), 0);
  });

  it('reports anything that is not a busy port rather than walking on', async () => {
    // The walk is for EADDRINUSE alone; every other fault is the caller's to
    // hear about, at once, unchanged, and on the port it happened to.
    const server = pretendServer({ [DEFAULT_PORT]: 'EACCES' });
    const said = await saidWhile((log) =>
      assert.rejects(listenWalking(server, DEFAULT_PORT, HOST, log), { code: 'EACCES' }),
    );
    assert.deepEqual(server.tried, [DEFAULT_PORT]);
    assert.deepEqual(said, []);
  });

  it('reports a port the operating system will not even consider', async () => {
    // A real listener, and a fault that is not a busy port: `listen` refuses -1
    // where it stands, before there is an error event to read a code off.
    const said = await saidWhile((log) =>
      assert.rejects(
        listenWalking(
          createServer(() => {}),
          -1,
          HOST,
          log,
        ),
      ),
    );
    assert.deepEqual(said, []);
  });

  it('steps over a port that is really in use, and says which', async () => {
    // The one walk over real sockets: a port this file holds for the length of
    // the test, an EADDRINUSE the operating system wrote itself, and a second
    // `listen` on the very server that has just heard one.
    const taken = await occupy();
    let walked;
    const said = await saidWhile(async (log) => {
      walked = keep(
        await listenWalking(
          createServer(() => {}),
          taken,
          HOST,
          log,
        ),
      );
    });
    assert.ok(walked.address().port > taken);
    assert.equal(said[0], `port ${taken} is busy, trying ${taken + 1}`);
  });

  it('is the one place the port a reader may type is written down', () => {
    assert.equal(DEFAULT_PORT, 4177);
  });
});
