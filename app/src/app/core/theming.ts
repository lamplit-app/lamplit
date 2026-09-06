import { ColourKey, ReadingFont, ThemeName, UiSettings } from './models';
import { PagePalette } from './page-palettes';

/**
 * The reading palette, and the one place the page is told about it.
 *
 * Every colour the app varies between dark and light is a custom property on
 * `<html>`, declared in `styles.scss` as `light-dark(var(--li-x-light),
 * var(--li-x-dark))`. A customised colour is that property set inline on the
 * same element, which is why the whole of Preferences → Colours is a handful of
 * `setProperty` calls and why putting a colour back is `removeProperty` rather
 * than a value copied from a second list that could drift from the stylesheet.
 *
 * Nothing here invents a colour. The list is what the two themes already differ
 * on; this file only puts a label on each name and works out the contrast.
 */

export interface ColourSpec {
  key: ColourKey;
  label: string;
  /** What moves when this one moves, in the reader's words. */
  hint: string;
}

/** The order the dialog draws them in: the surfaces first, the ink after. */
export const THEME_COLOURS: readonly ColourSpec[] = [
  { key: 'page', label: 'Page', hint: 'Behind everything, including the tint at the top.' },
  { key: 'surface', label: 'Paper', hint: 'The reading surface, and every sheet over it.' },
  { key: 'surface-raised', label: 'Raised paper', hint: 'Cards and fields sitting on the paper.' },
  { key: 'border', label: 'Rules', hint: 'Every hairline: borders, dividers, message breaks.' },
  { key: 'ink', label: 'Text', hint: 'The narration, and the labels around it.' },
  { key: 'ink-soft', label: 'Your own lines', hint: 'What you wrote, set a shade back.' },
  { key: 'action', label: 'Action', hint: 'The italics: what a character does.' },
  { key: 'muted', label: 'Muted text', hint: 'Hints, token counts, the quiet furniture.' },
  { key: 'accent', label: 'Accent', hint: 'Buttons, links, and the rule beside your lines.' },
  { key: 'speech', label: 'Dialogue', hint: 'What a character says.' },
  { key: 'danger', label: 'Errors', hint: 'A turn that failed, and anything that deletes.' },
];

export interface FontChoice {
  key: ReadingFont;
  label: string;
  /** A reference to the stack already in the stylesheet; no web fonts. */
  stack: string;
  sample: string;
}

/** The first is what the app ships with; the story is set in it unless told otherwise. */
export const READING_FONTS: readonly FontChoice[] = [
  { key: 'serif', label: 'Serif', stack: 'var(--li-serif)', sample: 'The lamp was still lit.' },
  { key: 'sans', label: 'Sans-serif', stack: 'var(--li-sans)', sample: 'The lamp was still lit.' },
  { key: 'mono', label: 'Monospace', stack: 'var(--li-mono)', sample: 'The lamp was still lit.' },
];

/** The property a colour is drawn from — the one an override writes to. */
export function propertyOf(key: ColourKey): string {
  return `--li-${key}`;
}

/** The property holding what the stylesheet ships for that name in that theme. */
function shippedPropertyOf(key: ColourKey, theme: ThemeName): string {
  return `--li-${key}-${theme}`;
}

/** The property the story's own face is read from. */
export const READING_FAMILY = '--li-reading-family';

/**
 * And its size. Written here rather than on the reading column, which is where
 * it used to live: the boxes the story is written into want the same number,
 * and they are in sheets over the page rather than inside it.
 */
export const READING_SIZE = '--li-reading-size';

/**
 * Everything in Preferences that the page can see, written onto one element.
 *
 * Called from an effect, so it runs on every settings change and has to undo as
 * readily as it does: a colour that is no longer overridden must leave nothing
 * behind, or the shipped one never comes back.
 *
 * `palette` is the page the story or the chapter asked for, and it sits between
 * the stylesheet and the colours set by hand — a preset is exactly that, and a
 * swatch the reader dragged themselves beats one a table chose for them.
 *
 * A page has two halves per theme, and which one is written is the one question
 * here that is not a setting: see `wantsContrast`.
 */
