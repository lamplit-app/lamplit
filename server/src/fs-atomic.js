import { randomBytes } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';

/**
 * Writes a file by writing another one and renaming it over the target, which
 * is atomic on both Windows and POSIX: a reader sees the old bytes or the new
 * ones, and a run that dies half way leaves the old file intact.
 *
 * A module of its own because three things want it and only one of them is a
 * document store: `store.js` writes documents, `share.js` keeps `server.json`
 * beside them, and `backup.js` moves a finished zip onto today's name. It used
 * to be exported from the store, so sharing imported the generic thing from
 * the specific place — and the backup, unable to reach it at all for want of a
 * text argument, hand-rolled a fixed `.tmp` name that two runs could collide
 * on.
 *
 * The Windows rename failure is part of the contract: where something holds
 * the target open the write has failed either way, and it must not also leave
 * a stray `.tmp` behind for the backup to pick up.
 *
 * @param {string} path
 * @param {string} text
 */
export async function writeAtomic(path, text) {
  await onto(path, (temporary) => writeFile(temporary, text, 'utf8'));
}

/**
 * The same rename, for something that writes its own bytes.
 *
 * `write` is handed a path nothing else is using and puts a whole file there;
 * what lands on `path` is that file, entire, or the file that was already
 * there. The backup's zip goes through here — a partial archive wearing
 * today's name is a backup that is not one, and the run after it would find
 * the name taken and take no backup at all.
 *
 * @param {string} path
 * @param {(temporary: string) => Promise<unknown>} write
 */
export async function onto(path, write) {
  const temporary = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await write(temporary);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}
