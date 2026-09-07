import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { collectEntries, writeZip } from '../src/zip.js';
import { readZip } from './read-zip.js';

describe('writeZip', () => {
  it('writes an archive whose entries read back byte for byte', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lamplit-zip-'));
    const target = join(dir, 'out.zip');
    const prose = Buffer.from('The lantern room. '.repeat(200), 'utf8');
    await writeZip(target, [
      { name: 'folder/' },
      { name: 'folder/small.txt', data: Buffer.from('hi', 'utf8') },
      { name: 'folder/long.txt', data: prose },
      { name: 'start.sh', data: Buffer.from('#!/bin/sh\n', 'utf8'), mode: 0o755 },
    ]);

    const entries = readZip(await readFile(target));
    assert.deepEqual([...entries.keys()].sort(), [
      'folder/',
      'folder/long.txt',
      'folder/small.txt',
      'start.sh',
    ]);
    assert.equal(entries.get('folder/small.txt').data.toString(), 'hi');
    assert.deepEqual(entries.get('folder/long.txt').data, prose);
    assert.equal(entries.get('start.sh').mode, 0o755);
    assert.equal(entries.get('folder/small.txt').mode, 0o644);
  });

  it('fails when the archive cannot be written, rather than reporting one that is not there', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lamplit-zip-'));
    const target = join(dir, 'missing', 'out.zip');
    const small = [{ name: 'a.txt', data: Buffer.from('x'.repeat(100), 'utf8') }];
    await assert.rejects(writeZip(target, small), /ENOENT/);
    // Large enough to fill the stream's buffer and wait for a drain that never comes.
    const large = [
      { name: 'b.bin', data: Buffer.from(Array.from({ length: 200_000 }, (_, i) => i % 251)) },
    ];
    await assert.rejects(writeZip(target, large), /ENOENT/);
  });

  it('is readable by whatever unzips archives on this machine', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lamplit-zip-'));
    const target = join(dir, 'out.zip');
    await writeZip(target, [{ name: 'note.txt', data: Buffer.from('lantern', 'utf8') }]);

    const extracted = join(dir, 'out');
    const result =
      process.platform === 'win32'
        ? spawnSync(
            'powershell.exe',
            [
              '-NoProfile',
              '-Command',
              `Expand-Archive -Path '${target}' -DestinationPath '${extracted}'`,
            ],
            { encoding: 'utf8' },
          )
        : spawnSync('unzip', ['-q', target, '-d', extracted], { encoding: 'utf8' });
    if (result.error) return; // no unzip on this machine: the reader above stands
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(extracted, 'note.txt'), 'utf8'), 'lantern');
  });
});

describe('collectEntries', () => {
  it('walks a folder into archive entries under a prefix', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lamplit-walk-'));
    await mkdir(join(dir, 'stories'), { recursive: true });
    await writeFile(join(dir, 'settings.json'), '{}', 'utf8');
    await writeFile(join(dir, 'stories', 'abc.json'), '{"id":"abc"}', 'utf8');

    const entries = await collectEntries(dir, 'data');
    assert.deepEqual(
      entries.map((entry) => entry.name),
      ['data/settings.json', 'data/stories/', 'data/stories/abc.json'],
    );
  });
});
