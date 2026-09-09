import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  DEFAULT_WINDOW,
  MINIMUM_WINDOW,
  readWindowState,
  rememberWindow,
  windowStateFrom,
  windowStateOf,
} from '../../electron/window-state.mjs';

/**
 * The window's size and place, remembered between runs.
 *
 * The file is on somebody's disk and may say anything — a width of 0 from a
 * run that closed while minimised, a null from a hand edit, an x of 1.5 — and
 * every one of those has to end in a window somebody can see. None of it was
 * reachable from a test while it lived inside `main.mjs`.
 */

/** A window that answers the four questions this module asks one. */
function pretendWindow({
  size = [1000, 700],
  place = [40, 60],
  minimized = false,
  maximized = false,
} = {}) {
  return {
    isMinimized: () => minimized,
    isMaximized: () => maximized,
    getSize: () => size,
    getPosition: () => place,
  };
}

describe('reading a saved window state', () => {
  it('takes a plain size and place as they stand', () => {
    assert.deepEqual(windowStateFrom({ width: 1000, height: 700, x: 40, y: 60 }), {
      width: 1000,
      height: 700,
      x: 40,
      y: 60,
    });
  });

  it('raises a size below the minimum rather than refusing it', () => {
    // A window that opens too small is still a window; one that does not open
    // is not. Both halves are raised independently.
    assert.deepEqual(windowStateFrom({ width: 100, height: 100 }), MINIMUM_WINDOW);
    assert.equal(windowStateFrom({ width: 2000, height: 100 }).height, MINIMUM_WINDOW.height);
  });

  it('falls back to the default for a size that is not a number', () => {
    for (const saved of [{}, { width: 0, height: 0 }, { width: null }, { width: 'wide' }]) {
      const state = windowStateFrom(saved);
      assert.equal(state.width, DEFAULT_WINDOW.width);
      assert.equal(state.height, DEFAULT_WINDOW.height);
    }
  });

  it('drops a place that is not two whole numbers, which lets Electron centre it', () => {
    assert.deepEqual(windowStateFrom({ width: 1000, height: 700, x: 1.5, y: 60 }), {
      width: 1000,
      height: 700,
    });
    assert.deepEqual(windowStateFrom({ width: 1000, height: 700, x: 40 }), {
      width: 1000,
      height: 700,
    });
    // Zero is a place: the top-left corner of the first screen.
    assert.deepEqual(windowStateFrom({ width: 1000, height: 700, x: 0, y: 0 }), {
      width: 1000,
      height: 700,
      x: 0,
      y: 0,
    });
  });

  it('is the default for anything that is not an object at all', () => {
    for (const saved of [null, 42, 'wide', [1180, 820]]) {
      assert.equal(windowStateFrom(saved).width > 0, true);
    }
    assert.deepEqual(windowStateFrom(null), DEFAULT_WINDOW);
  });

  it('is the default when there is no file, which is every first run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lamplit-window-'));
    assert.deepEqual(await readWindowState(join(dir, 'window.json')), DEFAULT_WINDOW);
  });

  it('is the default when the file is not JSON, and says nothing about it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lamplit-window-'));
    const path = join(dir, 'window.json');
    await writeFile(path, '{ half a file', 'utf8');
    assert.deepEqual(await readWindowState(path), DEFAULT_WINDOW);
  });

  it('reads back what was written down', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lamplit-window-'));
    const path = join(dir, 'window.json');
    await rememberWindow(path, pretendWindow({ size: [1400, 900], place: [10, 20] }));
    assert.deepEqual(await readWindowState(path), { width: 1400, height: 900, x: 10, y: 20 });
  });
});

describe('what to write down about a window', () => {
  it('is its size and its place', () => {
    assert.deepEqual(windowStateOf(pretendWindow({ size: [1400, 900], place: [10, 20] })), {
      width: 1400,
      height: 900,
      x: 10,
      y: 20,
    });
  });

  it('is nothing at all for a minimised one', () => {
    // A minimised window is 160×28 in a corner, and writing that down is how
    // somebody gets a postage stamp the next time they open the app.
    assert.equal(windowStateOf(pretendWindow({ minimized: true })), null);
  });

  it('is the size but not the place for a maximised one', () => {
    // The size is what it goes back to when it is un-maximised; the place is
    // the corner of whichever screen it filled, which is not a place to open at.
    assert.deepEqual(windowStateOf(pretendWindow({ maximized: true, size: [2560, 1400] })), {
      width: 2560,
      height: 1400,
    });
  });

  it('writes nothing for no window, and nothing for a minimised one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lamplit-window-'));
    const path = join(dir, 'window.json');
    await rememberWindow(path, null);
    await rememberWindow(path, pretendWindow({ minimized: true }));
    await assert.rejects(readFile(path, 'utf8'), { code: 'ENOENT' });
  });

  it('does not hold up a quit for a profile it cannot write', async () => {
    // A folder that is not there is a path that cannot be written, and the
    // window is closing either way.
    await rememberWindow(join(tmpdir(), 'lamplit-nowhere-x', 'window.json'), pretendWindow());
  });
});
