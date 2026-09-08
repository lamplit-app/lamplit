import { Character, ThemeName } from './models';

/**
 * A colour per character, so a cast can be told apart without reading a word.
 *
 * Ten of them, each written twice: a dark ink for the light papers and a light
 * one for the dark papers. They were not picked by eye. Each pair clears WCAG
 * AA on every paper of its own theme — the three the app ships and the three of
 * each of the ten pages in `page-palettes`, because this is the one colour set
 * that is not a `--li-*` token and so the one a palette repaints the paper
 * under and leaves where it is — they sit in a narrow band of lightness so no
 * one of them shouts, and the hues were chosen by maximising the smallest gap
 * between any two of them once protanopia, deuteranopia and tritanopia have
 * each been simulated over the set — which is why the greens and the teals are
 * not evenly spaced round the wheel. `character-colours.spec` holds all three
 * of those to account.
 *
 * Ten colours cannot all be distinct to everyone: with red-green vision the
 * closest pair is a real pair, and the palette's job was to make the *worst*
 * pair as good as it can be rather than to pretend the problem away.
 *
 * The order is the order they are handed out in, and it walks the wheel rather
 * than going round it: the first four characters in a story should look nothing
 * like each other, and going round would make them all warm.
 */
export interface CharacterColour {
  /** Stored on the character, so it is part of the file format. */
  name: string;
  /** What a swatch is called, for anyone who cannot see it. */
  label: string;
  light: string;
  dark: string;
}

export const CHARACTER_COLOURS: readonly [CharacterColour, ...CharacterColour[]] = [
  { name: 'ember', label: 'Ember', light: '#ac4c39', dark: '#f09885' },
  { name: 'jade', label: 'Jade', light: '#01685b', dark: '#6de1cc' },
  { name: 'iris', label: 'Iris', light: '#6d50a3', dark: '#c7b0fd' },
  { name: 'moss', label: 'Moss', light: '#526f00', dark: '#acd06c' },
  { name: 'rose', label: 'Rose', light: '#9c3e60', dark: '#f89fbb' },
  { name: 'tide', label: 'Tide', light: '#007376', dark: '#47c8cc' },
  { name: 'amber', label: 'Amber', light: '#9c5700', dark: '#ffba7e' },
  { name: 'cobalt', label: 'Cobalt', light: '#3a6db8', dark: '#a9cbfe' },
  { name: 'fern', label: 'Fern', light: '#3b723d', dark: '#9acb9a' },
  { name: 'orchid', label: 'Orchid', light: '#925097', dark: '#e2a5e5' },
];

/** The palette entry of that name, or the first — never nothing. */
export function paletteColour(name: string | undefined): CharacterColour {
  return CHARACTER_COLOURS.find((c) => c.name === name) ?? CHARACTER_COLOURS[0];
}

/**
 * The next colour to hand out: the first one nobody in this story has.
 *
 * Past the tenth character the palette wraps rather than refusing, because a
 * cast of eleven is a real cast and two of them sharing a colour is a smaller
 * problem than one of them having none.
 */
export function nextColour(taken: readonly (string | undefined)[]): string {
  const free = CHARACTER_COLOURS.find((c) => !taken.includes(c.name));
  return (
    free ??
    CHARACTER_COLOURS[taken.length % CHARACTER_COLOURS.length] ??
    CHARACTER_COLOURS[0]
  ).name;
}

/**
 * What a character is drawn in, as `#rrggbb`.
 *
 * A colour of their own, set under Preferences, beats the palette — it is one
 * colour rather than two, because somebody who went looking for a colour input
 * had a particular colour in mind and not a pair of them.
 */
export function characterColour(
  character: Pick<Character, 'colour' | 'colourOverride'>,
  theme: ThemeName,
): string {
  return character.colourOverride?.trim() || paletteColour(character.colour)[theme];
}

/** What to call it: the palette's name, or that it is no longer one of them. */
export function characterColourLabel(
  character: Pick<Character, 'colour' | 'colourOverride'>,
): string {
  return character.colourOverride?.trim()
    ? 'A colour of their own'
    : paletteColour(character.colour).label;
}
