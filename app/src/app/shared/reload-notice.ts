import { Component, inject } from '@angular/core';
import { Notice } from './notice';
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
 *
 * The strip is `li-notice`, which the upgrade notice draws too. What is left
 * here is when there is one, what it says, and what answering it does.
 */
@Component({
  selector: 'li-reload-notice',
  imports: [Notice],
  template: `
    @if (persistence.notice(); as notice) {
      <li-notice (dismissed)="persistence.dismissNotice()">
        <span class="li-one-line">{{ notice }}</span>
      </li-notice>
    }
  `,
})
export class ReloadNotice {
  protected readonly persistence = inject(Persistence);
}
