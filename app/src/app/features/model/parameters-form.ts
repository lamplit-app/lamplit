import { Component, computed, inject } from '@angular/core';
import { MatExpansionModule } from '@angular/material/expansion';
import { PARAM_RANGES } from '../../core/defaults';
import { ReasoningEffort } from '../../core/models';
import { formatTokens } from '../../core/tokens';
import { SettingsStore } from '../../store/settings-store';
import { Field, fieldValue } from '../../shared/field';
import { ParamRow } from '../../shared/param-row';

const EFFORTS: { value: ReasoningEffort; label: string }[] = [
  { value: 'none', label: 'Not sent' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

/**
 * Everything that shapes a reply, in one place. The two budgets sit together
 * at the top because their relationship is the thing people get wrong.
 *
 * The body alone: the Parameters tab of the Model sheet. Reset to defaults and
 * Done are the sheet's, because a tab has no actions row of its own.
 */
@Component({
  selector: 'li-parameters-form',
  imports: [MatExpansionModule, Field, ParamRow],
  template: `
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

    <li-field label="Stop sequences" hint="Generation stops the moment one of these appears.">
      <textarea
        class="li-rows-short"
        [value]="stopText()"
        (change)="setStop(value($event))"
        placeholder="One per line"
      ></textarea>
    </li-field>

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
        <li-field label="Reasoning effort">
          <select (change)="setReasoning(effort(value($event)))">
            @for (option of efforts; track option.value) {
              <option
                [value]="option.value"
                [selected]="option.value === (params().reasoningEffort ?? 'none')"
              >
                {{ option.label }}
              </option>
            }
          </select>
        </li-field>

        <li-field label="Seed" class="seed" hint="Same seed and prompt, same reply.">
          <input
            type="number"
            [value]="params().seed ?? ''"
            (change)="setSeed(value($event))"
            placeholder="random"
          />
        </li-field>
      </div>
    </mat-expansion-panel>
  `,
  styles: `
    /* The stack the rows make, which used to be the sheet's own content box. */
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--li-space-2xs);
    }

    /* Two columns where there is room: the whole panel then fits on screen. */
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
      column-gap: var(--li-space-xl);
    }

    .budgets {
      padding: var(--li-space-sm) var(--li-space-md) var(--li-space-xs);
      margin-bottom: var(--li-space-sm);
      border: 1px solid var(--li-border);
      border-radius: var(--li-radius-lg);
      background: color-mix(in srgb, var(--li-accent) 6%, transparent);
    }

    .advanced {
      /* The panel clips its body for its own animation, and a flex column
         squashes anything that clips when it runs out of room: it would be
         folded to nothing at the bottom rather than scrolled to. */
      flex-shrink: 0;
      margin: var(--li-space-sm) 0 var(--li-space-2xs);
    }

    mat-panel-description {
      flex: none;
      color: var(--li-muted);
      font-size: var(--li-text-sm);
    }

    .pair {
      display: flex;
      gap: var(--li-space-md);
      margin-top: var(--li-space-sm);
    }

    /* Half the row each: a field is as wide as it is given, and neither of
       these two has a width of its own to fall back on. */
    .pair > * {
      flex: 1;
      min-width: 0;
    }
  `,
})
export class ParametersForm {
  private readonly settings = inject(SettingsStore);
  protected readonly params = this.settings.generation;
  protected readonly ranges = PARAM_RANGES;
  protected readonly efforts = EFFORTS;

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

  protected readonly value = fieldValue;

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

  /** A select hands back a string; these four are the whole of what it can be. */
  protected effort(value: string): ReasoningEffort {
    return value as ReasoningEffort;
  }

  protected setReasoning(effort: ReasoningEffort): void {
    this.patch({ reasoningEffort: effort === 'none' ? undefined : effort });
  }

  protected setSeed(raw: string): void {
    const parsed = Number(raw);
    this.patch({ seed: raw.trim() && Number.isFinite(parsed) ? Math.trunc(parsed) : undefined });
  }
}
