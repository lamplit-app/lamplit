import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

/**
 * Reads an archive back the hard way — by walking its central directory — so
 * the tests do not merely agree with the writer about a format it invented.
 *
 * Here rather than in either spec because both need it: `zip.test.js` reads
 * back what `writeZip` wrote, and `backup.test.js` reads back the archive a
 * start-up took of the data folder.
 */
export function readZip(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== EOCD) end--;
  assert.ok(end >= 0, 'no end-of-central-directory record');

  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(at), CENTRAL);
    const method = buffer.readUInt16LE(at + 10);
    const compressed = buffer.readUInt32LE(at + 20);
    const uncompressed = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const external = buffer.readUInt32LE(at + 38);
    const offset = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);

    // The local header's own name and extra lengths say where the bytes start.
    const localNameLength = buffer.readUInt16LE(offset + 26);
    const localExtraLength = buffer.readUInt16LE(offset + 28);
    const start = offset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressed);
    const data = method === 0 ? raw : inflateRawSync(raw);
    assert.equal(data.length, uncompressed);

    entries.set(name, { data, mode: (external >>> 16) & 0o7777 });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
