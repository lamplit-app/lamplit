import { Injectable, computed, inject, signal } from '@angular/core';
import { ROUTES, isNewer } from '@wire';
import type { Health } from '@wire';
import { ApiClient } from './api-client';

/**
 * Which build is answering, straight from `/api/health`.
 *
 * The server is the only one that can know: the version, the commit and the CI
 * run come from the stamp written next to the built app, and `previousVersion`
 * comes from the data folder — which is the only thing that survives an
 * upgrade and can therefore say one happened.
 *
 * Read once at start-up and never again. Nothing waits for it: the app is
 * perfectly usable without knowing its own build number, so a slow or missing
 * answer costs a line in the About sheet and nothing else.
 */

/**
 * The build stamp as this store holds it: the health answer, minus the two
 * fields that are about the answer rather than the build, and with `dataDir`
 * always a string — the server leaves it out for anyone but the app on this
 * machine, and "unknown" reads better as empty than as absent.
 *
 * Derived from `Health` rather than declared beside it, so a field the server
 * starts stamping arrives here without being typed a second time.
 */
export type BuildInfo = Omit<Health, 'ok' | 'name' | 'dataDir'> & { dataDir: string };

@Injectable({ providedIn: 'root' })
export class BuildInfoStore {
  private readonly api = inject(ApiClient);
  private readonly state = signal<BuildInfo | null>(null);

  readonly info = this.state.asReadonly();
  readonly version = computed(() => this.state()?.version ?? '');

  /** `build 42 · a1b2c3d · 2026-09-03`, with whatever of it is known. */
  readonly buildLine = computed(() => {
    const info = this.state();
    if (!info) return '';
    return [
      info.build === 'local' ? 'built by hand' : `build ${info.build}`,
      info.commit,
      info.builtAt.slice(0, 10),
    ]
      .filter(Boolean)
      .join(' · ');
  });

  /**
   * True when this run is the first the writer sees of a newer version. A
   * downgrade says nothing: "what's new" would be a page about a version they
   * just left.
   */
  readonly upgradedFrom = computed(() => {
    const info = this.state();
    if (!info?.previousVersion) return null;
    return isNewer(info.version, info.previousVersion) ? info.previousVersion : null;
  });

  async load(): Promise<void> {
    try {
      const body = await this.api.json<Partial<Health>>(ROUTES.health);
      // A static host that happens to answer on that path is not this server,
      // and its answer is not a build stamp.
      if (body.name !== 'lamplit') return;
      this.state.set({
        version: body.version ?? '0.0.0',
        commit: body.commit ?? '',
        builtAt: body.builtAt ?? '',
        build: body.build ?? 'local',
        channel: body.channel ?? 'dev',
        previousVersion: body.previousVersion ?? null,
        dataDir: body.dataDir ?? '',
      });
    } catch {
      /* The About sheet says "unknown"; nothing else depends on this. */
    }
  }
}
