import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { APP_SRC, appSpecifier, importFromApp } from '../lib/app-source.mjs';

/** A file inside the app, as a parent URL arrives at a resolve hook. */
const inTheApp = (path) => `${APP_SRC}${path}`;

describe('the specifier a tool hands Node for the app', () => {
  const parent = inTheApp('app/core/providers.ts');

  it('puts back the extension the app leaves off', () => {
    assert.equal(appSpecifier('./project', parent), './project.ts');
    assert.equal(appSpecifier('../store/documents', parent), '../store/documents.ts');
  });

  it('leaves a specifier that already carries one alone', () => {
    assert.equal(appSpecifier('./project.ts', parent), './project.ts');
    assert.equal(appSpecifier('../shared/icon.svg', parent), '../shared/icon.svg');
  });

  it('leaves every package alone, which is all the tool imports for itself', () => {
    assert.equal(appSpecifier('@playwright/test', parent), '@playwright/test');
    assert.equal(appSpecifier('node:path', parent), 'node:path');
  });

  // The hook is process-wide. A relative import in Playwright, in the server or
  // in another tool has to come back out of it exactly as it went in.
  it('leaves a relative import from outside the app alone', () => {
    const outside = new URL('../probe-providers.mjs', import.meta.url).href;
    assert.equal(appSpecifier('./lib/app-source', outside), './lib/app-source');
    assert.equal(appSpecifier('./project', undefined), './project');
  });
});

// The regression this file exists for (#79). `npm run providers` is kept out of
// CI because it talks to twenty companies, but *loading the table* is offline
// and instant, and loading the table is the half that broke: one extensionless
// import inside providers.ts ended the script before it asked anybody anything.
// The next one says so here instead.
describe('the provider table, read out of the app', () => {
  it('loads, with every provider the app offers in it', async () => {
    const { PROVIDERS, CUSTOM_PROVIDER_ID } = await importFromApp('app/core/providers.ts');

    assert.ok(Array.isArray(PROVIDERS), 'PROVIDERS is a list');
    assert.ok(PROVIDERS.length > 20, `only ${PROVIDERS.length} providers came back`);
    assert.ok(
      PROVIDERS.some((p) => p.id === CUSTOM_PROVIDER_ID),
      'the custom row is in the table the probe filters it out of',
    );
    for (const preset of PROVIDERS) {
      assert.equal(typeof preset.id, 'string', `${preset.name} has an id`);
      assert.equal(typeof preset.baseUrl, 'string', `${preset.id} has a base URL`);
    }
  });

  it('brings what its own imports gave it, and not an empty shell', async () => {
    // `WEBSITE`, out of core/project.ts, is the import that used to end the
    // script; the rows that credit the app calling them are where it lands.
    const { PROVIDERS } = await importFromApp('app/core/providers.ts');
    const referer = PROVIDERS.map((p) => p.headers?.['HTTP-Referer']).find(Boolean);

    assert.ok(referer, 'no row carries a Referer, so nothing here proves the import ran');
    assert.match(referer, /^https:\/\/\S+$/);
  });
});
