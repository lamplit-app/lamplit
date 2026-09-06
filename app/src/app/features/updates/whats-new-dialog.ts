import { Component, computed, inject } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { renderMarkdown } from '../../core/formatting';
import { REPOSITORY, WEBSITE } from '../../core/project';
import { BuildInfoStore } from '../../store/build-info';
import { Release, UpdatesStore } from '../../store/updates-store';

export interface WhatsNewData {
  /** True from About, where the point is to read notes with nothing pending. */
  all: boolean;
}

/** Unversioned on purpose, so this link keeps pointing at the newest one. */
const ZIP = `${REPOSITORY}/releases/latest/download/Lamplit.zip`;

/**
 * The release notes, newest first, as they were written for the release.
 *
 * Opened from the pill in the top bar, where it shows what is newer than the
 * running version, and from About, where it shows everything — the notes are
 * worth reading without an update pending.
 *
 * The sheet asks the server for the list if nobody has yet, whatever the
 * start-up check is set to: opening it *is* the reader asking.
 */
@Component({
  selector: 'li-whats-new-dialog',
  imports: [MatButtonModule, MatDialogModule, MatProgressSpinnerModule],
  template: `
    <h2 mat-dialog-title>{{ heading() }}</h2>

    <mat-dialog-content>
      @if (releases().length) {
        <p class="li-hint running">You are running {{ running() }}.</p>

        @for (release of releases(); track release.tag) {
          <article class="release">
            <header>
              <span class="version">{{ release.name || release.version }}</span>
              @if (published(release); as when) {
                <span class="when">{{ when }}</span>
              }
            </header>
            @if (notes(release); as html) {
              <div class="li-prose notes" [innerHTML]="html"></div>
            } @else {
              <p class="li-hint empty">This release was published without notes.</p>
            }
            <a class="source" [href]="release.url" target="_blank" rel="noreferrer noopener">
              On GitHub
            </a>
          </article>
        }

        <section class="how">
          <h3>{{ howHeading() }}</h3>
          <p>{{ how() }}</p>
          @if (channel() !== 'desktop') {
            <p class="links">
              @if (channel() === 'zip') {
                <a [href]="zip" target="_blank" rel="noreferrer noopener">Download the zip</a>
                <span aria-hidden="true">·</span>
              }
              <a [href]="website" target="_blank" rel="noreferrer noopener">Every download</a>
            </p>
          }
        </section>
      } @else if (updates.asking()) {
        <p class="waiting">
          <mat-spinner diameter="18" />
          Asking GitHub which versions there are…
        </p>
      } @else {
        <p class="li-hint">{{ nothing() }}</p>
        <p class="links">
          <a [href]="releasesPage" target="_blank" rel="noreferrer noopener">
            The releases, on GitHub
          </a>
        </p>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton="filled" mat-dialog-close cdkFocusInitial>Done</button>
    </mat-dialog-actions>
  `,
  styles: `
    .running {
      margin: 0 0 var(--li-space-md);
    }

    .release {
      margin: 0 0 var(--li-space-md);
      padding: var(--li-space-md);
      border: 1px solid var(--li-border);
      border-radius: var(--li-radius-lg);
      background: var(--li-surface-raised);
    }

    header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--li-space-lg);
      margin-bottom: var(--li-space-xs);
    }

    .version {
      font-family: var(--li-serif);
      font-size: var(--li-text-lg);
      color: var(--li-ink);
    }

    .when {
      flex: none;
      font-size: var(--li-text-xs);
      color: var(--li-muted);
      font-variant-numeric: tabular-nums;
    }

    /* Release notes are ordinary markdown: the shapes come from .li-prose in
       the globals, the same base the story is set with, and all this says is
       what they are set in — a note on a card rather than the reading page. */
    .notes {
      font-size: var(--li-text-md);
      line-height: 1.6;
      color: var(--li-ink-soft);
    }

    /* Smaller than the notes above it and set below them, which is enough to
       make it the aside it is. It was --li-muted, and a link the colour of a
       hint is a link nobody tries. */
    .source {
      display: inline-block;
      margin-top: var(--li-space-sm);
      font-size: var(--li-text-sm);
      color: var(--li-accent);
    }

    .empty {
      margin: 0;
    }

    .how {
      margin-top: var(--li-space-lg);
      padding: var(--li-space-md);
      border: 1px solid color-mix(in srgb, var(--li-accent) 45%, var(--li-border));
      border-radius: var(--li-radius-lg);
      background: color-mix(in srgb, var(--li-accent) 7%, transparent);
    }

    h3 {
      margin: 0 0 var(--li-space-xs);
      font-family: var(--li-serif);
      font-size: var(--li-text-lg);
      font-weight: 600;
      color: var(--li-ink);
    }

    .how p {
      margin: 0;
      font-size: var(--li-text-md);
      line-height: 1.55;
      color: var(--li-ink-soft);
    }

    /* Named by its element as well as its class: the rule for a paragraph of
       the how above is a class and an element, and a lone class loses to it. */
    p.links {
      display: flex;
      gap: var(--li-space-sm);
      margin-top: var(--li-space-sm);
      font-size: var(--li-text-md);
    }

    .links a {
      color: var(--li-accent);
    }

    .links span {
      color: var(--li-muted);
    }

    .waiting {
      display: flex;
      align-items: center;
      gap: var(--li-space-sm);
      margin: 0;
      font-size: var(--li-text-md);
      color: var(--li-muted);
    }
  `,
})
export class WhatsNewDialog {
  protected readonly data = inject<WhatsNewData>(MAT_DIALOG_DATA);
  protected readonly updates = inject(UpdatesStore);
  private readonly builds = inject(BuildInfoStore);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly zip = ZIP;
  protected readonly website = WEBSITE;
  protected readonly releasesPage = `${REPOSITORY}/releases`;

