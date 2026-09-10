import { InjectionToken } from '@angular/core';
import { OutboundMessage } from './models';

/**
 * Token counting is an estimate on purpose: exact counts are provider-specific
 * and the context budget is a budget, not a guarantee. `gpt-tokenizer` can be
 * dropped in behind this interface later without touching callers.
 *
 * It errs high, deliberately. Too high trims a little more history than it had
 * to; too low sends a request past the model's context window, which comes
 * back as a 400 the app can only report, having no smaller thing to send.
 */
export interface TokenEstimator {
  count(text: string): number;
  countMessages(messages: readonly OutboundMessage[]): number;
}

/**
 * How many characters a token buys, by what kind of character it is.
 *
 * One number for all of them used to be 3.6, which is right for English prose
 * and about right for French and German, and wrong by three or four times for
 * everything a byte-pair tokenizer has not been fed much of. A tokenizer that
 * has seen "the" a million times spends one token on it; a Chinese character
 * it has seen rarely costs one token on its own, and one it has not seen costs
 * two or three bytes' worth. The estimate has to be the *dearest* of the
 * tokenizers a reader might be talking to, because being high wastes a little
 * context and being low sends a request the endpoint answers with a 400.
 *
 * Each of these is the dearest per-code-point cost that cl100k or o200k was
 * measured to charge for that group, so the estimate is at or above both. A
 * group is as dear as its dearest member: Arabic sits with Devanagari and is
 * over-counted by about half as the price of that, where sitting with Cyrillic
 * would have under-counted it, which is the one thing this must not do.
 *
 *   Latin      3.6    English, French, German prose and markdown
 *   Cyrillic   1.7    Russian and its neighbours
 *   digits     1.2    dates, ids, counts — barely compressed at all
 *   other      0.85   Devanagari, Greek, Arabic, Hebrew, Thai, …
 *   CJK        0.72   Han, Kana, Hangul — a token a character, and often more
 *   emoji      2.3 tokens each, per code point, joiners counted separately
 *
 * Held as ten-thousandths of a token and added up as integers. In floating
 * point 3.6 does not divide 1, and thirty-six Latin characters came to a
 * hair over ten tokens and were charged eleven — an awkward sentence to have
 * to defend, and a drift that grows with the length of the text.
 */
const PER_TOKEN = 10_000;
const LATIN = Math.floor(PER_TOKEN / 3.6);
const CYRILLIC = Math.floor(PER_TOKEN / 1.7);
const DIGIT = Math.floor(PER_TOKEN / 1.2);
const OTHER = Math.floor(PER_TOKEN / 0.85);
const CJK = Math.floor(PER_TOKEN / 0.72);
const EMOJI = Math.round(2.3 * PER_TOKEN);

/** Role/separator overhead each message costs in the chat-completions format. */
const PER_MESSAGE_OVERHEAD = 4;

/**
 * What one code point is worth, by the block it belongs to.
 *
 * Ranges rather than `\p{Script=…}` regexes, and ascending so that the first
 * comparison ends it for ASCII: this runs over the whole history on every
 * keystroke to draw the pill under the composer, and a scan that allocates is
 * felt there.
 */
