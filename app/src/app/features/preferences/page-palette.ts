import { Component, computed, inject, input } from '@angular/core';
import { ChapterStore } from '../../store/chapter-store';
import { SettingsStore } from '../../store/settings-store';

/** One page in miniature, as the row draws it: the tint, the sheet, the accent. */
export interface PaletteOption {
  /** The stored name; `''` is the page Lamplit ships with. */
  name: string;
  label: string;
  title: string;
  page: string;
  surface: string;
  ink: string;
  speech: string;
  accent: string;
}

/**
 * The ten pages, and the one the story is being read on.
 *
 * A preset for the swatches under it: one click sets every one of them, in
 * both themes. It is a component of its own because it is where nearly all of
 * the Colours panel's drawing was — eleven tiles, each a page in miniature —
 * and none of that is anything the swatches below it need to know about.
 *
 * The tiles are handed in already resolved, because what *As it ships* looks
 * like is a question for the stylesheet and the panel is the one holding that
 * answer. What is decided here is the click: a chapter with a page of its own
 * is the page on screen, so a click that quietly changed the story's instead
 * would look like it had done nothing at all.
 */
@Component({
  selector: 'li-page-palette',
  template: `
    <div class="row-head">
      <span class="row-name">Page palette</span>
      @if (customised()) {
        <span class="tag li-pill">custom</span>
      }
    </div>
    <p class="li-hint palette-lead">
      @if (editingChapter()) {
        <strong>Chapter {{ chapters.chapter().number }} has a page of its own.</strong> This row is
        editing that one and not the story's. The chapter keeps it when you come back to it; set it
        back to the page it ships with and the story's own is underneath.
      } @else {
        A preset for the swatches below: one click sets every one of them, in both themes. Change a
        colour afterwards and yours wins — that is what <em>custom</em> means, and Reset is the way
        out of it.
      }
    </p>

    <div class="palettes">
      @for (option of options(); track option.name) {
        <button
          type="button"
          class="palette"
          [class.on]="option.name === current()"
          [title]="option.title"
          (click)="choose(option.name)"
        >
          <span class="preview" [style.background]="option.page">
            <span class="sheet" [style.background]="option.surface">
              <span class="line" [style.background]="option.ink"></span>
              <span class="line short" [style.background]="option.speech"></span>
            </span>
            <span class="dot" [style.background]="option.accent"></span>
          </span>
          <span class="palette-label li-one-line">{{ option.label }}</span>
        </button>
      }
    </div>
  `,
  styles: `
    .row-head {
      display: flex;
      align-items: baseline;
      gap: var(--li-space-sm);
      margin: var(--li-space-md) 0 var(--li-space-xs);
    }

    /* Said rather than implied: a preset with your own colours over it is not
       that preset any more, and Reset is the only way back to one. The ring is
       the accent's, which is what tells it from the pills that only report. */
    .tag {
      border-color: color-mix(in srgb, var(--li-accent) 45%, var(--li-border));
    }

    .palette-lead {
      margin: 0 0 var(--li-space-md);
    }

    .palettes {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(5.2rem, 1fr));
      gap: var(--li-space-sm);
    }

    .palette {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: var(--li-space-xs);
      padding: var(--li-space-xs);
      border: 0;
      border-radius: var(--li-radius-md);
      background: none;
      color: var(--li-muted);
      font: inherit;
      font-size: var(--li-text-xs);
      text-align: center;
      cursor: pointer;

      &.on {
        color: var(--li-ink);
      }
    }

    /* The ring goes round the page being chosen rather than round the tile
       holding it, and it is an outline, which is drawn outside the box and
       takes no room: every preview is the same size and on the same line
       whether it is the chosen one or not. As a border on the tile it read as
       a larger, lower object than the nine beside it. */
    .palette.on .preview {
      outline: 2px solid color-mix(in srgb, var(--li-accent) 70%, transparent);
      outline-offset: 2px;
    }

    /* A page in miniature: the tint behind, a sheet on it, two lines of story
       and the accent. Enough to tell ten of them apart at a glance. */
    .preview {
      position: relative;
      display: block;
      height: 2.9rem;
      padding: var(--li-space-xs);
      border: 1px solid var(--li-border);
      border-radius: var(--li-radius-sm);
      overflow: hidden;
    }

    .sheet {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: var(--li-space-2xs);
      height: 100%;
      padding: 0 var(--li-space-xs);
      border-radius: var(--li-radius-sm);
    }

    .line {
      height: 2px;

      /* Half the height of the rule it rounds, which is what makes it a
         lozenge rather than a rectangle. Not on the radius scale: the scale's
         smallest step is larger than this whole element. */
      border-radius: 1px;
      opacity: 0.85;
    }

    .line.short {
      width: 60%;
    }

    .dot {
      position: absolute;
      right: var(--li-space-xs);
      bottom: var(--li-space-xs);
      width: 0.42rem;
      height: 0.42rem;
      border-radius: 50%;
    }
  `,
})
export class PagePalette {
  /** The tiles, drawn as the stylesheet and the presets say they are. */
  readonly options = input.required<readonly PaletteOption[]>();
  /** Which of them the story is being read on. */
  readonly current = input.required<string>();
  /** Whether a colour under the row has been set by hand: the `custom` tag. */
  readonly customised = input(false);

  private readonly settings = inject(SettingsStore);
  protected readonly chapters = inject(ChapterStore);

  /**
   * Whose page the row edits. A chapter with a palette of its own is the page
   * on screen, so a click here that quietly changed the story's instead would
   * look like it had done nothing at all.
   */
  protected readonly editingChapter = computed(() => !!this.chapters.chapter().palette);

  protected choose(name: string): void {
    if (this.editingChapter()) this.chapters.setPalette(this.chapters.chapter().id, name);
    else this.settings.setPalette(name);
  }
}
