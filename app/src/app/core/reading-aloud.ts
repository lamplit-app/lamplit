/**
 * What a message sounds like: the words, without the marks that shape them.
 *
 * The page sets `*an action*` in italics and `"speech"` in its own colour, and
 * a voice has neither. So the asterisks, the backticks, the heading hashes and
 * the list bullets come out — read aloud they are noise, and read *as* the
 * characters they are they are worse — and the words are left exactly as the
 * model wrote them, quotation marks included, because a voice pauses at those
 * and a listener needs the pause.
 *
 * Deliberately its own pass rather than the rendered HTML's `textContent`:
 * this is a pure function of the markdown, so it can be read and tested
 * without a document, and it never depends on which of the page's settings
 * happened to be on when the message was drawn.
 */

import { after } from './text';

/** A link is what it says, not where it goes: `[the light](https://…)`. */
const LINK = /!?\[([^\]]*)\]\([^)]*\)/g;
/** A fence line — the code inside it stays, because dropping words is worse. */
const FENCE = /^ {0,3}(?:`{3,}|~{3,}).*$/gm;
/** `# ` through `###### `, and the setext underlines under a heading. */
const HEADING = /^ {0,3}#{1,6}[ \t]+/gm;
const RULE = /^ {0,3}(?:-{3,}|={3,}|\*{3,}|_{3,})[ \t]*$/gm;
/** A quotation is said in the same voice; only the angle bracket goes. */
const QUOTE = /^ {0,3}>[ \t]?/gm;
/** `- `, `* `, `1. ` — the marker, never the item. */
const BULLET = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])[ \t]+/gm;
/** Emphasis, in either spelling and at any depth, and inline code. */
const EMPHASIS = /(\*{1,3}|_{1,3}|`+)(?=\S)([\s\S]*?\S)\1/g;
/** A character the writer escaped to stop it being a mark. */
const ESCAPE = /\\([\\`*_{}[\]()#+\-.!>~|])/g;
/** Table pipes, which are a grid rather than a word. */
const TABLE = /^[ \t]*\|(.*)\|[ \t]*$/gm;

/**
 * The text of one message, and the name to say before it.
 *
 * `name` is empty except where the page itself would have shown one and the
 * listener has no page to look at — see `announcedName`. It ends in a full
 * stop so the voice pauses there rather than running the name into the first
 * word of the line.
 */
export function spokenText(content: string, name = ''): string {
  const words = strip(content);
  if (!words) return '';
  const who = name.trim();
  return who ? `${who}. ${words}` : words;
}

function strip(content: string): string {
  return (
    content
      .replace(FENCE, '')
      .replace(RULE, '')
      .replace(LINK, '$1')
      .replace(HEADING, '')
      .replace(QUOTE, '')
      .replace(BULLET, '$1')
      .replace(TABLE, '$1')
      // Twice: `***both at once***` is emphasis inside emphasis, and one pass
      // takes the outer pair only.
      .replace(EMPHASIS, '$2')
      .replace(EMPHASIS, '$2')
      .replace(ESCAPE, '$1')
      // Three blank lines and one are the same pause to a voice, and a line
      // with nothing but spaces left on it is not a line at all.
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/**
 * How long a piece handed to the voice may be.
 *
 * Not a stylistic choice: Chrome stops speaking after about fifteen seconds of
 * a single utterance and does not say why — long enough that it is exactly the
 * replies worth listening to that get cut off. Several short utterances queued
 * behind each other are spoken as one continuous reading and are not, so the
 * message is cut at sentence ends and handed over a piece at a time.
 *
 * Two hundred characters is a few seconds of speech at any rate anyone reads
 * at, with room under the limit for a slow voice.
 */
const PIECE = 200;

/** The end of a sentence, and the space after it. */
const SENTENCE = /(?<=[.!?…]["'”’)\]]*)\s+/;

/**
 * The text, in pieces a voice will finish. Sentences are kept whole wherever
 * one fits; a sentence longer than a piece is cut at a comma, then at a space,
 * and only mid-word if it is one unbroken string.
 */
export function speechPieces(text: string): string[] {
  const pieces: string[] = [];
  let current = '';

  for (const sentence of text.split(SENTENCE)) {
    if (!sentence.trim()) continue;
    if (current && current.length + sentence.length + 1 > PIECE) {
      pieces.push(current);
      current = '';
    }
    if (sentence.length <= PIECE) {
      current = current ? `${current} ${sentence}` : sentence;
      continue;
    }
    for (const part of cut(sentence)) pieces.push(part);
  }

  if (current) pieces.push(current);
  return pieces;
}

/** One sentence too long to say at once, in pieces of at most `PIECE`. */
function cut(sentence: string): string[] {
  const pieces: string[] = [];
  let rest = sentence;

  while (rest.length > PIECE) {
    const window = rest.slice(0, PIECE);
    const at = after(window, ', ') || after(window, ' ') || PIECE;
    pieces.push(window.slice(0, at).trim());
    rest = rest.slice(at);
  }
  if (rest.trim()) pieces.push(rest.trim());
  return pieces;
}
