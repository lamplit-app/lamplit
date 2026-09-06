import { ColourKey, OutboundMessage } from './models';

/**
 * Ten pages to read a chapter on, and the request that picks one.
 *
 * A palette is a preset for Preferences → Colours and nothing more: it is a
 * full set of the same custom properties that panel edits, for both themes, so
 * applying one is the handful of `setProperty` calls a hand-picked colour would
 * make. Nothing here is a new mechanism — see `theming.ts`, which puts them on
 * the page, and `styles.scss`, which declares them.
 *
 * They were not picked by eye. Each is a hue and a saturation per role — the
 * paper, the ink, the accent, the dialogue, the errors — walked towards its own
 * ink until every colour text is ever set in clears its floor against all three
 * papers of that theme. `page-palettes.spec` holds that to account, and the
 * floors are the shipped theme's own, so a palette is never a worse page to
 * read on than the one Lamplit opens with.
 *
 * That promise went false the moment #48 moved the shipped theme and left these
 * where they were, which is why the light halves and all twenty rules moved
 * again in #64. The shipped muted went from 3.35:1 to 4.86, and these stayed
 * between 3.22 and 4.27 — all ten under the 4.5 WCAG AA asks of body text, with
 * Verdant at 3.22 a page the model can choose for a reader who never opened
 * Preferences. The same walk, one floor higher: the hue and the saturation are
 * the ones each page was built with and only the lightness moved, so every page
 * is still itself, read on a muted that clears 4.5 on all three of its papers.
 * The dark halves were already over it and are untouched.
 *
 * The rules moved in both themes, and for the reason #48 gave when it moved the
 * shipped one: at 1.17 to 1.46 they were hairlines nobody can see. All twenty
 * are walked to 2:1 against their own papers, which is what the app's own face
 * is — `$palette` in `styles.scss` sits at 1.88 to 2.33 — so a page's rules are
 * drawn as firmly as the shipped ones and no more.
 *
 * `contrast` is the third of them, and it is a hole rather than a floor. The
 * stronger palette a reader who has asked for more contrast gets is `$contrast`
 * in `styles.scss`, and it is the rules and nothing else — but a preset writes
 * `--li-border` inline on <html>, and an inline style beats every rule in the
 * stylesheet, so a story with a page of its own silently lost the stronger
 * border that mode was turned on for. Of the two ways out — the presets decline
 * to say anything about the rules in a contrast mode, or they carry a stronger
 * pair of their own — this is the second: a palette is a whole page, and a page
 * with one foreign line ruled across it is not one. The names in here are the
 * names `$contrast` moves, walked to the 3:1 WCAG 1.4.11 asks of anything that
 * marks out a control. `theming.ts` is where the choice between the halves is
 * made, and #63 is where the switch that asks for it will be.
 *
 * The **tags** are the point of the table. A model never sees a colour: it is
 * given the scene, these names and what each one is for, and answers with one
 * name. So the tags are moods, settings, times and weather — the words a scene
 * is actually written in.
 */

/** A palette says something about every name; there is no half-dressed page. */
export type PaletteColours = Record<ColourKey, string>;

/**
 * And the same page with its rules turned up: only the names a contrast mode
 * moves, which is `$contrast`'s own list and is the rules alone. Everything
 * else already clears its floor, and a mode asked for legibility should not
 * repaint a page that is legible.
 */
export type ContrastColours = Partial<PaletteColours>;

export interface PagePalette {
  /** Stored in settings and on the chapter, so it is part of the file format. */
  name: string;
  label: string;
  /** One line, shown under the swatch and sent to the model. */
  description: string;
  /** What the model chooses on, and what the swatch's tooltip says. */
  tags: readonly string[];
  light: PaletteColours;
  dark: PaletteColours;
  /** What each half becomes for a reader who has asked for more contrast. */
  contrast: { light: ContrastColours; dark: ContrastColours };
}

