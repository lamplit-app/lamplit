import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { ModelInfo, Provider } from '../../core/models';
import {
  CUSTOM_PROVIDER_ID,
  PROVIDER_GROUPS,
  ProviderPreset,
  hasFixedUrl,
  providerPreset,
} from '../../core/providers';
import { ModelClient } from '../../core/model-client';
import { errorFromThrown } from '../../core/model-errors';
import { SettingsStore } from '../../store/settings-store';

interface ModelGroup {
  label: string;
  models: ModelInfo[];
}

interface Status {
  kind: 'idle' | 'busy' | 'ok' | 'error';
  message: string;
}

const IDLE: Status = { kind: 'idle', message: '' };

/** Opened from the top bar, or as the first thing a fresh install asks. */
export interface ConnectionData {
  insisting: boolean;
}

/**
 * Provider, URL, key, model. Every change is written to settings immediately,
 * so closing the modal — however it closes — has already saved.
 */
@Component({
  selector: 'li-connection-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
  ],
  template: `
    <h2 mat-dialog-title>
      {{ insisting ? 'First, somewhere to send the story' : 'Connection' }}
    </h2>

    <mat-dialog-content>
      @if (insisting) {
        <p class="lede">
          Lamplit writes with a model of your choosing and keeps nothing of its own. Point it at an
          endpoint and pick one; the story comes next.
        </p>
      }

      <mat-form-field appearance="outline">
        <mat-label>Provider</mat-label>
        <mat-select [value]="connection().provider" (valueChange)="setProvider($event)">
          @for (group of providerGroups; track group.label) {
            <mat-optgroup [label]="group.label">
              @for (option of group.providers; track option.id) {
                <mat-option [value]="option.id">{{ option.name }}</mat-option>
              }
            </mat-optgroup>
          }
        </mat-select>
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>Endpoint URL</mat-label>
        <input
          matInput
          [value]="connection().baseUrl"
          [readonly]="urlIsFixed()"
          (input)="patch({ baseUrl: value($event) })"
          placeholder="https://host/v1"
        />
        @if (preset().note) {
          <mat-hint>{{ preset().note }}</mat-hint>
        }
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>API key</mat-label>
        <input
          matInput
          [type]="showKey() ? 'text' : 'password'"
          autocomplete="off"
          spellcheck="false"
          [value]="connection().apiKey"
          (input)="patch({ apiKey: value($event) })"
        />
        <button matIconButton matSuffix type="button" (click)="showKey.set(!showKey())">
          {{ showKey() ? '🙈' : '👁' }}
        </button>
        <mat-hint>
          Kept on this machine, in plain text.
          @if (preset().keyOptional) {
            This one works without a key.
          }
          @if (preset().keyUrl) {
            <a [href]="preset().keyUrl" target="_blank" rel="noreferrer">
              Get a key from {{ preset().name }}
            </a>
          }
        </mat-hint>
      </mat-form-field>

      @if (!preset().modelsFixed) {
        <div class="row">
          <button
            matButton="outlined"
            (click)="fetchModels()"
            [disabled]="fetchStatus().kind === 'busy'"
          >
            {{ connection().modelsCache.length ? 'Refresh models' : 'Fetch models' }}
          </button>
          @if (fetchStatus().kind === 'busy') {
            <mat-spinner diameter="18" />
          }
          <span class="status" [class.bad]="fetchStatus().kind === 'error'">
            {{ fetchStatus().message }}
          </span>
        </div>
      }

      <p class="note">
        Prefer a model that does not think before it writes: reasoning models pause first and you
        pay for the pause, which for storytelling buys little. Your provider's list says which is
        which.
      </p>

      @if (connection().modelsCache.length) {
        <mat-form-field appearance="outline">
          <mat-label>Filter models</mat-label>
          <input
            matInput
            [value]="filter()"
            (input)="filter.set(value($event))"
            placeholder="e.g. claude, gpt, 70b"
          />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Model</mat-label>
          <mat-select [value]="connection().model" (valueChange)="patch({ model: $event })">
            <!-- Without this the closed field shows the option's whole text,
                 id and all: mat-select reads the option's textContent. -->
            <mat-select-trigger>{{ selectedModelLabel() }}</mat-select-trigger>
            @for (group of groups(); track group.label) {
              <mat-optgroup [label]="group.label">
                @for (model of group.models; track model.id) {
                  <mat-option [value]="model.id">
                    {{ model.name ?? model.id }}
                    @if (model.name) {
                      <span class="mono">{{ model.id }}</span>
                    }
                  </mat-option>
                }
              </mat-optgroup>
            }
          </mat-select>
          <mat-hint>{{ matchCount() }} of {{ connection().modelsCache.length }} models</mat-hint>
        </mat-form-field>
      }

      <div class="row">
        <button
          matButton="outlined"
          (click)="test()"
          [disabled]="testStatus().kind === 'busy' || !settings.isConnected()"
        >
          Test
        </button>
        @if (testStatus().kind === 'busy') {
          <mat-spinner diameter="18" />
        }
        <span
          class="status"
          [class.good]="testStatus().kind === 'ok'"
          [class.bad]="testStatus().kind === 'error'"
        >
          {{ testStatus().message }}
        </span>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      @if (insisting) {
        <!-- The app is unusable without this, and the composer says so until it
             is answered — but a modal with no way out would be worse. -->
        <button matButton mat-dialog-close>Not now</button>
      }
      <button matButton="filled" mat-dialog-close [disabled]="insisting && !settings.isConnected()">
        Done
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .lede {
      margin: 0 0 var(--li-space-md);
      color: var(--li-muted);
      line-height: 1.5;
    }

    /* Guidance beside the choice it is about, in the hint voice rather than the lede. */
    .note {
      margin: 0 0 var(--li-space-sm);
      font-size: var(--li-text-sm);
      color: var(--li-muted);
      line-height: 1.45;
    }

    mat-dialog-content {
      display: flex;
      flex-direction: column;
      gap: var(--li-space-xs);
    }

    mat-form-field {
      width: 100%;
    }

    .row {
      display: flex;
      align-items: center;
      gap: var(--li-space-md);
      min-height: 2.5rem;
      margin-bottom: var(--li-space-xs);
    }

    /* The "get a key" link lives in a hint, and hints inherit a muted grey. */
    mat-hint a {
      color: var(--li-accent);
      white-space: nowrap;
    }

    .status {
      font-size: var(--li-text-sm);
      color: var(--li-muted);
      line-height: 1.35;
    }

    .status.good {
      color: var(--li-success);
    }

    .status.bad {
      color: var(--li-danger);
    }

    .mono {
      display: block;
      font-family: var(--li-mono);
      font-size: var(--li-text-xs);
      color: var(--li-muted);
      line-height: 1.2;
    }
  `,
})
export class ConnectionDialog {
  protected readonly settings = inject(SettingsStore);
  private readonly client = inject(ModelClient);

