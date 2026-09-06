import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { REPOSITORY } from '../core/project';
import { BuildInfoStore } from '../store/build-info';
import { SettingsStore } from '../store/settings-store';
import { DialogsService } from './dialogs.service';

/**
 * One sheet, and no settings on it: what this is, which build of it is running,
 * and the two places to go next. The build line is what makes a bug report
 * answerable — "0.1.0" stops being enough the moment two builds have carried
 * that number.
 */
@Component({
  selector: 'li-about-dialog',
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>Lamplit</h2>
    <mat-dialog-content>
      <p class="version">{{ version() }}</p>
      <p class="build">{{ build() }}</p>
      <!-- Where the stories are is a question about the machine rather than
           about the story, so it keeps developer mode's company. -->
      @if (dataDir()) {
        <p class="data">
          Documents
          <span class="path">{{ dataDir() }}</span>
        </p>
      }
      <p class="blurb">
        A writing app for stories told a chapter at a time, with a language model of your choosing.
        It runs on this machine; your stories are files you can read, copy and back up.
      </p>
      <p class="links">
        <!-- In the app rather than on GitHub: the notes of every release are
             already here, and reading them should not need a browser tab. -->
        <button type="button" class="as-link" (click)="openNotes()">Release notes</button>
        <span aria-hidden="true">·</span>
        <a [href]="issues" target="_blank" rel="noreferrer noopener">Report a problem</a>
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close cdkFocusInitial>Close</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content {
      max-width: 26rem;
    }

    p {
      margin: 0;
    }

    .version {
      font-family: var(--li-serif);
      font-size: 1.35rem;
      color: var(--li-ink);
    }

    .build {
      margin-top: 0.15rem;
      font-size: 0.82rem;
      color: var(--li-muted);
      /* A SHA and a run number are read character by character. */
      font-variant-numeric: tabular-nums;
    }

    .data {
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
      margin-top: 0.85rem;
      font-size: 0.72rem;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      color: var(--li-muted);
    }

    .path {
      font-family: var(--li-mono);
      font-size: 0.78rem;
      letter-spacing: 0;
      text-transform: none;
      color: var(--li-ink-soft);
      /* A Windows profile path is long and has nowhere natural to break. */
      overflow-wrap: anywhere;
    }

    .blurb {
      margin-top: 1.1rem;
      font-size: 0.9rem;
      line-height: 1.6;
      color: var(--li-ink-soft);
    }

    .links {
      display: flex;
      gap: 0.5rem;
      margin-top: 1.1rem;
      font-size: 0.9rem;
    }

    .links span {
      color: var(--li-muted);
    }

    .as-link {
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
      color: var(--li-accent);
      cursor: pointer;
      text-decoration: underline;
    }
  `,
})
export class AboutDialog {
  private readonly builds = inject(BuildInfoStore);
  private readonly settings = inject(SettingsStore);
  private readonly dialogs = inject(DialogsService);

  protected readonly issues = `${REPOSITORY}/issues`;

  protected openNotes(): void {
    void this.dialogs.openWhatsNew(true);
  }

  protected readonly dataDir = computed(() =>
    this.settings.ui().developerMode ? (this.builds.info()?.dataDir ?? '') : '',
  );

  protected readonly version = computed(() => {
    const info = this.builds.info();
    if (!info) return 'Version unknown';
    return `Version ${info.version}`;
  });

  protected readonly build = computed(() => {
    const info = this.builds.info();
    if (!info) return 'The server did not say which build this is.';
    const line = this.builds.buildLine();
    return info.channel === 'dev' ? `${line} · from the repository` : `${line} · ${info.channel}`;
  });
}