export const PAGE_PALETTES: readonly PagePalette[] = [
  {
    name: 'frost',
    label: 'Frost',
    description: 'Snow light and blue shadow: cold rooms, open ground, clear air.',
    tags: ['cold', 'winter', 'snow', 'ice', 'north', 'mountain', 'clear', 'austere'],
    light: {
      page: '#f2f5f7',
      surface: '#fafbfc',
      'surface-raised': '#ffffff',
      border: '#9db1c5',
      ink: '#1e2429',
      'ink-soft': '#404d59',
      action: '#333d47',
      muted: '#5e7183',
      accent: '#2a73a7',
      speech: '#2d3880',
      danger: '#a53327',
    },
    dark: {
      page: '#0f141a',
      surface: '#171f27',
      'surface-raised': '#1d2832',
      border: '#40576e',
      ink: '#e1e6ea',
      'ink-soft': '#acb8c3',
      action: '#cdd4db',
      muted: '#8394a5',
      accent: '#a5cde9',
      speech: '#acb3e2',
      danger: '#e8a39c',
    },
    contrast: {
      light: { border: '#738fac' },
      dark: { border: '#557492' },
    },
  },
  {
    name: 'hearth',
    label: 'Hearth',
    description: 'Firelight on wood: small warm rooms, inns, shelter from the weather.',
    tags: ['warmth', 'candlelit', 'firelight', 'indoors', 'comfort', 'inn', 'evening', 'safety'],
    light: {
      page: '#f9f5f1',
      surface: '#fdfbfa',
      'surface-raised': '#ffffff',
      border: '#cda988',
      ink: '#2a241d',
      'ink-soft': '#5a4d3f',
      action: '#483d32',
      muted: '#7f6c59',
      accent: '#ae5929',
      speech: '#7f2f3c',
      danger: '#a72d25',
    },
    dark: {
      page: '#1d140c',
      surface: '#2b1f12',
      'surface-raised': '#372818',
      border: '#735232',
      ink: '#eae6e1',
      'ink-soft': '#c4b8ab',
      action: '#dbd4cc',
      muted: '#a79481',
      accent: '#eabea4',
      speech: '#e1adb6',
      danger: '#e9a09b',
    },
    contrast: {
      light: { border: '#b78252' },
      dark: { border: '#986c41' },
    },
  },
  {
    name: 'nocturne',
    label: 'Nocturne',
    description: 'Neon on wet streets: the city after midnight, and nobody asleep.',
    tags: ['city night', 'neon', 'rain', 'late', 'jazz', 'urban', 'insomnia', 'noir'],
    light: {
      page: '#f3f3f7',
      surface: '#fbfafc',
      'surface-raised': '#ffffff',
      border: '#aeabc9',
      ink: '#201f28',
      'ink-soft': '#454356',
      action: '#373645',
      muted: '#6e6b88',
      accent: '#ae298c',
      speech: '#217983',
      danger: '#ab2138',
    },
    dark: {
      page: '#111018',
      surface: '#191825',
      'surface-raised': '#21202f',
      border: '#504d72',
      ink: '#e3e2e9',
      'ink-soft': '#b0afc0',
      action: '#cfced9',
      muted: '#8987a1',
      accent: '#eaa4d8',
      speech: '#a5e2e9',
      danger: '#eb98a6',
    },
    contrast: {
      light: { border: '#8b87b1' },
      dark: { border: '#6b6799' },
    },
  },
  {
    name: 'tide',
    label: 'Tide',
    description: 'Salt light and deep water: coast, harbour, weather coming in.',
    tags: ['sea', 'coast', 'harbour', 'rain', 'storm', 'voyage', 'island', 'fog'],
    light: {
      page: '#f2f6f7',
      surface: '#fafcfc',
      'surface-raised': '#ffffff',
      border: '#96b4bf',
      ink: '#1f2629',
      'ink-soft': '#425157',
      action: '#354146',
      muted: '#5c727a',
      accent: '#217d7a',
      speech: '#2f4c7f',
      danger: '#a34129',
    },
    dark: {
      page: '#101719',
      surface: '#172226',
      'surface-raised': '#1e2c31',
      border: '#3f5c66',
      ink: '#e2e7e9',
      'ink-soft': '#aebcc2',
      action: '#ced6da',
      muted: '#859ba3',
      accent: '#a6e7e5',
      speech: '#adc0e1',
      danger: '#e7ac9d',
    },
    contrast: {
      light: { border: '#6893a3' },
      dark: { border: '#537987' },
    },
  },
  {
    name: 'dusk',
    label: 'Dusk',
    description: 'The last violet hour: thresholds, long goodbyes, the day going.',
    tags: ['dusk', 'twilight', 'melancholy', 'autumn', 'farewell', 'quiet', 'memory', 'longing'],
    light: {
      page: '#f5f3f7',
      surface: '#fbfafc',
      'surface-raised': '#ffffff',
      border: '#baa8c6',
      ink: '#251f29',
      'ink-soft': '#4f4257',
      action: '#3f3546',
      muted: '#7b6788',
      accent: '#8d33a3',
      speech: '#31577d',
      danger: '#a52b27',
    },
    dark: {
      page: '#151019',
      surface: '#201825',
      'surface-raised': '#291f30',
      border: '#614871',
      ink: '#e6e2e9',
      'ink-soft': '#baaec2',
      action: '#d5ceda',
      muted: '#9785a3',
      accent: '#d8aae4',
      speech: '#aec7e0',
      danger: '#e89e9c',
    },
    contrast: {
      light: { border: '#9d82ae' },
      dark: { border: '#816197' },
    },
  },
  {
    name: 'verdant',
    label: 'Verdant',
    description: 'Green light under leaves: forest, garden, everything growing.',
    tags: ['forest', 'woods', 'garden', 'spring', 'wild', 'growth', 'countryside', 'summer'],
    light: {
      page: '#f3f7f2',
      surface: '#fbfcfa',
      'surface-raised': '#ffffff',
      border: '#96ba8a',
      ink: '#21291f',
      'ink-soft': '#465742',
      action: '#384635',
      muted: '#5f7559',
      accent: '#288043',
      speech: '#896b24',
      danger: '#a33529',
    },
    dark: {
      page: '#111a0f',
      surface: '#1a2717',
      'surface-raised': '#21321d',
      border: '#43633a',
      ink: '#e3e9e2',
      'ink-soft': '#b2c2ae',
      action: '#d0dace',
      muted: '#8ba385',
      accent: '#aae4bb',
      speech: '#e7d4a6',
      danger: '#e7a49d',
    },
    contrast: {
      light: { border: '#6a995b' },
      dark: { border: '#58824c' },
    },
  },
  {
    name: 'ember',
    label: 'Ember',
    description: 'Rust and low red: heat, drought, the forge, a temper about to go.',
    tags: ['heat', 'summer afternoon', 'desert', 'drought', 'forge', 'anger', 'dust', 'fire'],
    light: {
      page: '#f9f3f0',
      surface: '#fdfbf9',
      'surface-raised': '#ffffff',
      border: '#d3a58e',
      ink: '#2c211c',
      'ink-soft': '#5d473c',
      action: '#4b3930',
      muted: '#896757',
      accent: '#b24124',
      speech: '#8c6921',
      danger: '#a9232c',
    },
    dark: {
      page: '#1d110b',
      surface: '#2c1a11',
      'surface-raised': '#392216',
      border: '#7b4930',
      ink: '#ebe4e0',
      'ink-soft': '#c7b2a8',
      action: '#ddd0ca',
      muted: '#ab8c7c',
      accent: '#ecb1a2',
      speech: '#ead2a4',
      danger: '#ea999f',
    },
    contrast: {
      light: { border: '#bf7c5a' },
      dark: { border: '#a3613f' },
    },
  },
  {
    name: 'pallor',
    label: 'Pallor',
    description: 'Grey light and bone: dread, sickness, corridors at four in the morning.',
    tags: ['dread', 'horror', 'grief', 'sickness', 'fog', 'empty', 'institution', 'unease'],
    light: {
      page: '#f4f5f6',
      surface: '#fbfbfb',
      'surface-raised': '#ffffff',
      border: '#aab0b7',
      ink: '#222326',
      'ink-soft': '#484c51',
      action: '#3a3c41',
      muted: '#6a6f77',
      accent: '#40776c',
      speech: '#51406d',
      danger: '#9f3c2d',
    },
    dark: {
      page: '#131416',
      surface: '#1c1e21',
      'surface-raised': '#24272b',
      border: '#50555e',
      ink: '#e4e5e7',
      'ink-soft': '#b3b7bc',
      action: '#d1d3d6',
      muted: '#8d939a',
      accent: '#b6d8d1',
      speech: '#c3b8d5',
      danger: '#e4a9a0',
    },
    contrast: {
      light: { border: '#868d98' },
      dark: { border: '#6a717d' },
    },
  },
  {
    name: 'gilt',
    label: 'Gilt',
    description: 'Gold on deep brown: libraries, ballrooms, ceremony, old money.',
    tags: ['opulence', 'library', 'court', 'ceremony', 'antique', 'candlelit', 'formal', 'wealth'],
    light: {
      page: '#f8f6f1',
      surface: '#fcfcfa',
      'surface-raised': '#ffffff',
      border: '#c5ad88',
      ink: '#2b261d',
      'ink-soft': '#5c513d',
      action: '#494031',
      muted: '#7d6d53',
      accent: '#896b1a',
      speech: '#823d2b',
      danger: '#a52727',
    },
    dark: {
      page: '#1b160d',
      surface: '#292114',
      'surface-raised': '#352b1a',
      border: '#6a5734',
      ink: '#ebe7e0',
      'ink-soft': '#c6bba9',
      action: '#dcd6cb',
      muted: '#a99a7e',
      accent: '#edd9a1',
      speech: '#e3b6ab',
      danger: '#e89c9c',
    },
    contrast: {
      light: { border: '#a98853' },
      dark: { border: '#8c7344' },
    },
  },
  {
    name: 'bloom',
    label: 'Bloom',
    description: 'Pink light and warm shade: love, festival, an afternoon with nothing to do.',
    tags: ['romance', 'tender', 'festival', 'joy', 'blossom', 'summer afternoon', 'youth', 'ease'],
    light: {
      page: '#f8f1f4',
      surface: '#fcfafb',
      'surface-raised': '#ffffff',
      border: '#d1a0b0',
      ink: '#291f22',
      'ink-soft': '#574249',
      action: '#46353a',
      muted: '#856570',
      accent: '#a72f6b',
      speech: '#542f7f',
      danger: '#a52f27',
    },
    dark: {
      page: '#1b0d12',
      surface: '#29141b',
      'surface-raised': '#351a23',
      border: '#7d3d52',
      ink: '#e9e2e4',
      'ink-soft': '#c2aeb4',
      action: '#daced2',
      muted: '#a3858f',
      accent: '#e6a7c7',
      speech: '#c5ade1',
      danger: '#e8a19c',
    },
    contrast: {
      light: { border: '#bc768e' },
      dark: { border: '#a7516e' },
    },
  },
];

