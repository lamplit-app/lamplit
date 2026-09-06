import { Component, booleanAttribute, computed, input, output } from '@angular/core';
import { MatSliderModule } from '@angular/material/slider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

/**
 * One tunable number: label, slider, exact value. Optional rows carry a switch
 * — off means the parameter is left out of the request entirely, which is not
 * the same as sending its default.
 */
@Component({
  selector: 'li-param-row',
  imports: [MatSliderModule, MatSlideToggleModule],
  template: `
    <div class="row" [class.off]="!active()">
      <div class="head">
        <span class="li-field-label">{{ label() }}</span>
        @if (optional()) {
          <mat-slide-toggle [checked]="active()" (change)="toggle($event.checked)" />
        }
      </div>

      <div class="controls">
        <mat-slider [min]="min()" [max]="max()" [step]="step()" [disabled]="!active()" discrete>
          <input
            matSliderThumb
            [value]="active() ? value() : fallback()"
            (valueChange)="valueChange.emit($event)"
          />
        </mat-slider>
        <!-- The name above the row belongs to the row; this box is a second
             way to set the same number and had nothing naming it at all. -->
        <input
          class="exact"
          type="number"
          [attr.aria-label]="label()"
          [min]="min()"
          [max]="max()"
          [step]="step()"
          [disabled]="!active()"
          [value]="active() ? value() : ''"
          [attr.placeholder]="active() ? null : 'not sent'"
          (change)="commitExact($event)"
        />
      </div>

      @if (hint()) {
        <p class="li-hint">{{ hint() }}</p>
      }
    </div>
  `,
  styles: `
    .row {
      padding: var(--li-space-xs) 0 var(--li-space-3xs);
    }

    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--li-space-lg);
    }

    /* Off, the name goes quiet with the box: nothing on this row is being
       sent, and the row says so before the box does. */
    .row.off .li-field-label {
      color: var(--li-muted);
    }

    .controls {
      display: flex;
      align-items: center;
      gap: var(--li-space-md);
    }

    mat-slider {
      flex: 1;
      min-width: 0;
      margin: 0;
    }

    /* The frame is the app's, from the globals; a number beside a slider
       wants only to be narrower than a box of words, and read from the right. */
    .exact {
      width: 5.5rem;
      padding: var(--li-space-xs) var(--li-space-sm);
      font-size: var(--li-text-sm);
      text-align: right;
    }

    p.li-hint {
      margin: var(--li-space-3xs) 0 0;
    }
  `,
})
export class ParamRow {
  readonly label = input.required<string>();
  readonly hint = input('');
  readonly min = input.required<number>();
  readonly max = input.required<number>();
  readonly step = input.required<number>();
  readonly value = input<number | undefined>(undefined);
  /** Optional rows can be left unset, and then are not sent at all. */
  readonly optional = input(false, { transform: booleanAttribute });

  readonly valueChange = output<number | undefined>();

  protected readonly active = computed(() => !this.optional() || this.value() !== undefined);

  /** Where an optional slider parks itself while switched off. */
  protected readonly fallback = computed(() => this.min());

  protected toggle(on: boolean): void {
    this.valueChange.emit(on ? (this.value() ?? this.defaultFor()) : undefined);
  }

  protected commitExact(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    if (raw === '') {
      if (this.optional()) this.valueChange.emit(undefined);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    this.valueChange.emit(Math.min(this.max(), Math.max(this.min(), parsed)));
  }

  /** A switched-on parameter needs a sensible starting point, not zero. */
  private defaultFor(): number {
    const midpoint = this.min() + (this.max() - this.min()) / 2;
    return Number(midpoint.toFixed(2));
  }
}
