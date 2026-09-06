import { describe, expect, it } from 'vitest';
import {
  PAGE_PALETTES,
  buildPalettePrompt,
  pagePalette,
  paletteLabel,
  paletteSchema,
  readPaletteName,
} from './page-palettes';
import { THEME_COLOURS, contrastRatio } from './theming';

/**
 * A palette is a claim — a whole page, in both themes, that a story can be read
 * on — and this is the claim being checked rather than restated.
 *
 * The floors are the shipped theme's own, as it actually ships. Its text sits at
 * 13:1 on its paper, its muted furniture at 4.86 to 6.04 and its rules at 1.88
 * to 2.33, so muted is held to the 4.5 WCAG AA asks of body text — which the
 * shipped one clears — and a rule to 1.88, which is the shipped rule on the
 * paper it is weakest against. A palette under either would be a page Lamplit
 * does not otherwise offer.
 *
 * Both numbers are what #64 cost. The muted floor was 3.2, quoted from a
 * shipped theme two commits gone, and it let all ten light halves sit under
 * WCAG AA; under the rules there was no floor at all, which is how twenty of
 * them came to be hairlines between 1.17 and 1.46.
 */

/** Every surface text is ever set on, and the roles that are set on them. */
const SHEETS = ['page', 'surface', 'surface-raised'] as const;
const FLOORS = {
  ink: 8,
  'ink-soft': 4.5,
  action: 4.5,
  accent: 4.5,
  speech: 4.5,
  danger: 4.5,
  muted: 4.5,
} as const;

/**
 * A rule is not text, and the shipped theme is the whole of the argument for
 * this number: #48 measured that a border clearing the 3:1 of WCAG 1.4.11 is a
 * different-looking app — every box an outlined rectangle — and settled at
 * about 2:1, leaning on the label above each field and the focus ring to say
 * "control". So this is not what WCAG asks; it is what Lamplit's own face is.
 */
const RULE = 1.88;

/** And what 1.4.11 does ask, which is what the contrast half is for. */
const STRONG_RULE = 3;

describe('the page palettes', () => {
  it('is ten pages, each named and described once', () => {
    expect(PAGE_PALETTES).toHaveLength(10);
    expect(new Set(PAGE_PALETTES.map((p) => p.name)).size).toBe(10);
    expect(new Set(PAGE_PALETTES.map((p) => p.label)).size).toBe(10);
    for (const palette of PAGE_PALETTES) {
      expect(palette.name).toMatch(/^[a-z]+$/);
      expect(palette.description.length).toBeGreaterThan(20);
      expect(palette.tags.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('says something about every colour the panel edits, in both themes', () => {
    for (const palette of PAGE_PALETTES) {
      for (const theme of ['light', 'dark'] as const) {
        for (const { key } of THEME_COLOURS) {
          expect(palette[theme][key], `${palette.name}/${theme}/${key}`).toMatch(/^#[0-9a-f]{6}$/);
        }
      }
    }
  });

  it('clears WCAG AA for body text on every paper of both themes', () => {
    for (const palette of PAGE_PALETTES) {
      for (const theme of ['light', 'dark'] as const) {
        for (const [key, floor] of Object.entries(FLOORS)) {
          for (const sheet of SHEETS) {
            const ratio = contrastRatio(
              palette[theme][key as keyof typeof FLOORS],
              palette[theme][sheet],
            );
            expect(
              ratio,
              `${palette.name} ${theme}: ${key} on ${sheet} is ${ratio.toFixed(2)}:1`,
            ).toBeGreaterThanOrEqual(floor);
          }
        }
      }
    }
  });

  it('draws its rules no fainter than the shipped theme draws its own', () => {
    for (const palette of PAGE_PALETTES) {
      for (const theme of ['light', 'dark'] as const) {
        for (const sheet of SHEETS) {
          const ratio = contrastRatio(palette[theme].border, palette[theme][sheet]);
          expect(
            ratio,
            `${palette.name} ${theme}: border on ${sheet} is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(RULE);
        }
      }
    }
  });

  it('has a contrast half, and it moves the rules and nothing else', () => {
    for (const palette of PAGE_PALETTES) {
      for (const theme of ['light', 'dark'] as const) {
        const strong = palette.contrast[theme];
        // The names `$contrast` moves, and only those: a mode asked for
        // legibility should not repaint a page that is already legible.
        expect(Object.keys(strong), `${palette.name} ${theme}`).toEqual(['border']);
        for (const sheet of SHEETS) {
          const ratio = contrastRatio(strong.border!, palette[theme][sheet]);
          expect(
            ratio,
            `${palette.name} ${theme}: contrast border on ${sheet} is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(STRONG_RULE);
        }
      }
    }
  });

  it('is ten different pages, not one page ten times', () => {
    for (const theme of ['light', 'dark'] as const) {
      // The paper, the quiet text on it and the rules across it: two of the
      // three moved in #64, and each is still ten answers rather than one.
      for (const key of ['page', 'muted', 'border'] as const) {
        const values = PAGE_PALETTES.map((p) => p[theme][key]);
        expect(new Set(values).size, `${theme} ${key}`).toBe(values.length);
      }
    }
  });
});

describe('the request', () => {
  it('offers the model the names, and nothing but the names', () => {
    const schema = paletteSchema();
    const property = (schema.schema['properties'] as { palette: { enum: string[] } }).palette;
    expect(property.enum).toEqual(PAGE_PALETTES.map((p) => p.name));
  });

  it('carries the scene, every palette and what each one is for', () => {
    const [system, user] = buildPalettePrompt('  A lighthouse gallery. Dusk.  ');
    expect(system.role).toBe('system');
    expect(user.content).toContain('A lighthouse gallery. Dusk.');
    for (const palette of PAGE_PALETTES) {
      expect(user.content).toContain(palette.name);
      expect(user.content).toContain(palette.tags[0]);
    }
    // The colours are the one thing it never sees.
    expect(user.content).not.toContain('#');
  });
});

describe('reading the answer', () => {
  it('takes the name out of the object a schema produces', () => {
    expect(readPaletteName({ palette: 'frost' })).toBe('frost');
    expect(readPaletteName({ palette: ' Frost ' })).toBe('frost');
  });

  it('takes a bare word out of an endpoint that never saw the schema', () => {
    expect(readPaletteName(null, 'nocturne')).toBe('nocturne');
    expect(readPaletteName(null, 'The scene is cold, so: frost.')).toBe('frost');
  });

  it('takes the name the answer leads with, not the first one in the table', () => {
    // Frost is earlier in the table than Tide, and beside the point here.
    expect(readPaletteName(null, 'Tide. Not frost.')).toBe('tide');
    expect(readPaletteName(null, 'hearth, not frost')).toBe('hearth');
  });

  it('refuses a name that is not one of ours, however confidently offered', () => {
    expect(readPaletteName({ palette: 'moonlight' }, 'moonlight')).toBe('');
    expect(readPaletteName(null, 'frostbite')).toBe('');
    expect(readPaletteName(undefined, '')).toBe('');
  });
});

describe('looking one up', () => {
  it('knows the ones it has and admits to the ones it does not', () => {
    expect(pagePalette('tide')?.label).toBe('Tide');
    expect(pagePalette('')).toBeNull();
    expect(pagePalette(undefined)).toBeNull();
    // A name from a later version, in a document this build opened.
    expect(pagePalette('gaslight')).toBeNull();
    expect(paletteLabel('gaslight')).toBe('As it ships');
  });
});
