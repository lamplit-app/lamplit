import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './defaults';
import { UiSettings } from './models';
import { PAGE_PALETTES } from './page-palettes';
import {
  AA_CONTRAST,
  READING_FAMILY,
  READING_FONTS,
  THEME_COLOURS,
  THEME_CACHE_KEY,
  applyUi,
  contrastRatio,
  propertyOf,
} from './theming';

function ui(patch: Partial<UiSettings> = {}): UiSettings {
  return { ...structuredClone(DEFAULT_SETTINGS.ui), ...patch };
}

describe('contrastRatio', () => {
  it('runs from 1 to 21', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#7a7a7a', '#7a7a7a')).toBe(1);
  });

  it('does not care which colour is the lighter one', () => {
    expect(contrastRatio('#22201c', '#fffdf8')).toBeCloseTo(
      contrastRatio('#fffdf8', '#22201c'),
      10,
    );
  });

  it('reads the short form, and refuses anything that is not a hex', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 5);
    expect(contrastRatio('white', '#000000')).toBeNaN();
    expect(contrastRatio('rgb(0 0 0)', '#ffffff')).toBeNaN();
  });

  it('agrees with WCAG on the pair the dialog warns about', () => {
    // The shipped light theme: ink on paper, comfortably over the floor.
    expect(contrastRatio('#22201c', '#fffdf8')).toBeGreaterThan(AA_CONTRAST);
    // Grey on white, the classic near miss.
    expect(contrastRatio('#949494', '#ffffff')).toBeLessThan(AA_CONTRAST);
  });
});

