import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { profilePaths } from '../../electron/profile.mjs';

/**
 * Where the desktop shell keeps what somebody has written.
 *
 * Four statements at the top of `main.mjs` until now, running on import, so
 * the only thing that had ever checked them was the desktop spec starting a
 * whole Electron. The portable case in particular — a stick, where the whole
 * point is that the stories travel with the .exe — was a line nothing could
 * ask a question of.
 */

/** What Electron answers on a Windows machine with nothing overriding it. */
const USER_DATA = 'C:\\Users\\Someone\\AppData\\Roaming\\Lamplit';

describe('where the profile is', () => {
  it('is Electron’s own answer when nothing says otherwise', () => {
    const paths = profilePaths({ env: {}, userData: USER_DATA });
    assert.equal(paths.userData, USER_DATA);
    // Null, so the caller has one thing to look at rather than two paths to
    // compare — and `setPath` is not called for a move that is not one.
    assert.equal(paths.moved, null);
  });

  it('moves to the stick for the portable build, which is the point of it', () => {
    const stick = 'E:\\Lamplit';
    const paths = profilePaths({ env: { PORTABLE_EXECUTABLE_DIR: stick }, userData: USER_DATA });
    assert.equal(paths.moved, resolve(stick));
    assert.equal(paths.dataDir, join(resolve(stick), 'data'));
    assert.equal(paths.backupsDir, join(resolve(stick), 'backups'));
  });

  it('takes LAMPLIT_USER_DATA over the portable folder, so a spec can pick', () => {
    // The desktop spec sets this to get a first run every time; a portable
    // .exe run under it is that spec running from a stick.
    const paths = profilePaths({
      env: { LAMPLIT_USER_DATA: '/tmp/run-42', PORTABLE_EXECUTABLE_DIR: 'E:\\Lamplit' },
      userData: USER_DATA,
    });
    assert.equal(paths.moved, resolve('/tmp/run-42'));
  });

  it('resolves what it was given, because an environment can hold anything', () => {
    const paths = profilePaths({ env: { LAMPLIT_USER_DATA: 'profile' }, userData: USER_DATA });
    assert.equal(paths.moved, resolve('profile'));
    assert.ok(paths.dataDir.startsWith(resolve('profile')));
  });

  it('says nothing moved when the environment names the folder it is already in', () => {
    const paths = profilePaths({ env: { LAMPLIT_USER_DATA: USER_DATA }, userData: USER_DATA });
    assert.equal(paths.moved, null);
    assert.equal(paths.userData, USER_DATA);
  });

  it('keeps Chromium’s caches inside the profile but out of the way', () => {
    // Fifteen folders of them, next to the two that hold the writing. On a
    // stick that is churn on the stick; anywhere it is a profile nobody can
    // read at a glance. Inside, so a portable copy is still self-contained.
    const paths = profilePaths({ env: {}, userData: USER_DATA });
    assert.equal(paths.sessionData, join(USER_DATA, 'browser'));
    assert.notEqual(paths.sessionData, paths.dataDir);
  });

  it('puts the four things it names where docs/desktop.md says they are', () => {
    const paths = profilePaths({ env: {}, userData: USER_DATA });
    assert.equal(paths.dataDir, join(USER_DATA, 'data'));
    assert.equal(paths.backupsDir, join(USER_DATA, 'backups'));
    assert.equal(paths.windowState, join(USER_DATA, 'window.json'));
  });
});
