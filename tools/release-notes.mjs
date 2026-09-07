import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalise, notesProblem, releasePage, versionCount } from './lib/changelog.mjs';

/**
 * `npm run notes` — writes docs/releases.md from CHANGELOG.md.
 * `npm run check:notes` — fails if the two have drifted apart.
 *
 * The changelog is the release notes: the tag's workflow copies its top section
 * onto the draft release, and this copies the whole of it onto the website. One
 * place to write them, three places they appear, and no summary of a summary.
 *
 * The check runs in the release workflow beside `check:docs`, so a changelog
 * that was edited without regenerating this page fails before anything is
 * published rather than after.
 *
 * What the page is made of — the header, and which sections of the changelog
 * are on it — is in tools/lib/changelog.mjs, where a node:test can read it
 * back. This file reads and writes the two files and says which way they differ.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'CHANGELOG.md');
const PAGE = join(ROOT, 'docs', 'releases.md');

const checking = process.argv.includes('--check');
/** `--version 0.1.1`: the tag being built, which the top section has to name. */
const tagged = argumentAfter('--version');

const changelog = await readFile(SOURCE, 'utf8');
const page = releasePage(changelog);
const current = await readFile(PAGE, 'utf8').then(normalise, () => null);

if (tagged) {
  const problem = notesProblem(changelog, tagged);
  if (problem) {
    console.error(`\ncheck:notes — ${problem}\n`);
    process.exit(1);
  }
  console.log(`check:notes — CHANGELOG.md’s top section is ${tagged}.`);
} else if (!checking) {
  await writeFile(PAGE, page, 'utf8');
  console.log(`notes — docs/releases.md, ${versionCount(page)} version(s) from CHANGELOG.md`);
} else if (current !== page) {
  console.error(
    '\ncheck:notes — docs/releases.md does not match CHANGELOG.md.\n\n' +
      '  The website serves the page as it is committed, so a changelog edited\n' +
      '  without it would put out a release whose notes are last version’s.\n' +
      '  Run `npm run notes` and commit what it writes.\n',
  );
  process.exit(1);
} else {
  console.log(
    `check:notes — docs/releases.md matches CHANGELOG.md (${versionCount(page)} version(s)).`,
  );
}

function argumentAfter(flag) {
  const at = process.argv.indexOf(flag);
  return at === -1 ? '' : (process.argv[at + 1] ?? '').replace(/^v/, '');
}