  /** Null when opened from the top bar, which is every time but the first. */
  protected readonly insisting =
    inject<ConnectionData | null>(MAT_DIALOG_DATA, { optional: true })?.insisting ?? false;

  protected readonly connection = this.settings.connection;
  protected readonly providerGroups = PROVIDER_GROUPS;
  protected readonly preset = computed<ProviderPreset>(() =>
    providerPreset(this.connection().provider),
  );
  protected readonly urlIsFixed = computed(() => hasFixedUrl(this.preset()));
  protected readonly showKey = signal(false);
  protected readonly filter = signal('');
  protected readonly fetchStatus = signal<Status>(IDLE);
  protected readonly testStatus = signal<Status>(IDLE);

  private readonly matches = computed(() => {
    const needle = this.filter().trim().toLowerCase();
    const models = this.connection().modelsCache;
    if (!needle) return models;
    return models.filter(
      (m) => m.id.toLowerCase().includes(needle) || (m.name ?? '').toLowerCase().includes(needle),
    );
  });

  protected readonly matchCount = computed(() => this.matches().length);

  /** The chosen model's friendly name; the id belongs in the list, not here. */
  protected readonly selectedModelLabel = computed(() => {
    const id = this.connection().model;
    return this.connection().modelsCache.find((m) => m.id === id)?.name ?? id;
  });

  /** Grouped by `owned_by`, which is how these lists are actually read. */
  protected readonly groups = computed<ModelGroup[]>(() => {
    const byOwner = new Map<string, ModelInfo[]>();
    for (const model of this.matches()) {
      const owner = model.ownedBy?.trim() || 'other';
      const bucket = byOwner.get(owner);
      if (bucket) bucket.push(model);
      else byOwner.set(owner, [model]);
    }
    // Keep the selected model reachable even when the filter excludes it.
    const selected = this.connection().model;
    if (selected && !this.matches().some((m) => m.id === selected)) {
      const known = this.connection().modelsCache.find((m) => m.id === selected);
      if (known) byOwner.set('selected', [known]);
    }
    return [...byOwner.entries()]
      .map(([label, models]) => ({ label, models }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected patch(patch: Parameters<SettingsStore['patchConnection']>[0]): void {
    this.settings.patchConnection(patch);
    this.testStatus.set(IDLE);
  }

  /**
   * Switching provider fills the URL in and empties the model list, which
   * belonged to the endpoint just left. Custom keeps whatever was typed.
   */
  protected setProvider(provider: Provider): void {
    const preset = providerPreset(provider);
    const models = preset.modelsFixed ? preset.modelsFixed.map((m) => ({ ...m })) : [];
    this.settings.patchConnection({
      provider,
      ...(provider === CUSTOM_PROVIDER_ID ? {} : { baseUrl: preset.baseUrl }),
      modelsCache: models,
      modelsFetchedAt: undefined,
      model: models.some((m) => m.id === this.connection().model) ? this.connection().model : '',
    });
    this.filter.set('');
    this.fetchStatus.set(IDLE);
    this.testStatus.set(IDLE);
  }

  protected async fetchModels(): Promise<void> {
    const { baseUrl, apiKey, provider } = this.connection();
    this.fetchStatus.set({ kind: 'busy', message: 'Asking the endpoint…' });
    try {
      const models = await this.client.listModels(baseUrl, apiKey, provider);
      this.settings.patchConnection({
        modelsCache: models,
        modelsFetchedAt: new Date().toISOString(),
      });
      this.fetchStatus.set({ kind: 'ok', message: `${models.length} models` });
    } catch (e) {
      this.fetchStatus.set({ kind: 'error', message: errorFromThrown(e).message });
    }
  }

  protected async test(): Promise<void> {
    const { baseUrl, apiKey, model, provider } = this.connection();
    this.testStatus.set({ kind: 'busy', message: 'Sending one short request…' });
    try {
      const reply = await this.client.testConnection(baseUrl, apiKey, model, provider);
      this.testStatus.set({
        kind: 'ok',
        message: reply ? `The model answered: “${reply}”` : 'The model answered.',
      });
    } catch (e) {
      this.testStatus.set({ kind: 'error', message: errorFromThrown(e).message });
    }
  }
}
