import { Component, computed, inject } from '@angular/core';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSliderModule } from '@angular/material/slider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { SPEECH_RATE } from '../../core/defaults';
import { ReadingFont, ThemeMode } from '../../core/models';
import { READING_FONTS } from '../../core/theming';
import { Field, fieldValue } from '../../shared/field';
import { ReadAloud } from '../../chrome/read-aloud';
import { SettingsStore } from '../../store/settings-store';

/**
 * How the story looks, and how it sounds.
 *
 * The panel the top bar's menu used to be, and the one that opens on arrival:
 * the theme, the size and the face the story is set in, and the voice that
 * reads it. Everything here is one field of `ui`, so there is nothing to this
 * component but the controls and the labels — which is the whole reason the
 * four panels are four files.
 */
@Component({
  selector: 'li-reading-panel',
  imports: [MatExpansionModule, MatSliderModule, MatSlideToggleModule, Field],
  template: `
    <mat-expansion-panel expanded class="li-panel">
      <mat-expansion-panel-header>
        <mat-panel-title>Reading</mat-panel-title>
        <mat-panel-description>{{ summary() }}</mat-panel-description>
      </mat-expansion-panel-header>

      <div class="stack">
        <!-- Three choices rather than a switch, and worded like the two under
             Accessibility, because it is the same kind of answer: what the
             reader's computer already says, and the two ways of saying
             otherwise here. -->
        <li-field
          label="Theme"
          class="choice"
          hint="The page, the paper and everything drawn on them."
        >
          <select (change)="setTheme(value($event))">
            @for (choice of themes; track choice.key) {
              <option [value]="choice.key" [selected]="choice.key === ui().theme">
                {{ choice.label }}
              </option>
            }
          </select>
        </li-field>

        <mat-slide-toggle
          [checked]="ui().bookStyleDialogue"
          (change)="settings.patchUi({ bookStyleDialogue: $event.checked })"
        >
          Dialogue on its own line
        </mat-slide-toggle>
        <mat-slide-toggle
          [checked]="ui().showTokenCounts"
          (change)="settings.patchUi({ showTokenCounts: $event.checked })"
        >
          Show token counts
        </mat-slide-toggle>
        <label class="size">
          Text size
          <mat-slider min="14" max="26" step="1" discrete>
            <input
              matSliderThumb
              [value]="ui().fontSize"
              (valueChange)="settings.patchUi({ fontSize: $event })"
            />
          </mat-slider>
        </label>

        <!-- The other half of how the story is set, beside the size of it.
             It lived under Colours, which is where the page is chosen and
             not where the story is set. -->
        <li-field
          label="Reading font"
          class="choice"
          hint="The story itself, not the app around it."
        >
          <select (change)="setFont(value($event))">
            @for (font of fonts; track font.key) {
              <option [value]="font.key" [selected]="font.key === ui().font">
                {{ font.label }}
              </option>
            }
          </select>
        </li-field>

        <!-- Read aloud. The device's own voices and nothing sent anywhere,
             so the list is whatever this machine happens to ship with —
             which is why the choice is stored by name and a phone that has
             never heard of it simply reads in its own. -->
        @if (speech.supported) {
          <hr />
          <div class="li-setting">
            <mat-slide-toggle
              [checked]="ui().readAloud"
              (change)="settings.patchUi({ readAloud: $event.checked })"
            >
              Read replies aloud
            </mat-slide-toggle>
            <p class="li-hint">
              Each reply is read as it finishes. Any message can be read on its own from its
              <strong>⋯</strong> menu without this being on.
            </p>
          </div>

          <li-field
            label="Voice"
            class="choice"
            hint="The voices this machine has. Nothing is sent anywhere to read."
          >
            <select (change)="settings.patchUi({ voice: value($event) })">
              <option value="" [selected]="!ui().voice">This device's default</option>
              @for (voice of speech.voices(); track voice.name) {
                <option [value]="voice.name" [selected]="voice.name === ui().voice">
                  {{ voice.name }} · {{ voice.lang }}
                </option>
              }
            </select>
          </li-field>

          <label class="size">
            Reading speed
            <mat-slider
              [min]="rate.min"
              [max]="rate.max"
              [step]="rate.step"
              discrete
              [displayWith]="rateLabel"
            >
              <input
                matSliderThumb
                [value]="ui().speechRate"
                (valueChange)="settings.patchUi({ speechRate: $event })"
              />
            </mat-slider>
          </label>
        }
      </div>
    </mat-expansion-panel>
  `,
  styles: `
    .size {
      display: flex;
      flex-direction: column;
      font-size: var(--li-text-sm);
      color: var(--li-muted);
    }

    /* A box as wide as the words in it and no wider, for the three questions
       on this panel that are answered by choosing rather than by dragging.
       The same name and the same width as the two under Accessibility. */
    .choice {
      width: 18rem;
      max-width: 100%;
    }
  `,
})
export class ReadingPanel {
  protected readonly settings = inject(SettingsStore);
  protected readonly speech = inject(ReadAloud);

  protected readonly ui = this.settings.ui;
  protected readonly fonts = READING_FONTS;

  /**
   * The three, in the order a reader meets them: what they already have, then
   * the two ways of saying otherwise. *Computer* rather than *system*, which is
   * the word the rest of the app avoids — the same labels the contrast and
   * motion rows use.
   */
  protected readonly themes: readonly { key: ThemeMode; label: string }[] = [
    { key: 'system', label: 'Follow my computer' },
    { key: 'dark', label: 'Always dark' },
    { key: 'light', label: 'Always light' },
  ];
  protected readonly rate = SPEECH_RATE;
  protected readonly value = fieldValue;

  /** `1.15x`, and `1x` rather than `1.00x` for the pace the voice ships with. */
  protected readonly rateLabel = (value: number) => `${Number(value.toFixed(2))}x`;

  protected readonly summary = computed(() => {
    const ui = this.ui();
    // The face only when it is not the one the app ships in, which is the same
    // test `applyUi` makes before it writes the property at all.
    const font = READING_FONTS.find((f) => f.key === ui.font);
    const face = font && font !== READING_FONTS[0] ? `, ${font.label.toLowerCase()}` : '';
    const aloud = ui.readAloud ? ', read aloud' : '';
    // Following the machine says the theme it landed on and that it is not a
    // choice made here, which is what the folded panel is for: the answer, and
    // where it came from.
    const theme =
      ui.theme === 'system'
        ? `${this.settings.theme()} theme from your computer`
        : `${ui.theme} theme`;
    return `${theme}, ${ui.fontSize}px${face}${aloud}`;
  });

  /** A select hands back a string; these three are the whole of what it can be. */
  protected setFont(font: string): void {
    this.settings.patchUi({ font: font as ReadingFont });
  }

  /** And the same for the theme's three. */
  protected setTheme(theme: string): void {
    this.settings.patchUi({ theme: theme as ThemeMode });
  }
}
