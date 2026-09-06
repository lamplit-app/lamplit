import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { PARAM_RANGES } from '../../core/defaults';
import { ReasoningEffort } from '../../core/models';
import { formatTokens } from '../../core/tokens';
import { SettingsStore } from '../../store/settings-store';
import { ParamRow } from '../../shared/param-row';

/**
 * Everything that shapes a reply, in one place. The two budgets sit together
 * at the top because their relationship is the thing people get wrong.
 */
@Component({
  selector: 'li-parameters-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    ParamRow,
  ],
  template: `
    <h2 mat-dialog-title>Parameters</h2>

    <mat-dialog-content>
      <section class="budgets">
        <li-param-row
          label="Context budget"
          [hint]="budgetHint()"
          [min]="ranges.maxContextTokens.min"
          [max]="ranges.maxContextTokens.max"
          [step]="ranges.maxContextTokens.step"
          [value]="params().maxContextTokens"
          (valueChange)="patch({ maxContextTokens: $event })"
        />
        <li-param-row
          label="Reply length"
          hint="Hard ceiling on one reply, in tokens."
          [min]="ranges.maxResponseTokens.min"
          [max]="ranges.maxResponseTokens.max"
          [step]="ranges.maxResponseTokens.step"
          [value]="params().maxResponseTokens"
          (valueChange)="patch({ maxResponseTokens: $event })"
        />
      </section>

      <div class="grid">
        <li-param-row
          label="Temperature"
          hint="Low is steady and predictable, high is surprising and prone to wander."
          [min]="ranges.temperature.min"
          [max]="ranges.temperature.max"
          [step]="ranges.temperature.step"
          [value]="params().temperature"
          (valueChange)="patch({ temperature: $event })"
        />
        <li-param-row
          label="Top-p"
          hint="Keeps only the most likely words that add up to this probability."
          [min]="ranges.topP.min"
          [max]="ranges.topP.max"
          [step]="ranges.topP.step"
          [value]="params().topP"
          (valueChange)="patch({ topP: $event })"
        />
        <li-param-row
          label="Frequency penalty"
          hint="Pushes back on words it has already used a lot."
          [min]="ranges.frequencyPenalty.min"
          [max]="ranges.frequencyPenalty.max"
          [step]="ranges.frequencyPenalty.step"
          [value]="params().frequencyPenalty"
          (valueChange)="patch({ frequencyPenalty: $event })"
        />
        <li-param-row
          label="Presence penalty"
          hint="Pushes it towards subjects it has not touched yet."
          [min]="ranges.presencePenalty.min"
          [max]="ranges.presencePenalty.max"
          [step]="ranges.presencePenalty.step"
          [value]="params().presencePenalty"
          (valueChange)="patch({ presencePenalty: $event })"
        />
      </div>

      <mat-form-field appearance="outline">
        <mat-label>Stop sequences</mat-label>
        <textarea
          matInput
          [value]="stopText()"
          (change)="setStop(value($event))"
          placeholder="One per line"
        ></textarea>
        <mat-hint>Generation stops the moment one of these appears.</mat-hint>
      </mat-form-field>

      <mat-expansion-panel class="advanced">
        <mat-expansion-panel-header>
          <mat-panel-title>Advanced</mat-panel-title>
          <mat-panel-description>{{ advancedSummary() }}</mat-panel-description>
        </mat-expansion-panel-header>

        <p class="li-hint">
          Switched off means the parameter is left out of the request. Not every endpoint supports
          these; NanoGPT does.
        </p>

        <div class="grid">
          <li-param-row
            label="Top-k"
            optional
            [min]="ranges.topK.min"
            [max]="ranges.topK.max"
            [step]="ranges.topK.step"
            [value]="params().topK"
            (valueChange)="patch({ topK: $event })"
          />
          <li-param-row
            label="Min-p"
            optional
            [min]="ranges.minP.min"
            [max]="ranges.minP.max"
            [step]="ranges.minP.step"
            [value]="params().minP"
            (valueChange)="patch({ minP: $event })"
          />
          <li-param-row
            label="Repetition penalty"
            optional
            [min]="ranges.repetitionPenalty.min"
            [max]="ranges.repetitionPenalty.max"
            [step]="ranges.repetitionPenalty.step"
            [value]="params().repetitionPenalty"
            (valueChange)="patch({ repetitionPenalty: $event })"
          />
          <li-param-row
            label="Top-a"
            optional
            [min]="ranges.topA.min"
            [max]="ranges.topA.max"
            [step]="ranges.topA.step"
            [value]="params().topA"
            (valueChange)="patch({ topA: $event })"
          />
        </div>

        <div class="pair">
          <mat-form-field appearance="outline">
            <mat-label>Reasoning effort</mat-label>
            <mat-select
              [value]="params().reasoningEffort ?? 'none'"
              (valueChange)="setReasoning($event)"
            >
              <mat-option value="none">Not sent</mat-option>
              <mat-option value="low">Low</mat-option>
              <mat-option value="medium">Medium</mat-option>
              <mat-option value="high">High</mat-option>
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Seed</mat-label>
            <input
              matInput
              type="number"
              [value]="params().seed ?? ''"
              (change)="setSeed(value($event))"
              placeholder="random"
            />
            <mat-hint>Same seed and prompt, same reply.</mat-hint>
          </mat-form-field>
        </div>
      </mat-expansion-panel>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton (click)="settings.resetGeneration()">Reset to defaults</button>
      <button matButton="filled" mat-dialog-close>Done</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      max-height: var(--li-sheet-height);
    }

    /* The one Material text box, sized to its lines like the plain ones: two
       rows empty, eight at most, and scrolling past that. */
    textarea[matInput] {
      field-sizing: content;
      min-height: 2lh;
      max-height: 8lh;
      resize: none;
    }

    /* Two columns where there is room: the whole panel then fits on screen. */
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
      column-gap: 1.5rem;
    }

    .budgets {
      padding: 0.5rem 0.85rem 0.3rem;
      margin-bottom: 0.5rem;
      border: 1px solid var(--li-border);
      border-radius: 12px;
      background: color-mix(in srgb, var(--li-accent) 6%, transparent);
    }

    mat-form-field {
      width: 100%;
    }

    .advanced {
      /* The panel clips its body for its own animation, and a flex column
         squashes anything that clips when it runs out of room: it would be
         folded to nothing at the bottom rather than scrolled to. */
      flex-shrink: 0;
      margin: 0.6rem 0 0.2rem;
    }

    mat-panel-description {
      flex: none;
      color: var(--li-muted);
      font-size: 0.8rem;
    }

    .pair {
      display: flex;
      gap: 0.75rem;
      margin-top: 0.5rem;
    }
  `,
})
export class ParametersDialog {
  protected readonly settings = inject(SettingsStore);
  protected readonly params = this.settings.generation;
  protected readonly ranges = PARAM_RANGES;

