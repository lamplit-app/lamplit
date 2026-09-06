import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Persistence } from '../store/persistence';

/**
 * One line, when a document on screen turned out to have been written
 * somewhere else and this session took that copy instead.
 *
 * It only ever appears for somebody who has turned sharing on and is using
 * their phone (Preferences → Advanced) or has a second tab open, and it says
 * what happened rather than asking anything: by the time it is on screen the
 * reloading is done. Dismissed rather than timed out, because what it is
 * really reporting is that something typed here may have gone with it, and a
 * strip that vanishes on its own is a strip somebody misses.
 */
@Component({
  selector: 'li-reload-notice',
  imports: [MatButtonModule],
  template: `
    @if (persistence.notice(); as notice) {
      <aside class="notice" role="status">
        <span class="what">{{ notice }}</span>
        <button
          matIconButton
          class="close"
          aria-label="Dismiss"
          (click)="persistence.dismissNotice()"
        >
          ×
        </button>
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

    .what {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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
export class ReloadNotice {
  protected readonly persistence = inject(Persistence);
}
