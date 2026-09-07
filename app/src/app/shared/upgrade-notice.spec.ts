import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpgradeNotice } from './upgrade-notice';
import { BuildInfoStore } from '../store/build-info-store';
import { SettingsStore } from '../store/settings-store';
import { KEYS } from '../store/documents';
import { STORAGE_BACKEND, StorageBackend } from '../store/storage';

/** The documents, in a Map. What Persistence is, minus the server behind it. */
class InMemoryStorage implements StorageBackend {
  readonly documents = new Map<string, unknown>();

  read<T>(key: string): T | null {
    return (this.documents.get(key) as T) ?? null;
  }
  write(key: string, value: unknown): void {
    this.documents.set(key, value);
  }
  remove(key: string): void {
    this.documents.delete(key);
  }
  keys(prefix: string): string[] {
    return [...this.documents.keys()].filter((key) => key.startsWith(prefix));
  }
}

/**
 * A strip that must appear exactly once in the life of a version and then
 * never again — the one thing a test can check and a person cannot, because
 * seeing it a second time means having upgraded twice.
 */
describe('UpgradeNotice', () => {
  let storage: InMemoryStorage;

  /** What `/api/health` says about the build and the data folder it found. */
  function health(body: Record<string, unknown>): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true, name: 'lamplit', ...body }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );
  }

  async function open(): Promise<Fixture> {
    await TestBed.inject(BuildInfoStore).load();
    const fixture = TestBed.createComponent(UpgradeNotice);
    fixture.detectChanges();
    return fixture;
  }

  type Fixture = ReturnType<typeof TestBed.createComponent<UpgradeNotice>>;

  const strip = (fixture: Fixture) =>
    (fixture.nativeElement as HTMLElement).querySelector('.notice');

  /** A part of the strip, by the class it wears. */
  const part = (fixture: Fixture, selector: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(selector)!;

  beforeEach(() => {
    storage = new InMemoryStorage();
    storage.write(KEYS.settings, {
      connection: { provider: 'nanogpt', baseUrl: 'https://x/v1', apiKey: '', model: 'm' },
    });
    TestBed.configureTestingModule({
      providers: [{ provide: STORAGE_BACKEND, useValue: storage }],
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('says so when this Lamplit is newer than the one that wrote the documents', async () => {
    health({ version: '0.2.0', build: '42', previousVersion: '0.1.0' });
    const fixture = await open();

    expect(strip(fixture)?.textContent).toContain('Lamplit was upgraded to');
    expect(strip(fixture)?.textContent).toContain('0.2.0');
  });

  it('says nothing on a fresh install, or after a downgrade', async () => {
    health({ version: '0.2.0', build: '42', previousVersion: null });
    expect(strip(await open())).toBeNull();

    health({ version: '0.1.0', build: '42', previousVersion: '0.2.0' });
    expect(strip(await open())).toBeNull();
  });

  it('is gone for good once it is dismissed, and gone after a reload', async () => {
    health({ version: '0.2.0', build: '42', previousVersion: '0.1.0' });
    const fixture = await open();

    part(fixture, '.close').click();
    fixture.detectChanges();
    expect(strip(fixture)).toBeNull();

    // What a reload does: the same answer from the server, a new component,
    // and the settings document that was written in between.
    expect(TestBed.inject(SettingsStore).settings().acknowledgedVersion).toBe('0.2.0');
    expect(strip(await open())).toBeNull();
  });

  it('comes back for the next upgrade, having been dismissed for the last', async () => {
    health({ version: '0.2.0', build: '42', previousVersion: '0.1.0' });
    const fixture = await open();
    part(fixture, '.close').click();
    fixture.detectChanges();

    health({ version: '0.3.0', build: '43', previousVersion: '0.2.0' });
    expect(strip(await open())?.textContent).toContain('0.3.0');
  });

  it('reading the notes is also an answer to the notice', async () => {
    health({ version: '0.2.0', build: '42', previousVersion: '0.1.0' });
    const fixture = await open();

    part(fixture, '.notes').click();
    fixture.detectChanges();

    expect(strip(fixture)).toBeNull();
  });

  it('points a released build at its own tag, and a hand-built one at the list', async () => {
    health({ version: '0.2.0', build: '42', previousVersion: '0.1.0' });
    let fixture = await open();
    expect(part(fixture, '.notes').getAttribute('href')).toBe(
      'https://github.com/lamplit-app/lamplit/releases/tag/v0.2.0',
    );

    // A build nobody tagged has no page of its own to send anyone to.
    health({ version: '0.2.0', build: 'local', previousVersion: '0.1.0' });
    fixture = await open();
    expect(part(fixture, '.notes').getAttribute('href')).toBe(
      'https://github.com/lamplit-app/lamplit/releases',
    );
  });
});