  protected readonly stopText = computed(() => this.params().stop.join('\n'));

  protected readonly budgetHint = computed(() => {
    const p = this.params();
    const history = Math.max(0, p.maxContextTokens - p.maxResponseTokens);
    const budget = `Everything sent per request. ${formatTokens(history)} left for the story after reserving the reply.`;
    // The model's own figure, where the provider published one. Said here so
    // the wall is visible before it is walked into — the number is still the
    // reader's to set, and nothing below moves it for them.
    const window = this.settings.modelContextLength();
    if (!window) return budget;
    if (p.maxContextTokens > window) {
      return `${budget} This model takes ${formatTokens(window)}, so anything above that is refused.`;
    }
    return `${budget} This model takes ${formatTokens(window)}.`;
  });

  protected readonly advancedSummary = computed(() => {
    const p = this.params();
    const set = [
      p.topK !== undefined && 'top-k',
      p.minP !== undefined && 'min-p',
      p.repetitionPenalty !== undefined && 'repetition',
      p.topA !== undefined && 'top-a',
      p.reasoningEffort && p.reasoningEffort !== 'none' && 'reasoning',
      p.seed !== undefined && 'seed',
    ].filter(Boolean);
    return set.length ? `${set.join(', ')} set` : 'nothing set';
  });

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  protected patch(patch: Parameters<SettingsStore['patchGeneration']>[0]): void {
    this.settings.patchGeneration(patch);
  }

  protected setStop(text: string): void {
    const stop = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    this.patch({ stop });
  }

  protected setReasoning(effort: ReasoningEffort): void {
    this.patch({ reasoningEffort: effort === 'none' ? undefined : effort });
  }

  protected setSeed(raw: string): void {
    const parsed = Number(raw);
    this.patch({ seed: raw.trim() && Number.isFinite(parsed) ? Math.trunc(parsed) : undefined });
  }
}
