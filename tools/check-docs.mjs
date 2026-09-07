import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  META_FILES,
  fetchedFromElsewhere,
  htmlMarkdownLinks,
  includedFiles,
  liquidInComments,
  markdownLinks,
  normalise,
  withoutCode,
  withoutComments,
} from './lib/docs-scan.mjs';

/**
 * `npm run check:docs` — the links in docs/ still work as a website.
 *
 * The guide is served by GitHub Pages exactly as it is written, which means
 * `jekyll-relative-links` is what turns `[Chapters](chapters.md)` into a working
 * `.html` link. It is a regex, and it has two blind spots that fail silently:
 * the page still builds, the link still looks right in the markdown, and the
 * visitor gets a page of raw markdown. Both were live on the first deploy.
 *
 *   1. A link whose *text* wraps onto the next line is not matched at all.
 *      Re-wrapping a paragraph is enough to break one, which is exactly the
 *      kind of edit nobody re-checks.
 *   2. An `href` in raw HTML is never rewritten — only markdown links are. The
 *      landing page is mostly raw HTML, so its internal links say `.html`
 *      already; anywhere else, `.md` in an href is a mistake.
 *
 *   3. jekyll-optional-front-matter refuses to make a page out of four repo
 *      meta-files — README, CONTRIBUTING, CODE_OF_CONDUCT, LICENSE — so a link
 *      to one of those is raw markdown unless _config.yml names it under
 *      `include`. Every page in the guide links to README.md, and this is the
 *      fault that shipped.
 *
 * Plus the ordinary one: a link or picture pointing at a file that is not there.
 *
 * Offline, deterministic, and in the release workflow, because the failure it
 * catches is invisible until someone clicks.
 *
 * The second job is the promise the landing page makes in its foot: this site
 * sets no cookies and loads nothing from anyone else. A stylesheet from a CDN,
 * a web font, an embedded video, an analytics snippet — each is a request that
 * tells a company we do not control that someone read this page, and any of
 * them can arrive in one line that looks like an improvement. So the rule
 * written at the top of _config.yml is checked here rather than remembered:
 * everything the browser fetches must be served from this site.
 *
 * What is *in* a page — its links, its comments, what it fetches — is read by
 * tools/lib/docs-scan.mjs, where a node:test can put a page to each of these
 * traps in turn. This file walks the folder and says what is wrong.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');

/** Written as HTML on purpose: it is the website's page and never read on GitHub. */
const HTML_LINKS_ALLOWED = new Set(['index.md']);

const problems = [];
const files = (await readdir(DOCS)).filter((f) => f.endsWith('.md')).sort();
/** The pages, and the two folders of HTML that wrap every one of them. */
const served = [
  ...files,
  ...(await readdir(DOCS, { recursive: true }))
    .filter((f) => f.endsWith('.html'))
    .map((f) => f.split(sep).join('/'))
    .sort(),
];
const included = includedFiles(await readFile(join(DOCS, '_config.yml'), 'utf8'));

for (const file of files) {
  const source = withoutCode(normalise(await readFile(join(DOCS, file), 'utf8')));

  for (const link of markdownLinks(source)) {
    if (link.external) continue;

    if (link.path && !existsSync(join(DOCS, link.path))) {
      problems.push(`${file}: link to ${link.path}, which does not exist`);
      continue;
    }
    if (link.picture || !link.path.endsWith('.md')) continue;

    const base = link.path.split('/').pop();
    if (META_FILES.includes(base) && !included.has(base)) {
      problems.push(
        `${file}: links to ${base}, which jekyll-optional-front-matter skips, so no ` +
          `${base.replace(/\.md$/, '.html')} is built and the visitor gets raw markdown. ` +
          `Add "${base}" under include: in docs/_config.yml.`,
      );
      continue;
    }

    if (link.wrapped) {
      problems.push(
        `${file}: the link to ${link.path} has text that wraps onto the next line, so ` +
          `jekyll-relative-links will leave it as .md and the visitor gets raw markdown. ` +
          `Put the whole [text](${link.path}) on one line.`,
      );
    }
  }

  if (HTML_LINKS_ALLOWED.has(file)) continue;
  for (const target of htmlMarkdownLinks(source)) {
    problems.push(
      `${file}: href="${target}" is inside raw HTML, which is never rewritten. ` +
        `Use a markdown link, or write .html.`,
    );
  }
}

for (const file of served) {
  const raw = normalise(await readFile(join(DOCS, file), 'utf8'));

  for (const { tag, index } of liquidInComments(raw)) {
    problems.push(
      `${file}: the comment at character ${index} contains {% ${tag} %}. ` +
        `Liquid parses its own tags inside <!-- -->, so this one runs, and an if or ` +
        `a for with no end stops the Pages build. Say it without the braces.`,
    );
  }

  // Markdown hides its examples in code fences; HTML hides its notes in
  // comments. Neither is fetched by anybody.
  const source = file.endsWith('.md') ? withoutCode(raw) : withoutComments(raw);

  for (const { target, what } of fetchedFromElsewhere(source)) {
    problems.push(
      `${file}: ${what} is fetched from ${target}, which is not this site. ` +
        `The rule is at the top of _config.yml: no analytics, no CDN, no web ` +
        `font, no embed. Serve the file from docs/ or do without it.`,
    );
  }
}

if (problems.length) {
  console.error(`\ncheck:docs — ${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('');
  process.exit(1);
}
console.log(
  `check:docs — ${files.length} pages, every link resolves and will be rewritten, ` +
    `and nothing in ${served.length} files hides a Liquid tag in a comment or is fetched from another host.`,
);
