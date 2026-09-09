/**
 * Quitting, in the order that does not lose the last thing somebody wrote.
 *
 * The last debounced write leaves the page on `beforeunload`, which closing
 * the window fires; the server is closed after it so that write has somewhere
 * to land. Everything below is about the sockets in between, and none of it
 * needs Electron — which is the point: it is a sequence with a timer in it,
 * and a sequence with a timer in it is worth a test.
 */

/** Long enough for a beacon to land, short enough that Quit means quit. */
export const SHUTDOWN_GRACE = 1500;

/**
 * Closes the second listener and then the app's own, and calls `finish` once —
 * whichever way it got there.
 *
 * A phone still holding a socket open is not a reason for Quit not to quit,
 * so sharing is dropped rather than drained, and its failure is nothing to
 * report to somebody who has already asked to leave.
 *
 * The window's keep-alive sockets outlive the window they belonged to, and a
 * server holding one never finishes closing. Idle ones go at once; anything
 * still in flight — the last beacon — gets its moment and then goes too. That
 * is why `finish` is guarded: `close` and the timer both lead to it, and on a
 * quick quit they lead to it in the same tick.
 *
 * @param {object} what
 * @param {{close(done: () => void): unknown, closeIdleConnections(): unknown,
 *   closeAllConnections(): unknown} | null} what.server
 * @param {{close(): Promise<unknown>} | null} what.sharing
 * @param {() => void} what.finish            called exactly once, when there is nothing left to wait for
 * @param {number} [what.grace]               how long the in-flight request gets
 * @param {typeof setTimeout} [what.after]    the timer, so a test need not wait on one
 */
export function shutDown({ server, sharing, finish, grace = SHUTDOWN_GRACE, after = setTimeout }) {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    finish();
  };

  void sharing?.close().catch(() => {});

  if (!server) return once();
  server.close(once);
  server.closeIdleConnections();
  after(() => {
    server.closeAllConnections();
    once();
  }, grace);
}
