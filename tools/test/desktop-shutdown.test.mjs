import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SHUTDOWN_GRACE, shutDown } from '../../electron/shutdown.mjs';

/**
 * Quitting.
 *
 * A sequence with a timer in it, and the one thing in the shell where getting
 * the order wrong loses what somebody wrote. It lived inside a `will-quit`
 * handler, so the only way to exercise it was to quit a window; the timer is
 * handed in here, and every branch is a call.
 */

/** A server that records what was asked of it and holds its close callback. */
function pretendServer() {
  const it = {
    calls: [],
    /** @type {(() => void) | null} */
    finished: null,
    close(done) {
      it.calls.push('close');
      it.finished = done;
    },
    closeIdleConnections() {
      it.calls.push('idle');
    },
    closeAllConnections() {
      it.calls.push('all');
    },
  };
  return it;
}

/** A timer nobody waits on: the callback is kept for the test to fire. */
function heldTimer() {
  const fired = [];
  const after = (work, delay) => {
    fired.push({ work, delay });
    return 0;
  };
  return { after, fired };
}

describe('shutting down', () => {
  it('closes the server and finishes when it says it is closed', () => {
    const server = pretendServer();
    const { after, fired } = heldTimer();
    let finished = 0;
    shutDown({ server, sharing: null, finish: () => (finished += 1), after });

    // Idle sockets go at once: the window's keep-alive connections outlive the
    // window, and a server holding one never finishes closing.
    assert.deepEqual(server.calls, ['close', 'idle']);
    assert.equal(finished, 0);
    server.finished();
    assert.equal(finished, 1);
    assert.equal(fired.length, 1);
  });

  it('drops what is still in flight after the grace, and finishes anyway', () => {
    const server = pretendServer();
    const { after, fired } = heldTimer();
    let finished = 0;
    shutDown({ server, sharing: null, finish: () => (finished += 1), after });

    assert.equal(fired[0].delay, SHUTDOWN_GRACE);
    fired[0].work();
    assert.deepEqual(server.calls, ['close', 'idle', 'all']);
    assert.equal(finished, 1);
  });

  it('finishes exactly once, however many ways it got there', () => {
    // The close callback and the timer both lead here, and on a quick quit
    // they lead here in the same tick. Twice would be `app.exit` twice.
    const server = pretendServer();
    const { after, fired } = heldTimer();
    let finished = 0;
    shutDown({ server, sharing: null, finish: () => (finished += 1), after });
    server.finished();
    fired[0].work();
    server.finished();
    assert.equal(finished, 1);
  });

  it('drops the shared listener rather than waiting on it', async () => {
    // A phone still holding a socket open is not a reason for Quit not to
    // quit, and the server's close is not made to wait for it either.
    const server = pretendServer();
    let closed = 0;
    const sharing = {
      close: () => {
        closed += 1;
        return new Promise(() => {});
      },
    };
    shutDown({ server, sharing, finish: () => {}, after: () => 0 });
    assert.equal(closed, 1);
    assert.deepEqual(server.calls, ['close', 'idle']);
  });

  it('is not stopped by a shared listener that fails to close', async () => {
    const server = pretendServer();
    let finished = 0;
    const sharing = { close: () => Promise.reject(new Error('the socket is wedged')) };
    shutDown({ server, sharing, finish: () => (finished += 1), after: () => 0 });
    server.finished();
    assert.equal(finished, 1);
    // And the rejection is answered, so nothing is left unhandled behind it.
    await new Promise((fulfil) => setImmediate(fulfil));
  });

  it('finishes at once when there was never a server', () => {
    // The window failed before `bootstrap` returned, and there is nothing to
    // be graceful about. This used to be an early return in the handler.
    let finished = 0;
    const { fired } = heldTimer();
    shutDown({ server: null, sharing: null, finish: () => (finished += 1), after: () => 0 });
    assert.equal(finished, 1);
    assert.equal(fired.length, 0);
  });

  it('is long enough for a beacon and short enough that Quit means quit', () => {
    assert.equal(SHUTDOWN_GRACE, 1500);
  });
});
