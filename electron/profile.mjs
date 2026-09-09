import { join, resolve } from 'node:path';

/**
 * Where everything this person has written lives, worked out from nothing but
 * an environment and Electron's own answer.
 *
 * The installer's answer is the profile, which is the only user-visible
 * difference from the zip and is what *docs/desktop.md* documents. Two things
 * move it:
 *
 * - `PORTABLE_EXECUTABLE_DIR`, set by electron-builder's portable build, which
 *   puts `data/` beside the .exe exactly as the zip does — the point of a
 *   portable build being that the stick holds the stories too.
 * - `LAMPLIT_USER_DATA`, which is how the desktop spec gets a first run every
 *   time, and how anyone else can keep a profile somewhere of their choosing.
 *
 * Moving `userData` moves Chromium's own caches with it — fifteen folders of
 * them, next to the two that hold the writing. On a stick that is churn on the
 * stick; anywhere it is a profile nobody can read at a glance. They go into a
 * folder of their own, still inside the profile, so a portable copy is still
 * self-contained.
 *
 * A function of two values, in a file that imports nothing but `path`, because
 * this is the decision the desktop spec exists to check and it used to be four
 * statements at the top of `main.mjs` that ran on import.
 *
 * @param {object} where
 * @param {Record<string, string | undefined>} [where.env] the process environment
 * @param {string} where.userData Electron's own `app.getPath('userData')`
 * @returns {{userData: string, moved: string | null, sessionData: string,
 *   dataDir: string, backupsDir: string, windowState: string}}
 */
export function profilePaths({ env = {}, userData }) {
  const asked = env['LAMPLIT_USER_DATA'] ?? env['PORTABLE_EXECUTABLE_DIR'] ?? userData;
  // Null when nothing moved it, so the caller has one thing to test rather
  // than two paths to compare — and `setPath` is not called for a no-op.
  const moved = asked === userData ? null : resolve(asked);
  const root = moved ?? userData;
  return {
    userData: root,
    moved,
    sessionData: join(root, 'browser'),
    dataDir: join(root, 'data'),
    backupsDir: join(root, 'backups'),
    windowState: join(root, 'window.json'),
  };
}
