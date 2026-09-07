/**
 * The changelog, read the two ways the release needs it read: what belongs on
 * the website, and whether the section at the top is the one being tagged.
 *
 * `tools/release-notes.mjs` reads and writes the files; the page itself is made
 * here so that a `node:test` can ask what it would write. What it writes is the
 * whole of what a reader deciding whether to download sees of what changed.
 */

/** This repository is edited on Windows; nothing it generates is CRLF. */
export function normalise(text) {
  return text.replace(/\r\n/g, '\n');
}

/** The heading of the first `## ` section, without its hashes. */
export function topSection(changelog) {
  return /^## +(.+?) *$/m.exec(normalise(changelog))?.[1] ?? '';
}

/**
 * What is wrong with publishing this changelog as `version`'s notes, or ''.
 *
 * The tag's workflow copies the top section onto the draft release without
 * reading it. The top section is `## Unreleased` for the whole of the time
 * between releases — which is exactly when a tag gets pushed — so the release
 * would be published under a heading that says it is not one, while the
 * website, which drops the unreleased section on purpose, showed no notes for
 * it at all.
 */
export function notesProblem(changelog, version) {
  const heading = topSection(changelog);
  if (!heading) return 'CHANGELOG.md has no section to publish.';
  if (heading === version) return '';
  return (
    `CHANGELOG.md’s top section is “${heading}”, and the tag is ${version}. ` +
    'Rename that section to the version before tagging: it is what the release ' +
    'notes and the website are both made from.'
  );
}

/**
 * What docs/releases.md is: a header that says what the page is, then every
 * released section of the changelog, newest first.
 *
 * The unreleased section is deliberately left out. It is a section about a
 * version nobody can download, and the website's readers are people deciding
 * whether to download one.
 *
 * The preamble above the changelog's first heading is left out too: it explains
 * the file to whoever edits it and means nothing to a reader of the website.
 */
export function releasePage(changelog) {
  return `${PAGE_HEADER}\n${released(normalise(changelog))}`;
}

/** How many versions a generated page carries, for the line the script prints. */
export function versionCount(page) {
  return (page.match(/^## /gm) ?? []).length;
}

const PAGE_HEADER = `# Release notes

[← Documentation](README.md) · The [download page](index.md) · [Upgrading](upgrading.md)

---

What changed in each version, as it was written when the version went out. The app shows the same
notes: **⋯ → About Lamplit → Release notes**, and the top bar says so when a newer one exists.

<!-- Generated from CHANGELOG.md by tools/release-notes.mjs. Edit the changelog. -->
`;

function released(source) {
  return source
    .split(/^## /m)
    .slice(1)
    .filter((section) => !/^unreleased\b/i.test(section))
    .map((section) => `## ${section.trimEnd()}\n`)
    .join('\n');
}
