/**
 * Where this server says things out loud.
 *
 * One line's worth of module, and it exists because the alternative was
 * `console.warn` written inline in five files — the store skipping an
 * unreadable document, the port walk stepping over a busy one, a backup that
 * failed, a 500 — and tests that had to monkey-patch `console` to keep the
 * output readable. `updates.js` already took a `log` for exactly that reason;
 * everything else now does too, with this as the default.
 *
 * A log is a function of one sentence. Not a level, not a formatter, not an
 * object with methods: nothing here has ever wanted more, and the moment
 * something does, the seam to widen is already in place.
 *
 * @typedef {(message: string) => void} Log
 */

/** @type {Log} */
export const defaultLog = (message) => console.warn(`[lamplit] ${message}`);

/** A log that says nothing, for a test that is not about what was said. */
export const silentLog = () => {};