  constructor() {
    // Nothing yet means nobody has asked — including a reader who turned the
    // start-up check off and then opened this on purpose.
    void this.updates.load();
  }

  protected readonly releases = computed(() =>
    this.data.all ? this.updates.releases() : this.updates.newer(),
  );

  protected readonly channel = computed(() => this.builds.info()?.channel ?? 'dev');

  protected readonly running = computed(() => this.builds.version() || 'an unknown version');

  protected readonly heading = computed(() =>
    this.data.all || !this.updates.newer().length ? 'Release notes' : 'What’s new',
  );

  protected readonly howHeading = computed(() =>
    this.updates.newer().length ? 'Getting it' : 'When there is a new one',
  );

  protected readonly how = computed(() => {
    switch (this.channel()) {
      case 'desktop':
        return 'The desktop app downloads the update on its own and installs it the next time you quit Lamplit. There is nothing to do.';
      case 'zip':
        return 'Unzip the new version beside this one and carry your data folder across — Upgrading in the guide has the two lines for it. Your stories are not inside the app.';
      default:
        return 'This copy runs from the repository: git pull, npm install, npm run build.';
    }
  });

  protected readonly nothing = computed(() => {
    const report = this.updates.report();
    if (report && !report.enabled) {
      return 'Lamplit has not asked: the version check is switched off in Preferences → Advanced. The notes are on GitHub.';
    }
    return 'Lamplit could not reach GitHub to read the release notes. They are on the releases page, which needs no app to read.';
  });

  protected notes(release: Release) {
    const html = renderMarkdown(release.body);
    return html ? this.sanitizer.bypassSecurityTrustHtml(html) : null;
  }

  /** The date alone: the time a release was cut is nobody's business. */
  protected published(release: Release): string {
    if (!release.publishedAt) return '';
    const when = new Date(release.publishedAt);
    return Number.isNaN(when.getTime()) ? '' : when.toISOString().slice(0, 10);
  }
}