/** The palette of that name, or nothing — which is the page as it ships. */
export function pagePalette(name: string | null | undefined): PagePalette | null {
  if (!name) return null;
  return PAGE_PALETTES.find((palette) => palette.name === name) ?? null;
}

/** What a palette is called on screen; the name itself is never shown. */
export function paletteLabel(name: string | null | undefined): string {
  return pagePalette(name)?.label ?? 'As it ships';
}

/**
 * The palettes as the model reads them: a name, what it is for, and the words a
 * scene might use. The colours are not in it — they would be two hundred hex
 * codes to no purpose, and a model asked to match a scene to a mood does it
 * better than one asked to match a scene to `#1d140c`.
 */
function paletteCatalogue(palettes: readonly PagePalette[] = PAGE_PALETTES): string {
  return palettes
    .map((p) => `- ${p.name} — ${p.description} Tags: ${p.tags.join(', ')}.`)
    .join('\n');
}

/**
 * Asked for in the prompt whether or not the endpoint enforces a schema, so the
 * fallback is the same request asked less formally rather than a different one.
 */
function paletteInstruction(palettes: readonly PagePalette[] = PAGE_PALETTES): string {
  return [
    'Choose the one palette whose mood best fits this scene.',
    'Go by what the scene feels like, not by a colour it happens to mention:',
    'a red door in a cold room is still a cold room.',
    'Answer with a JSON object and nothing else, in this shape:',
    `{"palette":"${palettes[0]?.name ?? ''}"}`,
  ].join(' ');
}

