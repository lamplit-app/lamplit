import { describe, expect, it } from 'vitest';
import {
  CHARACTER_COLOURS,
  characterColour,
  characterColourLabel,
  nextColour,
  paletteColour,
} from './character-colours';
import { PAGE_PALETTES } from './page-palettes';
import { AA_CONTRAST, contrastRatio } from './theming';

/**
 * The palette is a claim — ten colours that read on every paper the app has
 * and can be told apart — and this is the claim being checked rather than
 * restated. The simulation and the contrast maths are here rather than in the
 * app because nothing at runtime needs them: the palette is fixed, and what has
 * to be true about it has to be true when it is edited, which is now.
 */

/** A paper, and enough of a name to find it by when a pair comes up short. */
interface Paper {
  colour: string;
  where: string;
}

/** The three sheets of any theme, shipped or preset. */
const SHEETS = ['page', 'surface', 'surface-raised'] as const;

/**
 * Every surface a character's colour is ever drawn against: the three papers
 * of the theme as it ships, and the three of each of the ten page palettes.
 *
 * Thirty-three rather than the three this began as, and the reason is what a
 * cast colour is: the one colour in the app that is not a `--li-*` token, so
 * it is the one colour a page palette cannot move. The ten pages repaint the
 * paper under a name and leave the name where it was, and the story is read on
 * all thirty of them. The contrast halves add nothing to the list — a palette's
 * stronger set is the rules and nothing else, which is `page-palettes.spec`'s
 * own assertion.
 *
 * The shipped three are written out rather than read off a stylesheet, because
 * there is no stylesheet in a unit test; `styles.scss` is where they live and
 * `page-palettes.spec` quotes them the same way.
 */
const PAPERS: Record<'light' | 'dark', readonly Paper[]> = {
  light: papersOf('light'),
  dark: papersOf('dark'),
};

function papersOf(theme: 'light' | 'dark'): Paper[] {
  const shipped =
    theme === 'light' ? ['#f6f3ec', '#fffdf8', '#ffffff'] : ['#14151a', '#1c1e25', '#23262f'];
  return [
    ...shipped.map((colour) => ({ colour, where: 'the page as it ships' })),
    ...PAGE_PALETTES.flatMap((palette) =>
      SHEETS.map((sheet) => ({
        colour: palette[theme][sheet],
        where: `${palette.label}'s ${sheet}`,
      })),
    ),
  ];
}

describe('the character palette', () => {
  it('is ten colours, each with a name of its own', () => {
    expect(CHARACTER_COLOURS).toHaveLength(10);
    expect(new Set(CHARACTER_COLOURS.map((c) => c.name)).size).toBe(10);
    expect(new Set(CHARACTER_COLOURS.map((c) => c.light)).size).toBe(10);
    expect(new Set(CHARACTER_COLOURS.map((c) => c.dark)).size).toBe(10);
  });

  it('clears WCAG AA on every paper of its own theme, on all eleven pages', () => {
    for (const colour of CHARACTER_COLOURS) {
      for (const theme of ['light', 'dark'] as const) {
        for (const paper of PAPERS[theme]) {
          const ratio = contrastRatio(colour[theme], paper.colour);
          expect(
            ratio,
            `${colour.name} (${theme}) on ${paper.where} ${paper.colour} is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(AA_CONTRAST);
        }
      }
    }
  });

  /**
   * Ten colours cannot all be distinct to everyone, so this is a floor rather
   * than a promise: no two of them, in either theme, may collapse closer than
   * this once a common colour-vision deficiency has flattened the set. The
   * palette was chosen by pushing that floor as high as it would go — it sits
   * at 0.032, and 0.030 is the line under which a change to the palette has
   * made somebody's cast harder to read.
   */
  it('keeps its colours apart under protanopia, deuteranopia and tritanopia', () => {
    const floor = 0.03;
    for (const theme of ['light', 'dark'] as const) {
      for (const kind of ['none', 'protan', 'deutan', 'tritan'] as const) {
        const seen = CHARACTER_COLOURS.map((c) => simulate(c[theme], kind));
        for (let i = 0; i < seen.length; i++) {
          for (let j = i + 1; j < seen.length; j++) {
            const apart = distance(seen[i], seen[j]);
            expect(
              apart,
              `${CHARACTER_COLOURS[i].name} and ${CHARACTER_COLOURS[j].name} are ${apart.toFixed(
                4,
              )} apart in ${theme} under ${kind}`,
            ).toBeGreaterThan(floor);
          }
        }
      }
    }
  });

  it('hands out a different one until it runs out, then wraps', () => {
    const taken: string[] = [];
    for (let i = 0; i < 10; i++) taken.push(nextColour(taken));
    expect(taken).toEqual(CHARACTER_COLOURS.map((c) => c.name));

    // The eleventh shares with the first rather than having none at all.
    expect(nextColour(taken)).toBe(CHARACTER_COLOURS[0].name);
  });

  it('skips what is taken rather than counting', () => {
    // A cast that lost its second character: the gap is what the next one gets.
    const remaining = ['ember', 'iris'];
    expect(nextColour(remaining)).toBe('jade');
  });

  it('never leaves a character without a colour to draw', () => {
    expect(paletteColour(undefined)).toBe(CHARACTER_COLOURS[0]);
    expect(paletteColour('a colour this build has never heard of')).toBe(CHARACTER_COLOURS[0]);
  });
});

describe('what a character is drawn in', () => {
  const nell = { colour: 'jade' };

  it('is the palette colour of the theme on screen', () => {
    expect(characterColour(nell, 'light')).toBe('#01685b');
    expect(characterColour(nell, 'dark')).toBe('#6de1cc');
    expect(characterColourLabel(nell)).toBe('Jade');
  });

  it('is their own colour once they have one, in both themes', () => {
    const own = { ...nell, colourOverride: '#123456' };
    expect(characterColour(own, 'light')).toBe('#123456');
    expect(characterColour(own, 'dark')).toBe('#123456');
    expect(characterColourLabel(own)).toBe('A colour of their own');

    // Dropping the override is what puts the palette back; the name was kept.
    expect(characterColour({ ...own, colourOverride: undefined }, 'dark')).toBe('#6de1cc');
  });
});

// ---------------------------------------------------------------------------
// The simulator, and the perceptual distance it is measured with
// ---------------------------------------------------------------------------

/**
 * Viénot, Brettel and Mollon's linear-RGB matrices for the three dichromacies.
 * Not an approximation of the palette's own making: these are the published
 * transforms, applied in linear light, which is where they are defined.
 */
const DICHROMACY = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
} as const;

function simulate(hex: string, kind: 'none' | keyof typeof DICHROMACY): string {
  if (kind === 'none') return hex;
  const linear = channels(hex).map(toLinear);
  const seen = DICHROMACY[kind].map(
    (row) => row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2],
  );
  return (
    '#' +
    seen
      .map((v) => Math.round(clamp(fromLinear(clamp(v))) * 255))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

/** Euclidean distance in OKLab, which is near enough uniform for a threshold. */
function distance(a: string, b: string): number {
  const one = oklab(a);
  const two = oklab(b);
  return Math.hypot(one[0] - two[0], one[1] - two[1], one[2] - two[2]);
}

function oklab(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function channels(hex: string): number[] {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
