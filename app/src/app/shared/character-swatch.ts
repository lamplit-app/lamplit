import { Component, computed, inject, input, output, viewChild } from '@angular/core';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  CHARACTER_COLOURS,
  characterColour,
  characterColourLabel,
} from '../core/character-colours';
import { Character } from '../core/models';
import { SettingsStore } from '../store/settings-store';

/**
 * The dot beside a character's name, and the ten it can be changed to.
 *
 * There is no colour input here on purpose. The point of a curated palette is
 * that every choice in it reads on both papers and against the other nine; an
 * input beside them would be an invitation to undo all of that with one drag.
 * Somebody who wants a particular colour can still have it — under Preferences
 * → Colours, where the rest of the app's colours are, and where it is clearly
 * a decision rather than the default path.
 */
@Component({
  selector: 'li-character-swatch',
  imports: [MatMenuModule, MatTooltipModule],
  template: `
    <button
      type="button"
      class="dot"
      [style.background]="colour()"
      [matMenuTriggerFor]="menu"
      [attr.aria-label]="label()"
      matTooltip="Change their colour"
    ></button>

    <mat-menu #menu="matMenu">
      <div class="grid">
        @for (choice of palette; track choice.name) {
          <button
            type="button"
            class="choice"
            [class.on]="choice.name === character().colour && !character().colourOverride"
            [style.background]="choice[theme()]"
            [attr.aria-label]="choice.label"
            [attr.aria-pressed]="choice.name === character().colour"
            [matTooltip]="choice.label"
            (click)="choose(choice.name)"
          ></button>
        }
      </div>
    </mat-menu>
  `,
  styles: `
    :host {
      display: contents;
    }

    .dot {
      flex: none;
      width: 11px;
      height: 11px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      cursor: pointer;
    }

    .dot:hover,
    .dot:focus-visible {
      box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 25%, transparent);
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(5, 1.4rem);
      gap: var(--li-space-xs);
      padding: var(--li-space-sm);
    }

    .choice {
      width: 1.4rem;
      height: 1.4rem;
      padding: 0;
      border: 2px solid transparent;
      border-radius: 50%;
      cursor: pointer;
    }

    /* The one it already is, ringed in the paper it sits on so the ring reads
       as a gap rather than as an eleventh colour. */
    .choice.on {
      box-shadow:
        0 0 0 2px var(--li-surface),
        0 0 0 4px var(--li-ink-soft);
    }

    .choice:hover,
    .choice:focus-visible {
      border-color: var(--li-ink-soft);
    }
  `,
})
export class CharacterSwatch {
  readonly character = input.required<Character>();
  /** The palette name that was chosen. */
  readonly pick = output<string>();

  protected readonly palette = CHARACTER_COLOURS;
  private readonly settings = inject(SettingsStore);
  private readonly trigger = viewChild.required(MatMenuTrigger);

  protected readonly theme = computed(() => this.settings.ui().theme);
  protected readonly colour = computed(() => characterColour(this.character(), this.theme()));

  protected readonly label = computed(
    () =>
      `${this.character().name || 'This character'} is ${characterColourLabel(this.character())}. Change it.`,
  );

  protected choose(name: string): void {
    this.pick.emit(name);
    this.trigger().closeMenu();
  }
}
