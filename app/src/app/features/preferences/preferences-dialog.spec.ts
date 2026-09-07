import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { PreferencesDialog } from './preferences-dialog';
import { KEYS } from '../../store/documents';
import { STORAGE_BACKEND, StorageBackend } from '../../store/storage';

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
 * The sheet holds four panels and nothing else, and each of them is a
 * component of its own — which is the one thing about the arrangement that
 * could break silently. A panel registers with the accordion through the
 * injector rather than by being queried for, so one drawn inside a child
 * component belongs to the accordion exactly as a hand-written one would; if
 * that ever stopped being true, every panel would open and close alone. What
 * each panel does is asserted beside it, in its own spec.
 */
describe('PreferencesDialog', () => {
  let storage: InMemoryStorage;
  let fixture: ReturnType<typeof TestBed.createComponent<PreferencesDialog>>;

  const host = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    storage = new InMemoryStorage();
    TestBed.configureTestingModule({
      providers: [{ provide: STORAGE_BACKEND, useValue: storage }],
    });
    storage.write(KEYS.settings, {
      connection: { provider: 'nanogpt', baseUrl: 'https://x/v1', apiKey: '', model: 'm' },
      ui: { theme: 'light' },
    });
    fixture = TestBed.createComponent(PreferencesDialog);
    fixture.detectChanges();
  });

  it('is the four panels, in the order the reader meets them', () => {
    const titles = [...host().querySelectorAll('mat-panel-title')].map((title) =>
      title.textContent.trim(),
    );

    expect(titles).toEqual(['Reading', 'Accessibility', 'Colours', 'Advanced']);
  });

  it('opens on Reading, with the other three folded away', () => {
    const open = [...host().querySelectorAll('mat-expansion-panel')].filter(
      (panel) => panel.querySelector('.mat-expanded') ?? panel.classList.contains('mat-expanded'),
    );

    expect(open).toHaveLength(1);
    expect(open[0].querySelector('mat-panel-title')?.textContent.trim()).toBe('Reading');
  });

  it('holds every panel in one accordion, so they are not four sheets', () => {
    const accordions = host().querySelectorAll('mat-accordion');
    const panels = host().querySelectorAll('mat-accordion mat-expansion-panel');

    expect(accordions).toHaveLength(1);
    expect(panels).toHaveLength(4);
  });
});
