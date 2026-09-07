/**
 * What a page in docs/ says it links to, and what it makes a browser fetch.
 *
 * Collection only: every function here takes the text of one file and answers
 * a question about it. Which answers are *problems*, and how they are put to
 * whoever has to fix them, is `tools/check-docs.mjs` — the script has its
 * effects at the top of the file and cannot be imported to be asked, and the
 * traps it exists to catch are the sort that are easier to get wrong in the
 * reading than in the writing.
 *
 * Every pattern here is anchored on `\n`: this repository is edited on Windows,
 * every one of those files is CRLF on disk, and a pattern that forgot would
 * silently match nothing and report a clean bill of health. Hence
 * {@link normalise}, which everything else expects to have been run first.
 */

/** Jekyll will not build a page from these unless _config.yml asks it to. */
export const META_FILES = ['README.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'LICENSE.md'];

/** `https://x`, `http://x` and `//x` — anything with a host of its own. */
const ANOTHER_HOST = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;

const COMMENT = /<!--[\s\S]*?-->/g;

/**
 * Everything a browser goes and fetches on its own, as opposed to a link a
 * reader chooses to follow. Attributes, `@import` and CSS `url()`, plus
 * markdown pictures, which the link pass lets through when they are absolute.
 */
const FETCHED = [
  [/<script\b[^>]*\bsrc=["']?([^"'\s>]+)/gi, 'a script'],
  [/<link\b[^>]*\bhref=["']?([^"'\s>]+)/gi, 'a stylesheet, font or icon'],
  [
    /<(?:img|iframe|video|audio|source|track|embed)\b[^>]*\bsrc=["']?([^"'\s>]+)/gi,
    'an embedded file',
  ],
  [/<object\b[^>]*\bdata=["']?([^"'\s>]+)/gi, 'an embedded file'],
  [/@import\s+(?:url\()?\s*["']?([^"')\s;]+)/gi, 'an imported stylesheet'],
  [/\burl\(\s*["']?([^"')]+)/gi, 'a file named in CSS'],
  [/!\[[^\]]*\]\(\s*([^)\s]+)/g, 'a picture'],
];

/** CRLF in, LF out. Run this on every file before anything else reads it. */
export function normalise(text) {
  return text.replace(/\r\n/g, '\n');
}

/** Code and comments talk *about* links; they do not contain any. */
export function withoutCode(source) {
  return source
    .replace(COMMENT, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/(^|\n)(?: {4}|\t)[^\n]*/g, '$1')
    .replace(/`[^`\n]*`/g, '');
}

/**
 * Every `[text](target)` and `![alt](target)`, with the target split at its
 * `#` and the two things a rule needs to know about each: whether it is a
 * picture, and whether its text wraps onto another line.
 *
 * `external` covers the targets no local check can say anything about — another
 * site, an address, a heading on this page.
 *
 * The `s` flag on the pattern is the point of the whole function: a link whose
 * *text* wraps is one jekyll-relative-links does not match at all, so it is
 * left saying `.md` and the visitor gets a page of raw markdown. Matching it
 * here, across the line break, is how it can be reported.
 */
export function markdownLinks(source) {
  const links = [];
  for (const match of source.matchAll(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/gs)) {
    const [, bang, text, target] = match;
    const [path = ''] = target.split('#');
    links.push({
      picture: bang === '!',
      text,
      target,
      path,
      external: /^(https?:|mailto:|#)/.test(target),
      wrapped: text.includes('\n'),
    });
  }
  return links;
}

/**
 * The `.md` targets of `href="…"` in raw HTML. Only markdown links are ever
 * rewritten, so one of these is served as written and lands on raw markdown.
 */
export function htmlMarkdownLinks(source) {
  return [...source.matchAll(/href="([^"]+\.md)(#[^"]*)?"/g)].map((match) => match[1]);
}

/**
 * Liquid tags inside HTML comments, as `{ tag, index }`.
 *
 * Liquid does not know what an HTML comment is. `{%` inside `<!-- -->` is
 * parsed like any other tag, so an `if` written out in a note about the
 * template it came from is an `if` that is never closed, and the Pages build
 * stops with it. Nothing catches that at review time — the file reads as a
 * comment — and every local check passes, because none of them is Jekyll.
 * Broke the deploy once, on 2026-09-05, in `docs/_includes/head.html`.
 */
export function liquidInComments(raw) {
  const found = [];
  for (const comment of raw.matchAll(COMMENT)) {
    const tag = /\{%-?\s*([a-z]+)/i.exec(comment[0]);
    if (tag) found.push({ tag: tag[1], index: comment.index });
  }
  return found;
}

/**
 * Everything the page has the browser fetch from a host that is not this site,
 * as `{ target, what }`. The rule is at the top of _config.yml: no analytics,
 * no CDN, no web font, no embed. Comments are dropped first — HTML hides its
 * notes in them, and nobody fetches a note.
 */
export function fetchedFromElsewhere(source) {
  const found = [];
  for (const [pattern, what] of FETCHED) {
    for (const [, target] of source.matchAll(pattern)) {
      if (ANOTHER_HOST.test(target)) found.push({ target, what });
    }
  }
  return found;
}

/** Comments out, for a file that is HTML rather than markdown. */
export function withoutComments(raw) {
  return raw.replace(COMMENT, '');
}

/**
 * The names under `include:` in _config.yml, and only those. `header_pages:`
 * lists README.md too, and reading both would have the check pass while the
 * site served raw markdown.
 */
export function includedFiles(config) {
  const block = /^include:\n((?:[ \t]+-[^\n]*\n)+)/m.exec(normalise(config))?.[1] ?? '';
  return new Set(
    block
      .split('\n')
      .map((line) => line.replace(/^[ \t]*-[ \t]*/, '').trim())
      .filter(Boolean),
  );
}
