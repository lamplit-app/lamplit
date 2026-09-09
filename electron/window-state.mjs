import { readFile, writeFile } from 'node:fs/promises';

/**
 * The window's size and place, remembered between runs.
 *
 * Nothing in here touches Electron. Reading is a file and a few numbers;
 * writing asks a window for four of them through the same four methods a fake
 * can have. That is the whole reason it is a module of its own — the rules
 * about what a saved state may say are exactly the sort of thing that is worth
 * a test and impossible to reach from inside a shell that has already opened a
 * window by the time it is imported.
 */

export const DEFAULT_WINDOW = { width: 1180, height: 820 };
/** Small enough for a laptop, wide enough that the reading column is not squeezed. */
export const MINIMUM_WINDOW = { width: 720, height: 520 };

/**
 * What `new BrowserWindow` should be given, from what was written down last
 * time.
 *
 * Every field is checked because the file is on somebody's disk and may say
 * anything: a width of `0` from a run that closed while minimised, a `null`
 * from a hand edit, an `x` of `1.5`. A size below the minimum is raised to it
 * rather than refused — a window that opens too small is still a window — and
 * a place that is not two whole numbers is dropped altogether, which lets
 * Electron centre it.
 *
 * @param {unknown} saved
 * @returns {{width: number, height: number, x?: number, y?: number}}
 */
export function windowStateFrom(saved) {
  if (saved === null || typeof saved !== 'object') return { ...DEFAULT_WINDOW };
  const width = Math.max(MINIMUM_WINDOW.width, Number(saved.width) || DEFAULT_WINDOW.width);
  const height = Math.max(MINIMUM_WINDOW.height, Number(saved.height) || DEFAULT_WINDOW.height);
  const place =
    Number.isInteger(saved.x) && Number.isInteger(saved.y) ? { x: saved.x, y: saved.y } : {};
  return { width, height, ...place };
}

/**
 * The state in the file, or the default. A profile with no `window.json` is
 * every first run, so a missing file is not worth a word.
 *
 * @param {string} path
 */
export async function readWindowState(path) {
  try {
    return windowStateFrom(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return { ...DEFAULT_WINDOW };
  }
}

/**
 * What to write down about a window as it stands, or null for a window there
 * is nothing to say about.
 *
 * A minimised window is 160×28 in a corner, and writing that down is how a
 * reader gets a postage stamp next time. A maximised one keeps its size for
 * when it is un-maximised but not its place, which is the corner of whichever
 * screen it filled.
 *
 * @param {{isMinimized(): boolean, isMaximized(): boolean,
 *   getSize(): number[], getPosition(): number[]}} window
 */
export function windowStateOf(window) {
  if (window.isMinimized()) return null;
  const [width, height] = window.getSize();
  const [x, y] = window.getPosition();
  return window.isMaximized() ? { width, height } : { width, height, x, y };
}

/**
 * Written on close rather than on every move: the app's own documents are
 * debounced through the server, and this is not one of them. A profile that
 * cannot be written is not a reason to hold up a quit.
 *
 * @param {string} path
 * @param {Parameters<typeof windowStateOf>[0] | null} window
 */
export async function rememberWindow(path, window) {
  const state = window && windowStateOf(window);
  if (!state) return;
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8').catch(() => {});
}
