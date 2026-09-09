import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { characterColour, characterColourLabel } from '../../core/character-colours';
import { ColourKey } from '../../core/models';
import { PAGE_PALETTES, paletteLabel } from '../../core/page-palettes';
import {
  AA_CONTRAST,
  THEME_COLOURS,
  contrastRatio,
  shippedColour,
  wantsContrast,
} from '../../core/theming';
import { Dialogs } from '../../dialogs';
import { fieldValue } from '../../shared/field';
import { ChapterStore } from '../../store/chapter-store';
import { SettingsStore } from '../../store/settings-store';
import { StoryStore } from '../../store/story-store';
import { PagePalette } from './page-palette';

/** One of the pairs the panel has an opinion about. */
interface Pair {
  /** For the template's `track`, and nothing else. */
  key: string;
  /** Drawn on `back`; both of them are swatches on this sheet. */
  front: ColourKey;
  back: ColourKey;
  /** What the pair is, to open the sentence with. */
  of: string;
  /** Why it matters, to close it with. */
  because: string;
}

/**
 * The two pairs, in the order the panel gives them.
 *
 * Text on paper is the story itself, and it is the pair a reader dragging
 * either swatch can watch themselves ruin. The second cannot be seen from this
 * sheet at all: `styles.scss` hands Material `--mat-sys-on-primary:
 * var(--li-page)`, so the label of a filled button is the page colour drawn on
 * the accent, and Send, Done and Delete are set in a pair no swatch here names.
 * It ships at 5.78:1 in the light theme and 7.84 in the dark, and it held while
 * both halves of it were the app's — Page is a swatch now, and a mid-tone one
 * takes every filled button in the app with it, on sheets the reader is not
 * looking at.
 *
 * Of the two ways to answer that — a pair for `on-primary` that is safe on any
 * page, or the panel saying so — this is the second, because there is no such
 * pair: every colour the app could alias it to is a swatch on this sheet too.
 */
const PAIRS: readonly Pair[] = [
  {
    key: 'story',
    front: 'ink',
    back: 'surface',
    of: 'Text on paper',
    because: 'this is the one pair the whole story is read in',
  },
  {
    key: 'buttons',
    front: 'page',
    back: 'accent',
    of: "A filled button's label",
    because: 'Send, Done and Delete are the page colour drawn on the accent',
  },
];

/**
 * Every colour the story is read in, and the two opinions the app has about
 * them.
 *
 * Three layers, in the order the panel shows them: the page as it ships,
 * a preset over that — which is `li-page-palette` next door — and a colour set
 * by hand over that, which is what *custom* means and what Reset undoes. The
 * cast's colours are last because they belong to the story rather than to the
 * app, but this is where colours are changed, so this is where somebody comes
 * looking for them.
 *
 * The opinions are the contrast warnings, and `PAIRS` above is the whole of
 * them. They are the only place the app has one about a choice the reader made,
 * and they warn rather than block: somebody deliberately setting a low-contrast
 * page is allowed to.
 */
