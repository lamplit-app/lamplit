import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { REPOSITORY } from '../core/project';
import { BuildInfoStore } from '../store/build-info';
import { SettingsStore } from '../store/settings-store';

/**
 * One line, once, after an upgrade: this is a newer Lamplit than the one that
 * wrote these documents, and here is what changed in it.
 *
 * It shows when the server reports that the data folder was last written by an
 * older version, and stops for good when it is dismissed — the version is
 * written into settings.json, so it survives a reload and is per version rather
 * than per session. A fresh install has nothing to compare against and shows
 * nothing, which is right: there is no upgrade to report.
 */
@Component({
  selector: 'li-upgrade-notice',
  imports: [MatButtonModule],
  template: `
    @if (from()) {
      <aside class="notice" role="status">
        <span class="li-one-line">
          Lamplit was upgraded to <b>{{ builds.version() }}</b>
        </span>
        <a
          class="notes"
          [href]="notes()"
          target="_blank"
          rel="noreferrer noopener"
          (click)="dismiss()"
        >
          What’s new
        </a>
        <button matIconButton class="close" aria-label="Dismiss" (click)="dismiss()">×</button>
      </aside>
    }
  `,
  styles: `
    .notice {
      display: flex;
      align-items: center;
      gap: var(--li-space-md);
      padding: var(--li-space-xs) var(--li-space-sm) var(--li-space-xs) var(--li-space-lg);
      border-bottom: 1px solid var(--li-border);
      background: color-mix(in srgb, var(--li-accent) 12%, var(--li-surface));
      font-size: var(--li-text-md);
      color: var(--li-ink);
    }

    .notes {
      flex: none;
      color: var(--li-accent);
    }

    /* The dismiss sits at the far end, where a strip's dismiss is looked for. */
    .close {
      flex: none;
      margin-left: auto;
      font-size: var(--li-text-lg);
      line-height: 1;
      color: var(--li-muted);
    }
  `,
})
export class UpgradeNotice {
  protected readonly builds = inject(BuildInfoStore);
  private readonly settings = inject(SettingsStore);

  /** The version that wrote these documents, until this notice is answered. */
  protected readonly from = computed(() => {
    const previous = this.builds.upgradedFrom();
    if (!previous) return null;
    const acknowledged = this.settings.settings().acknowledgedVersion;
    return acknowledged === this.builds.version() ? null : previous;
  });

  protected readonly notes = computed(() => {
    const info = this.builds.info();
    if (!info || info.build === 'local') return `${REPOSITORY}/releases`;
    return `${REPOSITORY}/releases/tag/v${info.version}`;
  });

  protected dismiss(): void {
    this.settings.acknowledgeVersion(this.builds.version());
  }
}
