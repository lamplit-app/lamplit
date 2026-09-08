import { Component, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

/**
 * A strip across the top of the app: one line the reader has to be told, and
 * the × that answers it.
 *
 * Two things say something this way — an upgrade that happened, and a document
 * that turned out to have been written on another device — and they had written
 * the same strip twice, byte for byte: the same eight declarations for the band
 * and the same five for the dismiss, in two files, with nothing to stop a third
 * notice from getting it nearly right.
 *
 * The shape is here and what is said is projected, which is the split that
 * makes one component enough for both. A notice is a row, so whatever is put
 * inside it is a flex item of that row and lays itself out with the caller's
 * own rules — `upgrade-notice.ts` puts a link beside its sentence and styles it
 * there. The × is this component's, because it is the same button in both and
 * it is the only part that is not what the notice *says*.
 *
 * Answering it is the caller's business too: one writes a version into
 * settings, the other clears a signal, and neither is a thing a strip should
 * know. So the output is the whole of the contract.
 *
 * `role="status"` rather than an alert: both of these report something that has
 * already finished happening, and neither is worth interrupting a reader who is
 * mid-sentence. It is on the band rather than the host so that the live region
 * is the thing with the words in it.
 */
@Component({
  selector: 'li-notice',
  imports: [MatButtonModule],
  template: `
    <aside class="notice" role="status">
      <ng-content />
      <button matIconButton class="close" aria-label="Dismiss" (click)="dismissed.emit()">×</button>
    </aside>
  `,
  styles: `
    /* A custom element is inline until it is told otherwise, and this one is a
       band across the app: the workspace stacks it above the page. */
    :host {
      display: block;
    }

    .notice {
      display: flex;
      align-items: center;
      gap: var(--li-space-md);
      padding: var(--li-space-xs) var(--li-space-sm) var(--li-space-xs) var(--li-space-lg);
      border-bottom: 1px solid var(--li-border);
      background: var(--li-wash-accent-2);
      font-size: var(--li-text-md);
      color: var(--li-ink);
    }

    /* The dismiss sits at the far end, where a strip's dismiss is looked for. */
    .close {
      flex: none;
      margin-left: auto;
      font-size: var(--li-text-lg);
      line-height: var(--li-line-flush);
      color: var(--li-muted);
    }
  `,
})
export class Notice {
  /** The × was pressed. What that means is the caller's to decide. */
  readonly dismissed = output();
}
