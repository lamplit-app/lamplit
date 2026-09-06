import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Persistence } from '../store/persistence';

/**
 * What there is to show when the server did not answer: nothing, honestly.
 *
 * The stories live on disk and the app is a window onto them, so without the
 * server there is nothing to read and nowhere to put what you write. Better to
 * say so than to open an empty app that looks like a fresh install and quietly
 * loses the next hour's work.
 */
@Component({
  selector: 'li-no-server',
  imports: [MatButtonModule],
  template: `
    <div class="panel">
      <h1>Lamplit cannot reach its server</h1>
      <p>
        Your stories are files on this machine, and the small server that reads them is not
        answering. Nothing is lost — it is all still on disk.
      </p>
      <p class="how">
        Start it with <code>npm start</code> from the repository, or <code>start.bat</code> /
        <code>start.sh</code> from an unpacked copy, and then try again.
      </p>
      @if (persistence.error(); as reason) {
        <p class="reason">{{ reason }}</p>
      }
      <button matButton="filled" [disabled]="trying()" (click)="retry()">
        {{ trying() ? 'Trying…' : 'Try again' }}
      </button>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      padding: var(--li-space-xl);
    }

    .panel {
      max-width: 34rem;
      text-align: center;
    }

    h1 {
      font-family: var(--li-serif);
      font-size: var(--li-text-xl);
      font-weight: 500;
      margin: 0 0 var(--li-space-lg);
      color: var(--li-ink);
    }

    p {
      color: var(--li-muted);
      line-height: 1.6;
      margin: 0 0 var(--li-space-md);
    }

    code {
      font-family: var(--li-mono);
      font-size: 0.85em;
      color: var(--li-ink);
    }

    .reason {
      font-family: var(--li-mono);
      font-size: var(--li-text-sm);
      color: var(--li-danger);
      margin-bottom: var(--li-space-xl);
    }

    .how {
      margin-bottom: var(--li-space-xl);
    }
  `,
})
export class NoServer {
  protected readonly persistence = inject(Persistence);
  protected readonly trying = signal(false);

  protected async retry(): Promise<void> {
    this.trying.set(true);
    // A reload rather than carrying on in place: the stores read their
    // documents once, at construction, and this component exists precisely
    // because that has not happened yet.
    if (await this.persistence.retryLoad()) location.reload();
    this.trying.set(false);
  }
}
