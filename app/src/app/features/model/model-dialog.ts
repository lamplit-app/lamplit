import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatTabsModule } from '@angular/material/tabs';
import { SettingsStore } from '../../store/settings-store';
import { ConnectionForm } from './connection-form';
import { ParametersForm } from './parameters-form';

/** Opened from the model name in the bar, or as the first thing a fresh install asks. */
export interface ModelData {
  insisting: boolean;
}

/**
 * The model, and everything about how it is asked.
 *
 * The two used to be four buttons apart on the bar — the endpoint behind the
 * model name, the sampling set behind a word called *Parameters* — with nothing
 * to say they belonged together, though they are one paragraph of the same
 * `settings.json`. They are two tabs of one sheet now, and the model name in
 * the bar is the way in to both.
 *
 * The first-run sheet is the exception and has no tab strip: a sheet insisting
 * on an endpoint before the app can be used at all should not offer sampling
 * sliders beside it. It keeps its own title and the Connection form alone.
 */
@Component({
  selector: 'li-model-dialog',
  imports: [MatButtonModule, MatDialogModule, MatTabsModule, ConnectionForm, ParametersForm],
  template: `
    <h2 mat-dialog-title>{{ insisting ? 'First, somewhere to send the story' : 'Model' }}</h2>

    <mat-dialog-content>
      @if (insisting) {
        <li-connection-form insisting />
      } @else {
        <mat-tab-group [selectedIndex]="tab()" (selectedIndexChange)="tab.set($event)">
          <mat-tab label="Connection">
            <div class="tab"><li-connection-form /></div>
          </mat-tab>
          <mat-tab label="Parameters">
            <div class="tab"><li-parameters-form /></div>
          </mat-tab>
        </mat-tab-group>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      @if (insisting) {
        <!-- The app is unusable without this, and the composer says so until it
             is answered — but a modal with no way out would be worse. -->
        <button matButton mat-dialog-close>Not now</button>
      }
      <!-- The one action that belongs to a tab rather than to the sheet: there
           is nothing on Connection it could put back that the endpoint would
           still answer. -->
      @if (onParameters()) {
        <button matButton (click)="settings.resetGeneration()">Reset to defaults</button>
      }
      <button matButton="filled" mat-dialog-close [disabled]="insisting && !settings.isConnected()">
        Done
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .tab {
      display: flex;
      flex-direction: column;
      padding: var(--li-space-lg) var(--li-space-3xs) var(--li-space-xs);
    }
  `,
})
export class ModelDialog {
  protected readonly settings = inject(SettingsStore);

  /** Null when opened from the bar, which is every time but the first. */
  protected readonly insisting =
    inject<ModelData | null>(MAT_DIALOG_DATA, { optional: true })?.insisting ?? false;

  /** Connection, always, because it is the one that has to be answered first. */
  protected readonly tab = signal(0);
  protected readonly onParameters = computed(() => !this.insisting && this.tab() === 1);
}
