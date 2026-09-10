import { test as base } from '@playwright/test';
import { IS_BUILT, PersistenceServer } from './persistence-server';
import {
  SCENE,
  SeedStory,
  seedConnectedSettings,
  seedDeveloperMode,
  seedStory,
  seedUi,
} from './helpers';

/** What a seeded app is, beyond the one story `seedStory` writes. */
export interface AppOptions extends SeedStory {
  /**
   * The scene the chapter is opened on, `SCENE` unless it is said otherwise.
   * The empty string is the state a chapter starts in before anyone has
   * written one: the sheet asking for it is the first thing on screen.
   */
  scene?: string;
  /** Developer mode, which the context pill and the prompt preview live behind. */
  developerMode?: boolean;
  /** Reading each reply aloud as it finishes, as the menu switch leaves it. */
  readAloud?: boolean;
  /** Generation settings other than the ones `seedConnectedSettings` writes. */
  generation?: Record<string, unknown>;
  /** Connection fields other than those: the provider row, and the model id. */
  connection?: Record<string, unknown>;
}

/**
 * A connected app with one story in it, which is where all but a handful of
 * these specs begin. `open` is the whole of it; `seed` and `visit` are the two
 * halves, for the specs that put something else on disk in between.
 */
export interface App {
  seed(options?: AppOptions): Promise<void>;
  visit(): Promise<void>;
  open(options?: AppOptions): Promise<void>;
}

/**
 * Every spec gets its own server, on its own port, with its own empty data
 * folder — and that is the whole arrangement, because it is the only one the
 * app has. There is no browser-storage mode any more and no dev server in the
 * suite: the app reads its documents from the server at startup or does not
 * start, so a test that did not have one would be testing nothing.
 *
 * A side effect worth having: each test is isolated by construction. Nothing
 * carries over, because there is nowhere for it to carry over in.
 */
export const test = base.extend<{ server: PersistenceServer; app: App }>({
  server: async ({}, use) => {
    const server = await PersistenceServer.create();
    await server.start();
    await use(server);
    await server.dispose();
  },

  app: async ({ page, server }, use) => {
    const app: App = {
      async seed({ developerMode, readAloud, generation, connection, ...story } = {}) {
        await seedConnectedSettings(server, 'test-key', generation, connection);
        // After the settings document, which they read and write back.
        if (developerMode) await seedDeveloperMode(server);
        if (readAloud) await seedUi(server, { readAloud: true });
        await seedStory(server, { scene: SCENE, ...story });
      },
      async visit() {
        await page.goto(server.url);
      },
      async open(options) {
        await app.seed(options);
        await app.visit();
      },
    };
    await use(app);
  },
});

// A skip is a kindness on a developer's machine and a lie in CI. A release
// must never go out green because the suite quietly found nothing to run.
if (process.env['CI'] && !IS_BUILT) {
  throw new Error('the app has not been built — the workflow builds it before this step');
}

test.skip(!IS_BUILT, 'the app has not been built — run `npm run e2e`, which builds it first');

export { expect } from '@playwright/test';
export type { PersistenceServer };
