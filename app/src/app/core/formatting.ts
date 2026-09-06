import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { speechRuns } from './prose-markdown';
import { after } from './text';

// A story is not a codebase: register the handful of languages a fenced block
// here plausibly holds rather than pulling in all of highlight.js.
for (const [name, language] of Object.entries({
  bash,
  css,
  json,
  markdown,
  python,
  typescript,
  xml,
  yaml,
})) {
  hljs.registerLanguage(name, language);
}
hljs.registerAliases(['js', 'javascript', 'jsx', 'tsx', 'ts'], { languageName: 'typescript' });
hljs.registerAliases(['sh', 'shell', 'zsh'], { languageName: 'bash' });
hljs.registerAliases(['html', 'svg'], { languageName: 'xml' });
hljs.registerAliases(['md'], { languageName: 'markdown' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });

export interface RenderOptions {
  /** Each spoken line gets its own paragraph, the way a novel sets dialogue. */
  bookStyleDialogue: boolean;
}

const renderer = {
  code({ text, lang }: { text: string; lang?: string }) {
    const language = (lang ?? '').trim().split(/\s+/)[0];
    const highlighted =
      language && hljs.getLanguage(language)
        ? hljs.highlight(text, { language, ignoreIllegals: true }).value
        : hljs.highlightAuto(text).value;
    return `<pre><code class="hljs language-${escapeAttribute(language || 'plaintext')}">${highlighted}</code></pre>`;
  },
};

/**
 * Story prose, where a newline the writer typed is a newline they meant. A
 * model that puts each spoken line on its own row expects to see it that way.
 */
const marked = new Marked({ gfm: true, breaks: true, renderer });

/**
 * Ordinary markdown, where a wrapped line is still the same paragraph. Release
 * notes are written for GitHub and hard-wrapped by the formatter, so `breaks`
 * would put a line ending in the middle of every sentence.
 */
const markedPlain = new Marked({ gfm: true, breaks: false, renderer });

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'hr',
    'em',
    'strong',
    'del',
    's',
    'code',
    'pre',
    'span',
    'blockquote',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'a',
  ],
  ALLOWED_ATTR: ['class', 'href', 'title'],
  ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
};

/**
 * The two things the allowlist alone cannot say.
 *
 * A link in an answer is the one link on the page the app did not write. Left
 * as it comes, following it navigates the single-page app off the story: the
 * turn still streaming is lost with the page, and the composer's draft with
 * it. Every link the app renders itself already opens in a new tab, so these
 * do too.
 *
 * And `class` has to stay on the allowlist, because a highlighted code block
 * is nothing but classed spans — but outside `code` and `pre` it lets raw HTML
 * in a message borrow the app's own styling and restyle its own text. Strip it
 * there and leave it where the highlighter put it.
 */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (!(node instanceof Element)) return;
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noreferrer noopener');
  }
  if (node.hasAttribute('class') && !node.closest('code, pre')) {
    node.removeAttribute('class');
  }
});

/**
 * Markdown -> safe HTML, and nothing else. What release notes want: they are
 * ordinary markdown written for GitHub, not story prose, so none of the
 * book-setting below has any business with them.
 */
export function renderMarkdown(source: string): string {
  if (!source) return '';
  return DOMPurify.sanitize(toHtml(markedPlain, source), PURIFY_CONFIG);
}

/**
 * The parse, and what to do when there is no parsing it.
 *
 * marked walks the source recursively, so prose nested deeply enough — a
 * thousand levels of `> - `, which a model that has started repeating itself
 * will eventually write — leaves it as a `RangeError` rather than as HTML.
 * This runs inside a `computed` read during change detection, so the throw
 * would take the view down and not just the paragraph. An unparseable answer
 * is shown as the text it is instead: still readable, still copyable, still
 * the words the model sent.
 */
