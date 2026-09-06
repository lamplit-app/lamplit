import { Component, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Persistence } from '../store/persistence';

/**
 * One dot in the top bar. It is the only place the backend is visible, and it
 * has nothing to say while everything is on disk — which is nearly always.
 * When the server goes away it becomes the button that tries again.
 *
 * There are two ways for a document not to be on disk, and they need different
 * things of the reader. "Offline" is the server not answering: wait, and do not
 * reload. "Not saved" is the server answering and refusing one document, named
 * in the tooltip: everything else is saved, and this one needs a decision.
 */
@Component({
  selector: 'li-save-status',
  imports: [MatTooltipModule],
  template: `
    @if (visible()) {
      <button
        type="button"
        class="status"
        [class.offline]="state() === 'offline'"
        [class.refused]="state() === 'refused'"
        [matTooltip]="tooltip()"
        [attr.aria-label]="label()"
        [disabled]="state() === 'saving'"
        (click)="persistence.retryNow()"
      >
        <span class="dot"></span>
        <span class="label">{{ label() }}</span>
      </button>
    }
  `,
  styles: `
    @use '../../breakpoints' as bp;

    .status {
      display: inline-flex;
      align-items: center;
      gap: var(--li-space-xs);
      padding: var(--li-space-3xs) var(--li-space-sm);
      border: 0;
      border-radius: var(--li-radius-pill);
      background: none;
      font: inherit;
      font-size: var(--li-text-sm);
      color: var(--li-muted);
      cursor: default;
    }

    .status.offline {
      color: var(--li-accent);
      cursor: pointer;
    }

    .status.offline:hover {
      background: color-mix(in srgb, var(--li-accent) 12%, transparent);
    }

    /* A refusal will not clear itself the way a missing server might. */
    .status.refused {
      color: var(--li-danger);
      cursor: pointer;
    }

    .status.refused:hover {
      background: color-mix(in srgb, var(--li-danger) 12%, transparent);
    }

    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
    }

    /* Saving is a flicker on a fast disk; fading in keeps it from strobing. */
    .status:not(.offline, .refused) .dot {
      animation: settle 0.6s ease-out;
    }

    @keyframes settle {
      from {
        opacity: 0.25;
      }
      to {
        opacity: 1;
      }
    }

    /* The first thing the bar gives up when it runs short: the word beside the
       dot, whose colour and tooltip say the same thing. */
    @include bp.without-save-label {
      .label {
        display: none;
      }
    }
  `,
})
export class SaveStatusIndicator {
  protected readonly persistence = inject(Persistence);
  protected readonly state = this.persistence.status;

  /** Nothing to report while it is simply working, which is nearly always. */
  protected readonly visible = computed(() => this.state() !== 'saved');

  protected readonly label = computed(() => {
    if (this.state() === 'offline') return 'Offline';
    return this.state() === 'refused' ? 'Not saved' : 'Saving…';
  });

  protected readonly tooltip = computed(() => {
    if (this.state() === 'offline') {
      return `${this.persistence.error() || 'The server is not answering'} — this tab still has everything and keeps retrying, but do not reload until it is back. Click to try now.`;
    }
    if (this.state() === 'refused') {
      return `${this.persistence.error() || 'The server will not take this document'} — everything else is saved. This tab still has it, so copy anything you need before reloading. Click to try again.`;
    }
    return 'Saving to disk';
  });
}