function tokensOf(code: number): number {
  if (code < 0x80) return code >= 0x30 && code <= 0x39 ? DIGIT : LATIN;
  if (code < 0x370) return LATIN; // Latin-1 through IPA: the accented alphabets
  if (code < 0x400) return OTHER; // Greek and Coptic
  if (code < 0x530) return CYRILLIC; // Cyrillic and its supplement
  if (code < 0x1100) return OTHER; // Hebrew, Arabic, Devanagari, Thai, …
  if (code < 0x1200) return CJK; // Hangul Jamo
  if (code < 0x1e00) return OTHER; // Ethiopic, Cherokee, Khmer, Mongolian, …
  if (code < 0x1f00) return LATIN; // Latin Extended Additional
  if (code < 0x2000) return OTHER; // Greek Extended
  // A zero-width joiner is never anything but part of an emoji, and the pieces
  // it joins are charged for one by one.
  if (code < 0x2600) return code === 0x200d ? EMOJI : LATIN; // punctuation, arrows, maths
  if (code < 0x2800) return EMOJI; // miscellaneous symbols and dingbats
  if (code < 0x2e80) return LATIN; // braille and the rest of the arrows
  if (code < 0xa000) return CJK; // radicals, kana, bopomofo, the ideographs
  if (code < 0xa960) return OTHER; // Yi, Lisu, Vai, Bamum, …
  if (code < 0xa980) return CJK; // Hangul Jamo Extended-A
  if (code < 0xac00) return OTHER; // Javanese, Cham, Meetei Mayek, …
  if (code < 0xd800) return CJK; // Hangul syllables
  if (code < 0xf900) return OTHER; // surrogates and the private use area
  if (code < 0xfb00) return CJK; // CJK compatibility ideographs
  if (code < 0xff00) return OTHER; // Arabic presentation forms, half marks
  if (code < 0xfff0) return CJK; // halfwidth and fullwidth forms
  if (code < 0x1f000) return OTHER; // the historic and musical planes
  if (code < 0x1fb00) return EMOJI; // the emoji blocks, tiles and dominoes included
  if (code < 0x20000) return OTHER;
  if (code < 0x40000) return CJK; // the ideograph extensions
  return OTHER;
}

export const heuristicEstimator: TokenEstimator = {
  count(text) {
    if (!text) return 0;
    let total = 0;
    for (let i = 0; i < text.length; i++) {
      let code = text.charCodeAt(i);
      // A surrogate pair is one code point and is charged as one: an emoji is
      // not two characters, and neither is an ideograph from a later plane.
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        const low = text.charCodeAt(i + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          code = (code - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
          i++;
        }
      }
      total += tokensOf(code);
    }
    return Math.ceil(total / PER_TOKEN);
  },
  countMessages(messages) {
    return messages.reduce(
      (total, m) => total + PER_MESSAGE_OVERHEAD + heuristicEstimator.count(m.content),
      0,
    );
  },
};

export const TOKEN_ESTIMATOR = new InjectionToken<TokenEstimator>('TokenEstimator', {
  providedIn: 'root',
  factory: () => heuristicEstimator,
});

/**
 * "3.2k" / "812" — for the pills and message footers.
 *
 * Rounded before the shape is chosen, not after: 9,999 rounds to ten thousand
 * and is written `10k`, where deciding on the raw number first wrote `10.0k`,
 * and a million was `1000k`.
 */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  const thousands = Math.round(n / 100) / 10;
  if (thousands < 10) return `${thousands.toFixed(1)}k`;
  const rounded = Math.round(n / 1000);
  return rounded < 1000 ? `${rounded}k` : `${(Math.round(n / 100_000) / 10).toFixed(1)}M`;
}

/**
 * `1.2k in · 340 out · 1.1k cached` — what one request cost, said the same way
 * wherever it is said: under a message, under the summary a chapter is closed
 * with, under the entries proposed from it.
 *
 * Empty when the provider counted nothing out loud. An endpoint that reports
 * no usage is common enough that a zero would be a lie, and the prompt half is
 * left off on its own for the same reason — as is the cached half, which most
 * endpoints never mention and no local one does.
 *
 * That last number is the only place a reader can see whether the prefix cache
 * is working. It is the whole of the instrumentation, because a caching
 * failure is otherwise silent: the requests still succeed, the replies are
 * still right, and the bill is just larger.
 */
export function tokenCost(
  usage: { promptTokens?: number; completionTokens?: number; cachedTokens?: number } | undefined,
): string {
  if (!usage?.completionTokens) return '';
  const asked = usage.promptTokens ? `${formatTokens(usage.promptTokens)} in · ` : '';
  const cached = usage.cachedTokens ? ` · ${formatTokens(usage.cachedTokens)} cached` : '';
  return `${asked}${formatTokens(usage.completionTokens)} out${cached}`;
}