function toHtml(parser: Marked, source: string): string {
  try {
    return parser.parse(source, { async: false });
  } catch {
    return `<p>${escapeText(source)}</p>`;
  }
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

// -- a message, parsed in pieces ---------------------------------------------

/**
 * Why a message is not handed to marked in one go.
 *
 * A streaming answer is rendered again on every frame, and marked is
 * superlinear on unbalanced emphasis — `**a **b** ` over and over, which is
 * what a model that has lost the thread writes. Thirty thousand characters of
 * that is seconds in a single parse, and it was being parsed sixty times a
 * second on the thread that should have been drawing the words as they landed.
 *
 * So the message is parsed where markdown itself divides it, block by block,
 * and each block's HTML is remembered by the text it came from. Only the block
 * the words are still arriving into is new on any given frame; everything above
 * it is a lookup. The same cache makes the one parse at the end of a turn
 * nearly free, because streaming has already done it a block at a time.
 *
 * `PIECE` is the longest run of prose marked is given at once. Past it a block
 * is cut again, at a line ending where there is one, which costs an emphasis
 * that spanned that ending. Fifteen hundred characters is a very long
 * paragraph — a page of a book is about two thousand — so what gets cut is a
 * model repeating itself, or nothing.
 */
const PIECE = 1500;

/**
 * Room for the chapter on screen and then some, and little enough that a story
 * left open all day is not a leak. Oldest out first: what is being written
 * into is what is asked for most.
 */
const CACHE_LIMIT = 600;
const parsed = new Map<string, string>();

function recall(key: string, parse: () => string): string {
  const known = parsed.get(key);
  if (known !== undefined) return known;
  const html = parse();
  if (parsed.size >= CACHE_LIMIT) {
    const oldest = parsed.keys().next();
    if (!oldest.done) parsed.delete(oldest.value);
  }
  parsed.set(key, html);
  return html;
}

/**
 * A reference definition — `[key]: https://…` — is read by the parse that
 * meets the `[key]` using it, so a cut between the two would leave the link as
 * its own literal text. Rare enough in story prose to be worth one regular
 * expression and a whole parse, rather than a special case in the splitting.
 */
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:/m;

/** One block of markdown -> HTML. */
function blockHtml(block: string): string {
  if (block.length <= PIECE || !isProse(block)) return toHtml(marked, block);

  // A paragraph too long to parse at once, cut up and put back together as the
  // one paragraph it is: the pieces are parsed as inline markdown, and what
  // separated them becomes what `breaks: true` would have made of it anyway —
  // a line ending is a `<br>`, a space is a space. Every piece but the last is
  // remembered, for the same reason the blocks above it are.
  const pieces = piecesOf(block);
  const html = pieces.map(({ text, gap }, i) => {
    const parse = () => toInlineHtml(marked, text);
    return (i < pieces.length - 1 ? recall(`piece:${text}`, parse) : parse()) + gap;
  });
  return `<p>${html.join('')}</p>`;
}

/** Inline markdown, with the same answer to a parse that will not finish. */
function toInlineHtml(parser: Marked, source: string): string {
  try {
    return parser.parseInline(source, { async: false });
  } catch {
    return escapeText(source);
  }
}

/**
 * A line that opens something a blank line does not close: a list item, a
 * quotation, or the indented continuation of either. With one of those on both
 * sides of a blank line, the blank line is inside a single block — a list whose
 * items are set apart, a quotation of two paragraphs — and cutting there would
 * make two lists where the writer meant one, and start the numbering again.
 */
const CONTAINER = /^(?: {0,3}(?:[-*+]|\d{1,9}[.)])\s|\s*>| {4}|\t)/;

/** Anything markdown reads as more than a run of words. */
const NOT_PROSE =
  /^(?: {0,3}(?:[-*+]|\d{1,9}[.)])\s| {0,3}(?:>|#{1,6}\s|`{3,}|~{3,}|\||-{3,}$|={3,}$)| {4}|\t)/;

/** The message at its blank lines, wherever cutting there means what it said. */
function blocksOf(source: string): string[] {
  const lines = source.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let fence = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Inside a fenced block a blank line is part of the code, and only a
    // closing fence of the same kind and at least as long ends it.
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      current.push(line);
      const closing = opening?.[1] ?? '';
      if (closing.startsWith(fence[0]!) && closing.length >= fence.length) fence = '';
      continue;
    }
    if (opening) fence = opening[1]!;

    if (line.trim()) {
      current.push(line);
      continue;
    }
    // Blank lines before anything has started are not a block of their own.
    if (!current.length) continue;

    // A blank line, and what follows it decides whether it is a cut.
    let next = i;
    while (next < lines.length && !lines[next]!.trim()) next++;
    if (CONTAINER.test(current[0] ?? '') && CONTAINER.test(lines[next] ?? '')) {
      current.push(line);
      continue;
    }

    blocks.push(current.join('\n'));
    current = [];
    i = next - 1;
  }

  if (current.length) blocks.push(current.join('\n'));
  return blocks.length ? blocks : [source];
}

/** Words and line endings, and nothing markdown builds a box out of. */
function isProse(block: string): boolean {
  return !block.split('\n').some((line) => NOT_PROSE.test(line));
}

/**
 * A long paragraph, packed greedily into pieces of at most `PIECE` characters
 * from the front, so that appending to the end never moves a cut already made
 * — which is what makes remembering them worth anything while an answer is
 * still arriving.
 *
 * A cut lands on a line ending when there is one inside the piece, because
 * that is where prose can best afford to be interrupted; failing that on a
 * space, and failing that mid-word, which only one long unbroken string can
 * reach.
 */
function piecesOf(block: string): { text: string; gap: string }[] {
  const pieces: { text: string; gap: string }[] = [];
  let from = 0;

  while (from < block.length) {
    const rest = block.slice(from);
    if (rest.length <= PIECE) {
      pieces.push({ text: rest, gap: '' });
      break;
    }
    const window = rest.slice(0, PIECE);
    const at = after(window, '\n') || after(window, ' ') || PIECE;
    const text = window.slice(0, at);
    // What the cut took out, said in HTML: the line ending `breaks: true`
    // would have made a `<br>` of, the space that was only a space, or — cut
    // mid-word — nothing at all.
    const cut = text.slice(-1);
    pieces.push({ text: text.trimEnd(), gap: cut === '\n' ? '<br>' : cut === ' ' ? ' ' : '' });
    from += at;
  }

  return pieces;
}

