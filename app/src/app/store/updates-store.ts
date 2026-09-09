import { Injectable, computed, inject, signal } from '@angular/core';
import { ROUTES } from '@wire';
import type { Release, ReleaseAsset, UpdateReport } from '@wire';
import { ApiClient } from './api-client';

/**
 * Whether a newer Lamplit has been published, as the server found out.
 *
 * The browser does not ask GitHub: it asks the server, which asked GitHub once
 * when it started. That keeps the one outbound host this app talks to — the
 * model endpoint — the only one it talks to, and it means the desktop shell,
 * the zip and a dev server all read the same answer.
 *
 * Nothing waits for this. A missing or slow answer costs a pill in the top bar
 * and nothing else, so it is never on the path to writing anything.
 */

/**
 * The three shapes are the wire's: the server builds them and this store
 * reads them, off one description of what they are.
 */
export type { Release, ReleaseAsset, UpdateReport };

/**
 * Answered, and with nothing in it. `checked: false` is what tells the sheet
 * "still asking" from "asked, and there is nothing there".
 */
const EMPTY: UpdateReport = {
  ok: false,
  enabled: false,
  checked: false,
  version: '',
  latest: null,
  newer: [],
  releases: [],
};

@Injectable({ providedIn: 'root' })
export class UpdatesStore {
  private readonly api = inject(ApiClient);
  private readonly state = signal<UpdateReport | null>(null);
  private readonly askingState = signal(false);
  private asked: Promise<void> | null = null;

  readonly report = this.state.asReadonly();
  /** True while the first answer is on its way; the sheet says so. */
  readonly asking = this.askingState.asReadonly();

  readonly releases = computed(() => this.state()?.releases ?? []);
  readonly newer = computed(() => this.state()?.newer ?? []);

  /** The one the pill names: the newest release above what is running. */
  readonly available = computed<Release | null>(() => this.newer()[0] ?? null);

  /** Answered, and with nothing in it — offline, switched off, or unpublished. */
  readonly nothingKnown = computed(() => !!this.state() && !this.releases().length);

  /**
   * One request per session, whoever asks first. Start-up asks only when the
   * reader has left the check on; the What's new sheet asks whenever it has
   * nothing to show, because opening it *is* the reader asking.
   */
  load(): Promise<void> {
    this.asked ??= this.ask();
    return this.asked;
  }

  private async ask(): Promise<void> {
    this.askingState.set(true);
    try {
      const body = await this.api.json<Partial<UpdateReport>>(ROUTES.updates);
      this.state.set({
        ok: body.ok ?? true,
        enabled: body.enabled ?? false,
        checked: body.checked ?? false,
        version: body.version ?? '',
        latest: body.latest ?? null,
        newer: Array.isArray(body.newer) ? body.newer : [],
        releases: Array.isArray(body.releases) ? body.releases : [],
      });
    } catch {
      // An answer of "nothing" rather than no answer at all.
      this.state.set(EMPTY);
    } finally {
      this.askingState.set(false);
    }
  }
}
