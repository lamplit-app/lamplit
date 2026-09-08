import { Component, computed, inject } from '@angular/core';
import { Notice } from './notice';
import { REPOSITORY } from '../core/project';
import { BuildInfoStore } from '../store/build-info-store';
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
 *
 * The strip is `li-notice`, which the reload notice draws too. This one puts a
 * link beside its sentence — projected into the strip, so the rule below still
 * reaches it — and reading the notes counts as an answer to the notice.
 */
@Component({
  selector: 'li-upgrade-notice',
  imports: [Notice],
  template: `
    @if (from()) {
      <li-notice (dismissed)="dismiss()">
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
      </li-notice>
    }
  `,
  styles: `
    .notes {
      flex: none;
      color: var(--li-accent);
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