/**
 * Story text -> safe HTML: markdown first, then sanitising, then a formatting
 * pass over the resulting text nodes (never over the markup) that marks speech
 * and italic "actions" so the stylesheet can set them like a book.
 *
 * All of it a block at a time, and every block but the last remembered — see
 * `PIECE` above for why. Each of the three steps is local to the block it is
 * working on: a quotation is marked inside the text node holding it, an action
 * inside its own `<em>`, a spoken line inside its own paragraph. So a message
 * rendered in blocks and a message rendered whole are the same message.
 */
export function renderStoryHtml(source: string, options: RenderOptions): string {
  if (!source) return '';
  if (REFERENCE_DEFINITION.test(source)) return finish(toHtml(marked, source), options);

  const blocks = blocksOf(source);
  const setting = options.bookStyleDialogue ? 'book' : 'plain';
  return blocks
    .map((block, i) => {
      const render = () => finish(blockHtml(block), options);
      // Not the last one: that is where the next delta lands, and remembering
      // it would fill the cache with the answer at every length it has had.
      return i < blocks.length - 1 ? recall(`${setting}:${block}`, render) : render();
    })
    .join('');
}

/** Sanitising and the book-setting, which cost as much again as the parse. */
function finish(html: string, options: RenderOptions): string {
  const host = document.createElement('div');
  host.innerHTML = DOMPurify.sanitize(html, PURIFY_CONFIG);
  markSpeech(host);
  markActions(host);
  if (options.bookStyleDialogue) splitSpokenLines(host);
  return host.innerHTML;
}

/** Tags whose text is verbatim and must not be reformatted. */
const VERBATIM = new Set(['CODE', 'PRE', 'A']);

/**
 * Wraps `"quoted runs"` (straight or curly) in `<span class="speech">`. The
 * rule lives in `prose-markdown.ts`, because the editor colours what is being
 * typed by the same one.
 */
function markSpeech(host: HTMLElement): void {
  for (const node of textNodes(host)) {
    const text = node.nodeValue ?? '';
    if (!/["“]/.test(text)) continue;
    const runs = speechRuns(text);
    if (!runs.length) continue;

    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const [from, to] of runs) {
      if (from > cursor) fragment.append(document.createTextNode(text.slice(cursor, from)));
      const span = document.createElement('span');
      span.className = 'speech';
      span.textContent = text.slice(from, to);
      fragment.append(span);
      cursor = to;
    }
    if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
    node.parentNode?.replaceChild(fragment, node);
  }
}

/** `*like this*` already became `<em>`; label it so actions can be styled. */
function markActions(host: HTMLElement): void {
  for (const em of Array.from(host.querySelectorAll('em'))) {
    if (em.closest('code, pre')) continue;
    em.classList.add('action');
  }
}

/**
 * Book style: inside a paragraph, every stretch that starts with speech begins
 * a new paragraph, so `He grinned. "Hello." "And you?"` sets as three lines.
 */
function splitSpokenLines(host: HTMLElement): void {
  for (const paragraph of Array.from(host.querySelectorAll('p'))) {
    const speech = paragraph.querySelectorAll(':scope > span.speech');
    if (!speech.length) continue;

    const groups: Node[][] = [];
    let current: Node[] = [];
    for (const child of Array.from(paragraph.childNodes)) {
      const startsSpeech = isSpeech(child) && hasContent(current);
      if (startsSpeech) {
        groups.push(current);
        current = [];
      }
      current.push(child);
    }
    if (current.length) groups.push(current);
    if (groups.length < 2) continue;

    const replacement = document.createDocumentFragment();
    for (const group of groups) {
      if (!hasContent(group)) continue;
      const line = document.createElement('p');
      trimEdges(group).forEach((node) => line.append(node));
      replacement.append(line);
    }
    paragraph.replaceWith(replacement);
  }
}

function isSpeech(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && (node as Element).classList.contains('speech');
}

function hasContent(nodes: readonly Node[]): boolean {
  return nodes.some((n) => (n.textContent ?? '').trim().length > 0);
}

/**
 * Drops what used to separate two now-separate lines: the whitespace, and the
 * `<br>` a single newline in the model's answer became. Left in place, that
 * `<br>` would open an empty line inside the new paragraph.
 */
function trimEdges(nodes: readonly Node[]): Node[] {
  const kept = [...nodes];
  while (kept[0] && isBlank(kept[0])) kept.shift();
  while (kept.length && isBlank(kept[kept.length - 1]!)) kept.pop();
  return kept;
}

function isBlank(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return !(node.nodeValue ?? '').trim();
  return node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR';
}

function textNodes(host: HTMLElement): Text[] {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement && isVerbatim(node.parentElement)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const found: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    found.push(node as Text);
  }
  return found;
}

function isVerbatim(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (VERBATIM.has(node.tagName)) return true;
  }
  return false;
}

function escapeAttribute(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}
