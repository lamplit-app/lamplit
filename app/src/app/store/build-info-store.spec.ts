import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildInfoStore, isNewer } from './build-info-store';

/** What `/api/health` answers, so the store can be asked what it made of it. */
function health(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
}

const STAMPED = {
  ok: true,
  name: 'lamplit',
  version: '0.2.0',
  commit: 'a1b2c3d',
  builtAt: '2026-09-04T10:11:12.000Z',
  build: '42',
  channel: 'zip',
  previousVersion: null,
};

describe('isNewer', () => {
  it('compares segment by segment, as numbers', () => {
    expect(isNewer('0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('0.1.1', '0.1.0')).toBe(true);
  });

  it('is false for the same version and for a downgrade', () => {
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.1.0', '0.2.0')).toBe(false);
    expect(isNewer('0.9.9', '0.10.0')).toBe(false);
  });

  it('treats a missing or unparseable segment as zero rather than throwing', () => {
    expect(isNewer('1.1', '1.0.9')).toBe(true);
    expect(isNewer('1.0', '1.0.0')).toBe(false);
    expect(isNewer('nonsense', '0.0.1')).toBe(false);
  });

  it('reads a pre-release as the version it is a pre-release of', () => {
    expect(isNewer('0.2.0', '0.2.0-beta.1')).toBe(true);
    expect(isNewer('0.2.0-beta.1', '0.2.0')).toBe(false);
    expect(isNewer('0.2.0-beta.1', '0.1.0')).toBe(true);
  });
});

describe('BuildInfoStore', () => {
  let builds: BuildInfoStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    builds = TestBed.inject(BuildInfoStore);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps what the server said about the build', async () => {
    health(STAMPED);
    await builds.load();

    expect(builds.version()).toBe('0.2.0');
    expect(builds.buildLine()).toBe('build 42 · a1b2c3d · 2026-09-04');
    expect(builds.info()?.channel).toBe('zip');
  });

  it('says a build was made by hand when nothing stamped it', async () => {
    health({ name: 'lamplit', version: '0.2.0', build: 'local', commit: '', builtAt: '' });
    await builds.load();

    expect(builds.buildLine()).toBe('built by hand');
  });

  it('reports the version that wrote the documents when this one is newer', async () => {
    health({ ...STAMPED, previousVersion: '0.1.0' });
    await builds.load();

    expect(builds.upgradedFrom()).toBe('0.1.0');
  });

  it('reports nothing on a first run, or after a downgrade', async () => {
    health(STAMPED);
    await builds.load();
    expect(builds.upgradedFrom()).toBeNull();

    health({ ...STAMPED, version: '0.1.0', previousVersion: '0.2.0' });
    await builds.load();
    expect(builds.upgradedFrom()).toBeNull();
  });

  it('holds nothing when the server is not Lamplit, or does not answer', async () => {
    health({ name: 'something-else', version: '9.9.9' });
    await builds.load();
    expect(builds.info()).toBeNull();

    health({}, 500);
    await builds.load();
    expect(builds.info()).toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('failed to fetch'))),
    );
    await builds.load();
    expect(builds.info()).toBeNull();
    expect(builds.buildLine()).toBe('');
  });
});
