import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { saySoAndStop } from '../../electron/fatal.mjs';

/**
 * How the shell says it could not start.
 *
 * The case that matters is the one nobody can watch happen: an installed copy,
 * double-clicked, that fails before there is a page. A launcher that appears
 * to do nothing is the worst way to report that, and there is no console for
 * it to have written to.
 */

function pretendDialog() {
  const shown = [];
  return {
    shown,
    showMessageBoxSync: (window, options) => {
      shown.push({ kind: 'box', window, options });
      return 0;
    },
    showErrorBox: (title, detail) => shown.push({ kind: 'error', title, detail }),
  };
}

const aWindow = { isDestroyed: () => false };

describe('when the shell cannot start', () => {
  it('writes the stack where a repository copy’s console will show it', () => {
    const said = [];
    const dialog = pretendDialog();
    const error = new Error('a port that will not open');
    saySoAndStop({
      error,
      isPackaged: false,
      dialog,
      exit: () => {},
      log: (message) => said.push(message),
    });
    assert.equal(said.length, 1);
    assert.match(said[0], /Lamplit could not start: /);
    assert.match(said[0], /a port that will not open/);
    // And no box, because the console is exactly where somebody is looking.
    assert.deepEqual(dialog.shown, []);
  });

  it('shows a box a packaged copy’s reader can actually see', () => {
    const dialog = pretendDialog();
    saySoAndStop({
      error: new Error('no built app at C:\\x'),
      isPackaged: true,
      dialog,
      exit: () => {},
      window: aWindow,
      log: () => {},
    });
    assert.equal(dialog.shown.length, 1);
    assert.equal(dialog.shown[0].kind, 'box');
    // Parented to the window, which — since the window now opens before
    // anything that can fail — there almost always is. A box with no parent
    // can end up behind the very window it is about.
    assert.equal(dialog.shown[0].window, aWindow);
    assert.equal(dialog.shown[0].options.detail, 'no built app at C:\\x');
  });

  it('falls back to a parentless box when the window is gone', () => {
    for (const window of [null, { isDestroyed: () => true }]) {
      const dialog = pretendDialog();
      saySoAndStop({
        error: new Error('gone'),
        isPackaged: true,
        dialog,
        exit: () => {},
        window,
        log: () => {},
      });
      assert.equal(dialog.shown[0].kind, 'error');
      assert.equal(dialog.shown[0].detail, 'gone');
    }
  });

  it('stops with a code that says it failed, whichever way it said so', () => {
    const codes = [];
    for (const isPackaged of [true, false]) {
      saySoAndStop({
        error: new Error('x'),
        isPackaged,
        dialog: pretendDialog(),
        exit: (code) => codes.push(code),
        log: () => {},
      });
    }
    assert.deepEqual(codes, [1, 1]);
  });

  it('says something about a rejection that was not an Error at all', () => {
    // `whenReady().catch` catches whatever was thrown, and a string has no
    // `.stack` and no `.message` to read.
    const said = [];
    const dialog = pretendDialog();
    saySoAndStop({
      error: 'the profile could not be written',
      isPackaged: true,
      dialog,
      exit: () => {},
      log: (message) => said.push(message),
    });
    assert.match(said[0], /the profile could not be written/);
    assert.equal(dialog.shown[0].detail, 'the profile could not be written');
  });
});