@Component({
  selector: 'li-colours-panel',
  imports: [MatButtonModule, MatExpansionModule, PagePalette],
  template: `
    <mat-expansion-panel class="li-panel">
      <mat-expansion-panel-header>
        <mat-panel-title>Colours</mat-panel-title>
        <mat-panel-description>{{ summary() }}</mat-panel-description>
      </mat-expansion-panel-header>

      <li-page-palette
        [options]="paletteOptions()"
        [current]="currentPalette()"
        [customised]="customised()"
      />

      <p class="li-hint editing">
        You are editing the <strong>{{ theme() }}</strong> theme. Switch it under
        <strong>Reading</strong> — or on your computer, while the theme is following it — and the
        other set is edited instead; each keeps its own colours.
      </p>

      <div class="swatches">
        <!-- An odd number of colours in two columns leaves one of them
             beside an empty cell; the last one takes the row instead. -->
        @for (swatch of swatches(); track swatch.key) {
          <label
            class="swatch"
            [class.custom]="swatch.custom"
            [class.wide]="$last && $count % 2 === 1"
          >
            <input type="color" [value]="swatch.colour" (input)="setColour(swatch.key, $event)" />
            <span class="text">
              <span class="name">{{ swatch.label }}</span>
              <span class="li-hint">{{ swatch.hint }}</span>
            </span>
          </label>
        }
      </div>

      @for (warning of contrastWarnings(); track warning.key) {
        <p class="warning li-warning" role="status">{{ warning.text }}</p>
      }

      <div class="reset">
        <button matButton [disabled]="!customised()" (click)="reset()">
          Reset the {{ theme() }} colours
        </button>
      </div>

      @if (cast().length) {
        <hr />
        <p class="li-hint editing">
          <strong>The cast of {{ stories.story().title }}.</strong> Each one has a colour from the
          palette, and the swatch beside their name in the chapter panel is the way to another of
          the ten. Below is the way out of the ten altogether — one colour, used in both themes, and
          yours to keep legible.
        </p>

        <div class="swatches">
          @for (character of cast(); track character.id) {
            <label class="swatch" [class.custom]="!!character.colourOverride">
              <input
                type="color"
                [value]="character.colour"
                (input)="setCharacterColour(character.id, $event)"
              />
              <span class="text">
                <span class="name">{{ character.name || 'Unnamed character' }}</span>
                <span class="li-hint">{{ character.label }}</span>
              </span>
              @if (character.colourOverride) {
                <button
                  matButton
                  class="revert"
                  (click)="clearCharacterColour($event, character.id)"
                >
                  Back to the palette
                </button>
              }
            </label>
          }
        </div>
      }
    </mat-expansion-panel>
  `,
  styles: `
    /* The two sentences either side of a grid of swatches: which theme is
       being edited, and whose cast is below — and the one word in each that
       the reader is looking for. */
    .editing {
      margin: var(--li-space-lg) 0 var(--li-space-md);
    }

    .editing strong {
      color: var(--li-ink);
      font-weight: 600;
    }

    .swatches {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
      gap: var(--li-space-xs) var(--li-space-lg);
    }

    /* Started rather than centred, and this is the whole of why: two
       swatches share a grid row, the hint under one of them wraps onto a
       second line and the other does not, and centring puts the two names ten
       pixels apart down a column that is meant to read as a column. */
    .swatch {
      display: flex;
      align-items: flex-start;
      gap: var(--li-space-md);
      padding: var(--li-space-xs) var(--li-space-sm);
      border: 1px solid transparent;
      border-radius: var(--li-radius-md);
      cursor: pointer;

      /* The app's quiet row tint: a swatch is a row you press. */
      &:hover {
        background: var(--li-tint-1);
      }

      /* A changed colour says so, so that Reset is not the only way to tell. */
      &.custom {
        border-color: var(--li-edge-accent);
      }

      &.wide {
        grid-column: 1 / -1;
      }
    }

    /* The native picker, with the browser's chrome around it pared back to a
       swatch: it is the only control here that is not Material's. */
    input[type='color'] {
      flex: none;
      width: 2.4rem;
      height: 2.4rem;
      padding: 0;
      /* Muted rather than the app's own border, which is the one place that
         rule does not hold. Page, Paper and Raised paper are within 1.2:1 of
         the paper a swatch is drawn on, and Rules is that border itself, so
         the ring is the whole of what says a swatch is there — and at 2:1 it
         left four of the eleven reading as empty boxes. Muted is over 5:1 on
         either paper, which is the contrast it is picked for everywhere
         else. */
      border: 1px solid var(--li-muted);
      border-radius: var(--li-radius-md);
      background: none;
      cursor: pointer;

      &::-webkit-color-swatch-wrapper {
        padding: 3px;
      }

      &::-webkit-color-swatch {
        border: none;
        border-radius: var(--li-radius-sm);
      }

      &::-moz-color-swatch {
        border: none;
        border-radius: var(--li-radius-sm);
      }
    }

    .text {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    /* A colour's own name, over the sentence saying what it moves. One size up
       from the hint under it, which is what makes it the name of the row. */
    .name {
      font-size: var(--li-text-md);
      color: var(--li-ink);
    }

    /* Both pairs can be under at once, and two warnings with nothing between
       them read as one paragraph that has lost its way. */
    .warning + .warning {
      margin-top: var(--li-space-sm);
    }

    .reset {
      display: flex;
      justify-content: flex-end;
      margin-top: var(--li-space-md);
    }

    .revert {
      flex: none;
      font-size: var(--li-text-xs);
    }
  `,
})
export class ColoursPanel {
  private readonly settings = inject(SettingsStore);
  protected readonly stories = inject(StoryStore);
  private readonly chapters = inject(ChapterStore);
  private readonly dialogs = inject(Dialogs);

  protected readonly ui = this.settings.ui;

  /**
   * The theme whose colours this panel edits, which is the one on screen and
   * not the one in the settings file: with the theme following the machine
   * there is no `system` set of overrides to write to, and the reader is
   * looking at one of the two.
   */
  protected readonly theme = this.settings.theme;

  /**
   * Whether the page is at the stronger contrast. Over a computed of the one
   * setting rather than over `ui()` itself, so that dragging a swatch does not
   * ask the machine the same question sixty times a second.
   */
  private readonly contrastMode = computed(() => this.ui().contrast);
  private readonly stronger = computed(() =>
    wantsContrast(document.documentElement, this.contrastMode()),
  );

