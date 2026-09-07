import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { backupOnStartup } from '../src/backup.js';
import { readZip } from './read-zip.js';

/** A data folder with one document in it, and a backups folder beside it. */
async function folders({ withData = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'lamplit-backup-'));
  const dataDir = join(root, 'data');
  const backupsDir = join(root, 'backups');
  await mkdir(dataDir, { recursive: true });
  if (withData) {
    await writeFile(join(dataDir, 'settings.json'), '{"activeStoryId":"abc"}', 'utf8');
  }
  return { dataDir, backupsDir };
}

/** The name today's archive is filed under, which is how "once a day" works. */
function named(day) {
  return `data-${day.toISOString().slice(0, 10)}.zip`;
}

describe('backupOnStartup', () => {
  it('zips the data folder once a day and skips an empty one', async () => {
    const { dataDir, backupsDir } = await folders({ withData: false });

    assert.equal(await backupOnStartup(dataDir, backupsDir), null, 'nothing to back up yet');

    await writeFile(join(dataDir, 'settings.json'), '{"activeStoryId":"abc"}', 'utf8');
    const made = await backupOnStartup(dataDir, backupsDir);
    assert.ok(made?.endsWith('.zip'));

    const entries = readZip(await readFile(made));
    assert.equal(entries.get('data/settings.json').data.toString(), '{"activeStoryId":"abc"}');

    assert.equal(await backupOnStartup(dataDir, backupsDir), null, 'already taken today');
  });

  it('writes today’s archive again when the one there is not an archive', async () => {
    const { dataDir, backupsDir } = await folders();
    await mkdir(backupsDir, { recursive: true });

    // What an interrupted run used to leave behind: the name, and 25 bytes.
    const today = named(new Date());
    await writeFile(join(backupsDir, today), Buffer.alloc(25, 1));

    const made = await backupOnStartup(dataDir, backupsDir);
    assert.equal(made, join(backupsDir, today));
    const entries = readZip(await readFile(made));
    assert.equal(entries.get('data/settings.json').data.toString(), '{"activeStoryId":"abc"}');
    assert.deepEqual(await readdir(backupsDir), [today], 'nothing temporary left beside it');
  });

  it('keeps a fortnight of them and drops the oldest', async () => {
    // A day at a time, sixteen times over, which is the only way to reach the
    // limit: the name carries the date, and one is taken per start-up per day.
    const { dataDir, backupsDir } = await folders();
    const days = [];
    for (let i = 0; i < 16; i++) {
      const day = new Date(Date.UTC(2026, 0, 1 + i));
      days.push(named(day));
      assert.equal(await backupOnStartup(dataDir, backupsDir, day), join(backupsDir, named(day)));
    }

    // The newest fourteen, and the two eldest gone rather than the two newest.
    assert.deepEqual(await readdir(backupsDir), days.slice(2));
  });

  it('leaves a file that is not one of its own alone', async () => {
    const { dataDir, backupsDir } = await folders();
    await mkdir(backupsDir, { recursive: true });
    await writeFile(join(backupsDir, 'notes-of-my-own.txt'), 'keep me', 'utf8');
    for (let i = 0; i < 16; i++) {
      await backupOnStartup(dataDir, backupsDir, new Date(Date.UTC(2026, 0, 1 + i)));
    }
    assert.equal(
      await readFile(join(backupsDir, 'notes-of-my-own.txt'), 'utf8'),
      'keep me',
      'the prune counts and deletes only data-<date>.zip',
    );
  });
});