describe('applyUi', () => {
  it('writes the theme, and only the colours that were customised', () => {
    const root = document.createElement('html');
    applyUi(root, ui({ theme: 'dark', colours: { dark: { page: '#101010' } } }), 'dark');

    expect(root.style.colorScheme).toBe('dark');
    expect(root.style.getPropertyValue(propertyOf('page'))).toBe('#101010');
    expect(root.style.getPropertyValue(propertyOf('ink'))).toBe('');
  });

  it('leaves the other theme alone, and puts a colour back when it is dropped', () => {
    const root = document.createElement('html');
    const colours = { dark: { page: '#101010' }, light: { page: '#fafafa' } };

    applyUi(root, ui({ theme: 'light', colours }), 'light');
    expect(root.style.getPropertyValue(propertyOf('page'))).toBe('#fafafa');

    // Reset is the override going away; nothing is left on the element to
    // override the stylesheet with, which is the whole of "back to default".
    applyUi(root, ui({ theme: 'light', colours: { dark: colours.dark } }), 'light');
    expect(root.style.getPropertyValue(propertyOf('page'))).toBe('');
    expect(root.style.colorScheme).toBe('light');
  });

  it('sets the reading face only when it is not the one that ships', () => {
    const root = document.createElement('html');

    applyUi(root, ui({ font: 'mono' }), 'dark');
    expect(root.style.getPropertyValue(READING_FAMILY)).toBe('var(--li-mono)');

    applyUi(root, ui({ font: 'serif' }), 'dark');
    expect(root.style.getPropertyValue(READING_FAMILY)).toBe('');
  });

  it('writes a page as it is, and its stronger rules when contrast is asked for', () => {
    const root = document.createElement('html');
    const palette = PAGE_PALETTES[0];

    applyUi(root, ui({ theme: 'light' }), 'light', palette);
    expect(root.style.getPropertyValue(propertyOf('border'))).toBe(palette.light.border);

    // The setting the accessibility panel writes; the reader's own machine is
    // the other door and is not something jsdom can be asked about.
    applyUi(root, ui({ theme: 'light', contrast: 'high' }), 'light', palette);
    expect(root.style.getPropertyValue(propertyOf('border'))).toBe(palette.contrast.light.border);
    // And it is the rules alone: the page is the page it was.
    expect(root.style.getPropertyValue(propertyOf('page'))).toBe(palette.light.page);
  });

  it('lets a rule the reader chose themselves beat the contrast half', () => {
    const root = document.createElement('html');
    const colours = { light: { border: '#ff0000' } };
    applyUi(root, ui({ theme: 'light', contrast: 'high', colours }), 'light', PAGE_PALETTES[0]);

    expect(root.style.getPropertyValue(propertyOf('border'))).toBe('#ff0000');
  });

  /**
   * The attribute is the whole of what the stylesheet is told: it has a block
   * per state and no way of reading a setting, so what is asserted here is that
   * each state is spelled the way `styles.scss` spells it — and that following
   * the machine is the attribute gone, because a `data-contrast` of any value
   * would stop the media query being the thing that answers.
   */
  it('says which contrast and which motion, and says nothing when it follows the machine', () => {
    const root = document.createElement('html');

    applyUi(root, ui({ contrast: 'high', motion: 'reduced' }), 'dark');
    expect(root.dataset['contrast']).toBe('high');
    expect(root.dataset['motion']).toBe('reduced');

    applyUi(root, ui({ contrast: 'normal' }), 'dark');
    expect(root.dataset['contrast']).toBe('normal');
    expect(root.dataset['motion']).toBeUndefined();

    applyUi(root, ui(), 'dark');
    expect(root.dataset['contrast']).toBeUndefined();
    expect(root.dataset['motion']).toBeUndefined();
  });

  /**
   * A page's rules are written inline, and inline beats every block in the
   * stylesheet — so "always as it ships" has to be answered here as well, or a
   * reader whose machine asks for contrast would keep a preset's stronger
   * hairlines after saying they did not want them.
   */
  it('declines the stronger rules when the reader has asked it to', () => {
    const root = document.createElement('html');
    const palette = PAGE_PALETTES[0];

    applyUi(root, ui({ theme: 'light', contrast: 'normal' }), 'light', palette);
    expect(root.style.getPropertyValue(propertyOf('border'))).toBe(palette.light.border);
  });

  /**
   * Following the machine is the property *not written*, exactly as following
   * it is an absent `data-contrast` above: `styles.scss` declares both schemes
   * on <html>, so an inline `color-scheme` is the only thing that can overrule
   * `prefers-color-scheme`, and the way to stop overruling it is to take the
   * inline one away.
   *
   * The theme is handed in either way. `system` is not a set of colours — the
   * overrides, the palette halves and a character's pair are all written under
   * one of the two names — so what a page in that state is drawn from is
   * whichever of them the machine landed on.
   */
  it('says which theme, and says nothing when it follows the machine', () => {
    const root = document.createElement('html');
    const colours = { dark: { page: '#101010' }, light: { page: '#fafafa' } };

    applyUi(root, ui({ theme: 'system', colours }), 'dark');
    expect(root.style.colorScheme).toBe('');
    expect(root.style.getPropertyValue(propertyOf('page'))).toBe('#101010');

    // The same setting, the same call, a machine that has changed its mind.
    applyUi(root, ui({ theme: 'system', colours }), 'light');
    expect(root.style.colorScheme).toBe('');
    expect(root.style.getPropertyValue(propertyOf('page'))).toBe('#fafafa');

    // And choosing a side puts it back.
    applyUi(root, ui({ theme: 'dark', colours }), 'dark');
    expect(root.style.colorScheme).toBe('dark');
  });

  /**
   * The one thing the app leaves in the browser, and what it is for: the page
   * is drawn before `settings.json` arrives from the server, so the next load
   * of it reads this and starts in the right colour. `public/boot-theme.js` is
   * the reader, and the key is written down in both places.
   */
  it('leaves the chosen theme where the next first frame can find it', () => {
    const root = document.createElement('html');

    applyUi(root, ui({ theme: 'light' }), 'light');
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBe('light');

    applyUi(root, ui({ theme: 'dark' }), 'dark');
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBe('dark');

    // Nothing, rather than the answer it happens to have landed on: the
    // stylesheet is already right for a reader following the machine, and a
    // remembered answer would pin the app to the theme the desktop has left.
    applyUi(root, ui({ theme: 'system' }), 'dark');
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBeNull();
  });

  it('ignores a name it does not know, rather than writing it out', () => {
    const root = document.createElement('html');
    const colours = { dark: { page: '#101010', gilding: '#c0a060' } } as UiSettings['colours'];
    applyUi(root, ui({ theme: 'dark', colours }), 'dark');

    expect(root.style.getPropertyValue(propertyOf('page'))).toBe('#101010');
    expect(root.style.getPropertyValue('--li-gilding')).toBe('');
  });
});

describe('the palette', () => {
  it('names every colour once, and every font stack points at the stylesheet', () => {
    const keys = THEME_COLOURS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const font of READING_FONTS) expect(font.stack).toMatch(/^var\(--li-[a-z]+\)$/);
  });
});
