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
        <span class="label">{{ label() }}</span>
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
        <input
          class="exact"
          type="number"
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

    .label {
      font-size: var(--li-text-md);
      color: var(--li-ink);
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

    .exact {
      width: 5.5rem;
      padding: var(--li-space-xs) var(--li-space-sm);
      border: 1px solid var(--li-border);
      border-radius: var(--li-radius-md);
      background: var(--li-surface-raised);
      color: var(--li-ink);
      font: inherit;
      font-size: var(--li-text-sm);
      text-align: right;
    }

    .exact:disabled {
      color: var(--li-muted);
    }

    .row.off .label {
      color: var(--li-muted);
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
