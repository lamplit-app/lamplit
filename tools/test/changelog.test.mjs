import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { notesProblem, releasePage, topSection, versionCount } from '../lib/changelog.mjs';

const RELEASED = `# Changelog\n\nA preamble.\n\n## 0.1.1\n\nWhat changed.\n\n## 0.1.0\n\nThe first one.\n`;
const UNRELEASED = RELEASED.replace('## 0.1.1', '## Unreleased');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('the changelog’s top section', () => {
  it('is the heading of the first section, whatever it says', () => {
    assert.equal(topSection(RELEASED), '0.1.1');
    assert.equal(topSection(UNRELEASED), 'Unreleased');
    assert.equal(topSection('# Changelog\n\nNothing yet.\n'), '');
    // Written on Windows, read anywhere.
    assert.equal(topSection('# Changelog\r\n\r\n## 0.2.0\r\n\r\nWhat changed.\r\n'), '0.2.0');
  });
});

describe('publishing a tag’s notes', () => {
  it('is content when the top section is the version being tagged', () => {
    assert.equal(notesProblem(RELEASED, '0.1.1'), '');
  });

  it('refuses to publish the unreleased section as a release', () => {
    // The state a repository is in for the whole of the time between releases,
    // which is exactly when a tag is pushed.
    assert.match(notesProblem(UNRELEASED, '0.1.1'), /Unreleased/);
    assert.match(notesProblem(UNRELEASED, '0.1.1'), /0\.1\.1/);
  });

  it('refuses a top section that is some other version', () => {
    assert.match(notesProblem(RELEASED, '0.2.0'), /0\.1\.1/);
  });

  it('says so when there is nothing to publish at all', () => {
    assert.match(notesProblem('# Changelog\n\nNothing yet.\n', '0.1.1'), /no section/);
  });
});

describe('the page the website serves', () => {
  it('carries every released section, newest first', () => {
    const page = releasePage(RELEASED);
    assert.deepEqual(page.match(/^## .*/gm), ['## 0.1.1', '## 0.1.0']);
    assert.match(page, /^# Release notes\n/);
    assert.equal(versionCount(page), 2);
  });

  it('leaves out the unreleased section, and says so by carrying the rest', () => {
    // A section about a version nobody can download, on a page read by people
    // deciding whether to download one.
    const page = releasePage(UNRELEASED);
    assert.deepEqual(page.match(/^## .*/gm), ['## 0.1.0']);
    assert.equal(page.includes('What changed.'), false, 'the unreleased notes go with it');
    assert.match(page, /The first one\./);
  });

  it('leaves out the preamble written for whoever edits the changelog', () => {
    assert.equal(releasePage(RELEASED).includes('A preamble.'), false);
  });

  it('says where it came from, so nobody edits the page instead', () => {
    assert.match(
      releasePage(RELEASED),
      /Generated from CHANGELOG\.md by tools\/release-notes\.mjs/,
    );
  });

  it('is a page even when there is nothing released to put on it', () => {
    const page = releasePage('# Changelog\n\n## Unreleased\n\nSoon.\n');
    assert.match(page, /^# Release notes\n/);
    assert.equal(versionCount(page), 0);
  });

  it('reads a changelog written with CRLF and writes LF', () => {
    const page = releasePage(RELEASED.replace(/\n/g, '\r\n'));
    assert.equal(page.includes('\r'), false);
    assert.equal(page, releasePage(RELEASED), 'the same page either way');
  });

  it('is byte for byte the page in the repository', async () => {
    // `npm run check:notes` compares these two in the release workflow; this
    // says the same thing about the pair as they are committed today.
    const changelog = await readFile(join(ROOT, 'CHANGELOG.md'), 'utf8');
    const committed = await readFile(join(ROOT, 'docs', 'releases.md'), 'utf8');
    assert.equal(releasePage(changelog), committed.replace(/\r\n/g, '\n'));
  });
});
