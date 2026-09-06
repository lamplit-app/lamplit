/**
 * The small text arithmetic that more than one pass over a message needs.
 *
 * Two of them cut a long run of prose into pieces — one so the renderer can
 * remember the pieces it has already made, one so a voice finishes saying
 * them — and both cut at the last mark that fits. Same question, so the same
 * answer, in one place where it can only be right or wrong once.
 */

/**
 * One past the last `mark` in `window`, or 0 when there is none.
 *
 * Past the *whole* mark: a caller cutting at `', '` wants the space as well as
 * the comma, and a cut one character short of that starts the next piece with
 * a space it then has to trim. 0 for "not found" is what makes the callers'
 * `after(w, a) || after(w, b) || PIECE` chain read: a mark at the very start
 * of the window is no use to them either, because cutting there makes an
 * empty piece and the loop never advances.
 */
export function after(window: string, mark: string): number {
  const at = window.lastIndexOf(mark);
  return at < 0 ? 0 : at + mark.length;
}
