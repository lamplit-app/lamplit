import { Component, computed, inject } from '@angular/core';
import { MatExpansionModule } from '@angular/material/expansion';
import { ContrastMode, MotionMode } from '../../core/models';
import { Field, fieldValue } from '../../shared/field';
import { SettingsStore } from '../../store/settings-store';

/**
 * Two questions the reader's own computer has already answered.
 *
 * Which is why the panel opens by saying there is nothing to do here, and why
 * neither choice has an *always animate* or an *always weaker*: the app
 * follows the machine unless it is told to be the exception, and it is never
 * told to be the exception in the direction that takes something away.
 *
 * What is written down is a setting and nothing more — `applyUi` turns it into
 * an attribute on the page and *styles.scss* has a block per state.
 */
@Component({
  selector: 'li-accessibility-panel',
  imports: [MatExpansionModule, Field],
  template: `
    <mat-expansion-panel class="li-panel">
      <mat-expansion-panel-header>
        <mat-panel-title>Accessibility</mat-panel-title>
        <mat-panel-description>{{ summary() }}</mat-panel-description>
      </mat-expansion-panel-header>

      <p class="li-hint lead">
        Lamplit already follows what your computer asks for, so there is nothing to do here unless
        this app should be the exception.
      </p>

      <div class="stack">
        <li-field
          label="Contrast"
          class="choice"
          hint="Draws every rule, box and divider more firmly. Nothing else moves."
        >
          <select (change)="setContrast(value($event))">
            @for (choice of contrasts; track choice.key) {
              <option [value]="choice.key" [selected]="choice.key === ui().contrast">
                {{ choice.label }}
              </option>
            }
          </select>
        </li-field>
        <p class="li-hint">
          <strong>Follow my computer</strong> reads Windows' <em>Contrast themes</em>, macOS'
          <em>Increase contrast</em>, or the same setting in your browser. The stronger rules clear
          the 3:1 WCAG asks of anything marking out a control; the ones Lamplit ships sit at about
          2:1, and your text is over the 4.5:1 AA asks either way — so
          <strong>always as it ships</strong> is a fair thing to choose.
        </p>

        <hr />

        <li-field
          label="Motion"
          class="choice"
          hint="Sheets, switches and the dots that show a reply coming."
        >
          <select (change)="setMotion(value($event))">
            @for (choice of motions; track choice.key) {
              <option [value]="choice.key" [selected]="choice.key === ui().motion">
                {{ choice.label }}
              </option>
            }
          </select>
        </li-field>
        <p class="li-hint">
          There is no <em>always animate</em>, and that is deliberate: nothing here moves in order
          to tell you something, so a computer asking for stillness is never overruled from this
          panel. <strong>Always still</strong> is for a computer that has no such setting, or one
          you would rather leave alone.
        </p>
      </div>
    </mat-expansion-panel>
  `,
  styles: `
    /* The box is as wide as what it holds; the note under it is not, so that a
       sentence about the choice reads across the sheet rather than down it. */
    .choice select {
      width: 18rem;
      max-width: 100%;
    }
  `,
})
export class AccessibilityPanel {
  private readonly settings = inject(SettingsStore);

  protected readonly ui = this.settings.ui;
  protected readonly value = fieldValue;

  /**
   * The three states, in the order a reader meets them: what they already have,
   * then the two ways of saying otherwise. The labels say *computer* and not
   * *system*, which is the word the rest of the app avoids.
   */
  protected readonly contrasts: readonly { key: ContrastMode; label: string }[] = [
    { key: 'system', label: 'Follow my computer' },
    { key: 'high', label: 'Always stronger' },
    { key: 'normal', label: 'Always as it ships' },
  ];

  /** Two, not three; `MotionMode` is where the missing one is accounted for. */
  protected readonly motions: readonly { key: MotionMode; label: string }[] = [
    { key: 'system', label: 'Follow my computer' },
    { key: 'reduced', label: 'Always still' },
  ];

  protected setContrast(mode: string): void {
    this.settings.patchUi({ contrast: mode as ContrastMode });
  }

  protected setMotion(mode: string): void {
    this.settings.patchUi({ motion: mode as MotionMode });
  }

  /**
   * What the folded panel says. Nothing about the machine's own answer, which
   * this cannot see through the media query and which is not a setting anybody
   * made here — the summary is what this panel has been told to do.
   */
  protected readonly summary = computed(() => {
    const ui = this.ui();
    const said: string[] = [];
    if (ui.contrast === 'high') said.push('stronger contrast');
    if (ui.contrast === 'normal') said.push('contrast as it ships');
    if (ui.motion === 'reduced') said.push('nothing moves');
    return said.length ? said.join(', ') : 'following your computer';
  });
}
