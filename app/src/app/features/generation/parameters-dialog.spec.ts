import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ParametersDialog } from './parameters-dialog';
import { SettingsStore } from '../../store/settings-store';
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
 * Everything on this sheet ends up in the JSON body of the next request, so
 * the two free-text fields are the ones worth pinning: a stop sequence and a
 * seed are typed rather than dragged, and an endpoint given `"seed": 4.7` or
 * `"stop": ["", "  "]` answers with a 400 rather than a story.
 */
describe('ParametersDialog', () => {
  let storage: InMemoryStorage;
  let fixture: ReturnType<typeof TestBed.createComponent<ParametersDialog>>;

  const params = () => TestBed.inject(SettingsStore).generation();

  /** Types into a box and leaves it, which is what commits one of these. */
  function commit(box: HTMLTextAreaElement | HTMLInputElement, text: string): void {
    box.value = text;
    box.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function stopBox(): HTMLTextAreaElement {
    return (fixture.nativeElement as HTMLElement).querySelector('textarea')!;
  }

  /** By its field, since every ParamRow on the sheet has a number box too. */
  function seedBox(): HTMLInputElement {
    return (fixture.nativeElement as HTMLElement).querySelector('.seed input')!;
  }

  /** A named row of the sheet, which is a ParamRow with its own two controls. */
  function row(label: string): Element {
    const host = fixture.nativeElement as HTMLElement;
    const found = [...host.querySelectorAll('li-param-row')].find(
      (candidate) => candidate.querySelector('.li-field-label')?.textContent.trim() === label,
    );
    if (!found) throw new Error(`no row called ${label}`);
    return found;
  }

  function exactBox(label: string): HTMLInputElement {
    return row(label).querySelector<HTMLInputElement>('.exact')!;
  }

  beforeEach(() => {
    storage = new InMemoryStorage();
    storage.write(KEYS.settings, {
      connection: { provider: 'nanogpt', baseUrl: 'https://x/v1', apiKey: '', model: 'm' },
    });
    TestBed.configureTestingModule({
      providers: [{ provide: STORAGE_BACKEND, useValue: storage }],
    });
    fixture = TestBed.createComponent(ParametersDialog);
    fixture.detectChanges();
  });

  it('reads one stop sequence per line, and ignores the blank ones', () => {
    commit(stopBox(), '  ###  \n\n END OF CHAPTER \n   \n');
    expect(params().stop).toEqual(['###', 'END OF CHAPTER']);
  });

  it('sends no stop sequences at all when the box is emptied', () => {
    commit(stopBox(), '###');
    commit(stopBox(), '  \n  ');
    expect(params().stop).toEqual([]);
  });

  it('keeps a seed as the whole number an endpoint will take', () => {
    commit(seedBox(), '4.7');
    expect(params().seed).toBe(4);

    commit(seedBox(), '-4.7');
    expect(params().seed).toBe(-4);
  });

  it('leaves the seed out when the box is empty or is not a number', () => {
    commit(seedBox(), '12');
    expect(params().seed).toBe(12);

    commit(seedBox(), '   ');
    expect(params().seed).toBeUndefined();

    commit(seedBox(), 'lucky');
    expect(params().seed).toBeUndefined();
  });

  it('writes a number typed into a row through to the parameters, at the range', () => {
    commit(exactBox('Temperature'), '5');
    expect(params().temperature).toBe(2);

    commit(exactBox('Reply length'), '512');
    expect(params().maxResponseTokens).toBe(512);
  });

  it('says which of the advanced parameters are being sent', () => {
    const host = fixture.nativeElement as HTMLElement;
    const summary = () => host.querySelector('mat-panel-description')!.textContent.trim();
    expect(summary()).toBe('nothing set');

    commit(seedBox(), '12');
    row('Top-k').querySelector<HTMLButtonElement>('mat-slide-toggle button')!.click();
    fixture.detectChanges();
    commit(exactBox('Top-k'), '40');

    expect(summary()).toBe('top-k, seed set');
    expect(params().topK).toBe(40);
  });
});
