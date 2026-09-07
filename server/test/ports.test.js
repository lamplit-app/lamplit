import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, describe, it } from 'node:test';
import { DEFAULT_PORT, PORT_ATTEMPTS, listenWalking } from '../src/ports.js';

/**
 * The walk past a busy port, which is what keeps a second copy of Lamplit — or
 * an `npm start` left running from this morning — from turning a double-click
 * into a stack trace. Both listeners go through it now, so it is worth one test
 * rather than the none it had while it was written twice.
 *
 * Everything here binds the loopback: a test that bound every interface would
 * raise the Windows firewall prompt on `npm test`.
 */

const HOST = '127.0.0.1';

/** Every listener this file opened, closed when it is done with them. */
const opened = new Set();

function keep(server) {
  opened.add(server);
  return server;
}

/** A listener on a port of the operating system's choosing. */
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
 * Holds one exact port — or leaves it to whoever on this machine already holds
 * it, which is a port the walk cannot land on either. Both outcomes are the
 * arrangement these tests are after, so a refusal here is not a failure.
 */
async function hold(port) {
  const server = createServer(() => {});
  await new Promise((fulfil, reject) => {
    server.once('listening', fulfil);
    server.once('error', reject);
    server.listen(port, HOST);
  }).then(
    () => keep(server),
    () => {},
  );
}

/**
 * Whatever the walk said out loud while `work` ran. It warns on every port it
 * steps over, because a server that moved quietly would leave the reader
 * typing the number they were given yesterday.
 */
async function saidWhile(work) {
  const said = [];
  const warn = console.warn;
  console.warn = (line) => said.push(line);
  try {
    await work();
  } finally {
    console.warn = warn;
  }
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
    const taken = await occupy();
    let server;
    const said = await saidWhile(async () => {
      server = keep(
        await listenWalking(
          createServer(() => {}),
          taken,
          HOST,
        ),
      );
    });
    assert.equal(server.address().port, taken + 1);
    assert.deepEqual(said, [`port ${taken} is busy, trying ${taken + 1}`]);
  });

  it('keeps walking, and lands on the first port nobody has', async () => {
    const first = await occupy();
    await hold(first + 1);
    await hold(first + 2);
    let server;
    const said = await saidWhile(async () => {
      server = keep(
        await listenWalking(
          createServer(() => {}),
          first,
          HOST,
        ),
      );
    });
    assert.equal(server.address().port, first + 3);
    assert.equal(said.length, 3);
    // Three hops on one server object. A walk that registered a pair of
    // handlers per hop and removed neither would leave several of them here,
    // and a stale 'error' one would still be in place to catch a later fault.
    assert.equal(server.listenerCount('error'), 0);
    // One is Node's own, from inside its `listen`; what matters is that the
    // walk added nothing to it on the way past three busy ports.
    assert.ok(server.listenerCount('listening') <= 1);
  });

  it('gives up after a fixed number of tries rather than climbing for ever', async () => {
    // Exactly as many ports as it will try: the one it starts on, and the
    // PORT_ATTEMPTS above it.
    const first = await occupy();
    for (let i = 1; i <= PORT_ATTEMPTS; i++) await hold(first + i);
    const walk = listenWalking(
      createServer(() => {}),
      first,
      HOST,
    );
    await saidWhile(() => assert.rejects(walk, { code: 'EADDRINUSE' }));
  });

  it('reports anything that is not a busy port rather than walking on', async () => {
    // The walk is for EADDRINUSE alone; every other fault is the caller's to
    // hear about, at once and unchanged.
    await assert.rejects(
      listenWalking(
        createServer(() => {}),
        -1,
        HOST,
      ),
    );
  });

  it('is the one place the port a reader may type is written down', () => {
    assert.equal(DEFAULT_PORT, 4177);
  });
});