  /**
   * What the stylesheet ships, for both themes.
   *
   * Only one thing moves these while the dialog is open, and it is on this
   * sheet: a contrast mode has a stronger set of rules, and a swatch showing
   * the other one would be offering the reader a colour the page is not drawn
   * in — and a Reset that returned somewhere the swatch had not said. So this
   * is a computed over that one question, and recomputes exactly when the
   * answer to it changes rather than on every drag of every other swatch.
   */
  private readonly shipped = computed(() => {
    const stronger = this.stronger();
    return new Map(
      THEME_COLOURS.flatMap(({ key }) =>
        (['dark', 'light'] as const).map(
          (theme) =>
            [
              `${theme}/${key}`,
              shippedColour(document.documentElement, key, theme, stronger),
            ] as const,
        ),
      ),
    );
  });

  /** Which page the story is being read on: the chapter's own, or the story's. */
  protected readonly currentPalette = computed(
    () => this.chapters.chapter().palette || this.ui().palette,
  );

  /** The presets, with the page as it ships in front of them. */
  protected readonly paletteOptions = computed(() => {
    const theme = this.theme();
    const shipped = (key: ColourKey) => this.shipped().get(`${theme}/${key}`) || '#000000';
    return [
      {
        name: '',
        label: 'As it ships',
        title: 'The page Lamplit opens with.',
        page: shipped('page'),
        surface: shipped('surface'),
        ink: shipped('ink'),
        speech: shipped('speech'),
        accent: shipped('accent'),
      },
      ...PAGE_PALETTES.map((palette) => ({
        name: palette.name,
        label: palette.label,
        title: `${palette.description} ${palette.tags.join(', ')}.`,
        page: palette[theme].page,
        surface: palette[theme].surface,
        ink: palette[theme].ink,
        speech: palette[theme].speech,
        accent: palette[theme].accent,
      })),
    ];
  });

  /** The open story's cast, each with the colour the input should show. */
  protected readonly cast = computed(() => {
    const theme = this.theme();
    return this.stories.story().characters.map((character) => ({
      ...character,
      colour: characterColour(character, theme),
      label: characterColourLabel(character),
    }));
  });

  protected setCharacterColour(id: string, event: Event): void {
    this.stories.setCharacterColourOverride(id, fieldValue(event));
  }

  /** The label wraps the input, so a click on the button would open it too. */
  protected clearCharacterColour(event: Event, id: string): void {
    event.preventDefault();
    this.stories.setCharacterColourOverride(id, null);
  }

  /** Each colour as the page draws it now: the override, or the shipped one. */
  protected readonly swatches = computed(() => {
    const theme = this.theme();
    const overrides = this.ui().colours[theme] ?? {};
    return THEME_COLOURS.map((spec) => ({
      ...spec,
      custom: !!overrides[spec.key],
      // Black is the last resort of a stylesheet that is not attached, which
      // outside a unit test does not happen; a colour input needs *some* hex.
      colour: overrides[spec.key] || this.shipped().get(`${theme}/${spec.key}`) || '#000000',
    }));
  });

  /** A colour set by hand: the state the palette row calls `custom`. */
  protected readonly customised = computed(() => this.swatches().some((s) => s.custom));

  protected readonly summary = computed(() => {
    const changed = this.swatches().filter((s) => s.custom).length;
    if (changed) return `${changed} changed in ${this.theme()}`;
    return this.currentPalette()
      ? paletteLabel(this.currentPalette()).toLowerCase()
      : 'as it ships';
  });

  /**
   * Whichever of the two pairs the reader has put out of reach. Warnings and
   * not blocks: someone deliberately setting a low-contrast palette is allowed
   * to, they just should not do it by accident.
   *
   * Silent about a colour it cannot read — a settings file is a file, and
   * `NaN:1` on the sheet would be worse than saying nothing.
   */
  protected readonly contrastWarnings = computed(() => {
    const swatches = this.swatches();
    const colour = (key: ColourKey) => swatches.find((s) => s.key === key)?.colour ?? '';
    return PAIRS.flatMap((pair) => {
      const ratio = contrastRatio(colour(pair.front), colour(pair.back));
      if (Number.isNaN(ratio) || ratio >= AA_CONTRAST) return [];
      return [
        {
          key: pair.key,
          text:
            `${pair.of} is ${ratio.toFixed(1)}:1, under the ${AA_CONTRAST}:1 that WCAG AA asks ` +
            `of body text. Nothing stops you — but ${pair.because}.`,
        },
      ];
    });
  });

  protected setColour(key: ColourKey, event: Event): void {
    const colour = fieldValue(event);
    this.settings.setColour(this.theme(), key, colour);
  }

  protected async reset(): Promise<void> {
    const theme = this.theme();
    const ok = await this.dialogs.confirm({
      title: `Put the ${theme} colours back?`,
      message: `Every colour you have changed in the ${theme} theme returns to the one underneath — the palette you picked, or what Lamplit ships. The other theme keeps yours.`,
      confirm: 'Reset',
    });
    if (ok) this.settings.resetColours(theme);
  }
}