/** The shape asked for, when the endpoint will take one. */
export function paletteSchema(palettes: readonly PagePalette[] = PAGE_PALETTES): {
  name: string;
  schema: Record<string, unknown>;
} {
  return {
    name: 'page_palette',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['palette'],
      properties: { palette: { type: 'string', enum: palettes.map((p) => p.name) } },
    },
  };
}

/** The request: the scene, the catalogue, and what to do with the pair. */
export function buildPalettePrompt(
  scene: string,
  palettes: readonly PagePalette[] = PAGE_PALETTES,
): OutboundMessage[] {
  return [
    {
      role: 'system',
      content:
        'You read the opening scene of a chapter and choose the page it should be read on. You answer with JSON and nothing else.',
    },
    {
      role: 'user',
      content: [
        `The scene:\n${scene.trim()}`,
        `The palettes:\n${paletteCatalogue(palettes)}`,
        paletteInstruction(palettes),
      ].join('\n\n'),
    },
  ];
}

/**
 * The name that came back, or `''` — which changes nothing and is one line in
 * the console.
 *
 * `raw` is read as well as the parsed object because the fallback path asks an
 * endpoint that has never heard of a schema, and one of those answers with the
 * bare word about as often as it answers with the object. A name that is not in
 * the table is not a palette, however confidently it was offered.
 */
export function readPaletteName(
  value: unknown,
  raw = '',
  palettes: readonly PagePalette[] = PAGE_PALETTES,
): string {
  const named = (value as { palette?: unknown } | null)?.palette;
  if (typeof named === 'string') {
    const wanted = named.trim().toLowerCase();
    const match = palettes.find((p) => p.name === wanted);
    if (match) return match.name;
  }
  // A one-word answer, or a sentence with the word in it. Whole words only, so
  // a name is never found inside a longer one a later version adds — and the
  // first name the *answer* uses wins, not the first the table happens to
  // hold: "Tide, not Frost" is an answer of tide.
  for (const word of raw.toLowerCase().match(/[a-z]+/g) ?? []) {
    const match = palettes.find((p) => p.name === word);
    if (match) return match.name;
  }
  return '';
}
