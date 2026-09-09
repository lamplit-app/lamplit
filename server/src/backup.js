import { mkdir, open, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { onto } from './fs-atomic.js';
import { END_OF_CENTRAL, collectEntries, writeZip } from './zip.js';

/** How many daily archives to keep before the oldest is dropped. */
const KEEP = 14;

/**
 * One zip of `data/` per day, taken on startup. Cheap insurance against a
 * mistake made inside the app: the stores overwrite documents happily, and
 * nothing else on this machine holds a second copy.
 *
 * Returns the archive's path, or null when today's is already there or the
 * data folder is still empty.
 */
export async function backupOnStartup(dataDir, backupsDir, today = new Date()) {
  const stamp = today.toISOString().slice(0, 10);
  const target = join(backupsDir, `data-${stamp}.zip`);
  if (await isArchive(target)) return null;

  const entries = await collectEntries(dataDir, 'data');
  if (!entries.some((entry) => entry.data?.length)) return null;

  await mkdir(backupsDir, { recursive: true });
  // Written beside its name and moved onto it, through the same helper the
  // store writes a document with: a run that dies half way leaves a `.tmp`
  // the prune ignores, not a zip that is not one wearing today's name. The
  // random middle name matters here too — two copies started at once would
  // otherwise write the one `.tmp` and rename each other's half of it.
  await onto(target, (temporary) => writeZip(temporary, entries));
  await prune(backupsDir);
  return target;
}

/** Keeps the newest {@link KEEP} archives; the names sort by date already. */
async function prune(backupsDir) {
  const files = (await readdir(backupsDir).catch(() => []))
    .filter((name) => /^data-\d{4}-\d{2}-\d{2}\.zip$/.test(name))
    .sort();
  for (const name of files.slice(0, Math.max(0, files.length - KEEP))) {
    await rm(join(backupsDir, name), { force: true });
  }
}

/**
 * Whether a file is there *and* ends the way an archive ends. One that does
 * not is a run that was interrupted, and is written again rather than kept as
 * today's backup.
 */
async function isArchive(path) {
  let handle = null;
  try {
    handle = await open(path, 'r');
    const { size } = await handle.stat();
    if (size < 22) return false;
    const tail = Buffer.alloc(4);
    await handle.read(tail, 0, 4, size - 22);
    return tail.readUInt32LE(0) === END_OF_CENTRAL;
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}