export function applyUi(
  root: HTMLElement,
  ui: UiSettings,
  palette: PagePalette | null = null,
): void {
  // The whole palette hangs off `color-scheme`, so this one line is the theme.
  root.style.colorScheme = ui.theme;

  const preset = palette?.[ui.theme];
  const strong = wantsContrast(root) ? palette?.contrast[ui.theme] : undefined;
  const overrides = ui.colours[ui.theme] ?? {};
  for (const { key } of THEME_COLOURS) {
    // A colour the reader chose themselves still wins, in a contrast mode as
    // anywhere else: the stylesheet says the same thing by letting an inline
    // override beat `:root[data-contrast='high']`.
    const colour = overrides[key] || strong?.[key] || preset?.[key];
    if (colour) root.style.setProperty(propertyOf(key), colour);
    else root.style.removeProperty(propertyOf(key));
  }

  // The stylesheet already says serif. Setting it again would only mean the
  // inline style has to be read to know whether anything was chosen at all.
  const font = READING_FONTS.find((f) => f.key === ui.font);
  if (font && font !== READING_FONTS[0]) root.style.setProperty(READING_FAMILY, font.stack);
  else root.style.removeProperty(READING_FAMILY);

  // Always, unlike the face: nothing reads this back to find out whether the
  // reader chose it, and a size is a size whether or not it is the shipped one.
  root.style.setProperty(READING_SIZE, `${ui.fontSize}px`);
}

/**
 * Whether the page is being drawn at the stronger contrast — asked the two ways
 * `styles.scss` asks it, and in the same order.
 *
 * The attribute is what an accessibility panel writes (#63, where the switch
 * lives); the media query is the reader's own machine, which is the only one of
 * the two that says yes today. Both, because the stylesheet honours both, and a
 * page whose rules were chosen for a contrast mode by one door and not the
 * other is a page that disagrees with the app around it.
 *
 * This is read when the settings effect runs rather than watched, so a reader
 * who turns contrast up in Windows without touching Lamplit keeps the page's
 * ordinary rules until something else changes — the stylesheet moves at once,
 * a preset's inline border does not. #63 owns that gap: the switch it adds is a
 * setting, and a setting runs the effect.
 */
function wantsContrast(root: HTMLElement): boolean {
  if (root.dataset['contrast'] === 'high') return true;
  // Asked for rather than assumed: the element a unit test hands over has a
  // document behind it but not a browser's worth of window, and a page is not
  // worth a thrown error for the sake of a question that has a safe answer.
  const view = root.ownerDocument.defaultView;
  if (typeof view?.matchMedia !== 'function') return false;
  return view.matchMedia('(prefers-contrast: more)').matches;
}

/**
 * What the stylesheet ships for this name in this theme, as `#rrggbb`.
 *
 * Read back off the element rather than kept in a list here: `styles.scss`
 * writes `--li-page-light` and `--li-page-dark` beside every token for exactly
 * this, so the colour a reset returns to is the one the theme is built from,
 * whichever theme is on screen. Empty when there is no stylesheet attached,
 * which is every unit test — callers fall back.
 */
export function shippedColour(root: Element, key: ColourKey, theme: ThemeName): string {
  return getComputedStyle(root).getPropertyValue(shippedPropertyOf(key, theme)).trim();
}

/** WCAG 2's floor for body text. Below it the dialog warns; it never blocks. */
export const AA_CONTRAST = 4.5;

/**
 * The WCAG 2 contrast ratio between two colours, 1 to 21. NaN when either is
 * not a plain hex — the swatches always are, but a settings file is a file.
 */
export function contrastRatio(a: string, b: string): number {
  const one = luminance(a);
  const two = luminance(b);
  if (Number.isNaN(one) || Number.isNaN(two)) return NaN;
  const lighter = Math.max(one, two);
  const darker = Math.min(one, two);
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(colour: string): number {
  const rgb = parseHex(colour);
  if (!rgb) return NaN;
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb;
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** `#rgb` and `#rrggbb`, which is everything a colour input ever produces. */
function parseHex(colour: string): [number, number, number] | null {
  const hex = colour.trim().replace(/^#/, '');
  const full = hex.length === 3 ? hex.replace(/./g, (digit) => digit + digit) : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}
