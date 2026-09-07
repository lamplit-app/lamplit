import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ColoursPanel } from './colours-panel';
import { ChapterStore } from '../../store/chapter-store';
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

const STORY_ID = 'story-1';
const CHAPTER_ID = 'chapter-1';

/**
 * Two things on this panel decide something rather than record it.
 *
 * The contrast warning is the only place the app has an opinion about a choice
 * the reader made, and it has to be right about the arithmetic and quiet about
 * a colour it cannot read at all. And the palette row edits either the chapter
 * or the story, depending on which of them the page on screen came from —
 * writing to the wrong one looks exactly like the click doing nothing. The row
 * is `li-page-palette`, tested here rather than on its own because what it is
 * handed — the ten presets, drawn as the stylesheet draws them — is this
 * panel's answer to give.
 */
describe('ColoursPanel', () => {
  let storage: InMemoryStorage;
  let fixture: ReturnType<typeof TestBed.createComponent<ColoursPanel>>;

  const settings = () => TestBed.inject(SettingsStore);
  const chapters = () => TestBed.inject(ChapterStore);
  const host = () => fixture.nativeElement as HTMLElement;

  function seed(ui: Record<string, unknown> = {}, chapter: Record<string, unknown> = {}): void {
    storage.write(KEYS.settings, {
      connection: { provider: 'nanogpt', baseUrl: 'https://x/v1', apiKey: '', model: 'm' },
      ui: { theme: 'light', ...ui },
      activeStoryId: STORY_ID,
    });
    storage.write(KEYS.story(STORY_ID), {
      id: STORY_ID,
      title: 'The Lamplighter',
      updatedAt: '2026-01-01T00:00:00.000Z',
      activeChapterId: CHAPTER_ID,
      chapterCounter: 1,
    });
    storage.write(KEYS.chapter(CHAPTER_ID), {
      id: CHAPTER_ID,
      storyId: STORY_ID,
      number: 1,
      title: '',
      scene: 'A scene.',
      status: 'writing',
      summary: '',
      messages: [],
      ...chapter,
    });
  }

  function open(ui: Record<string, unknown> = {}, chapter: Record<string, unknown> = {}): void {
    seed(ui, chapter);
    fixture = TestBed.createComponent(ColoursPanel);
    fixture.detectChanges();
  }

  /** The colour picker beside a named swatch, as the reader would reach it. */
  function swatch(label: string): HTMLInputElement {
    const found = [...host().querySelectorAll('.swatch')].find(
      (row) => row.querySelector('.name')?.textContent.trim() === label,
    );
    if (!found) throw new Error(`no swatch called ${label}`);
    return found.querySelector<HTMLInputElement>('input[type="color"]')!;
  }

  function pick(label: string, colour: string): void {
    const input = swatch(label);
    input.value = colour;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function warning(): string {
    return host().querySelector('.warning')?.textContent.trim() ?? '';
  }

  /** One of the pages in the palette row, clicked by the name on it. */
  function choose(label: string): void {
    const button = [...host().querySelectorAll<HTMLButtonElement>('.palette')].find(
      (candidate) => candidate.querySelector('.palette-label')?.textContent.trim() === label,
    );
    if (!button) throw new Error(`no page called ${label}`);
    button.click();
    fixture.detectChanges();
  }

  beforeEach(() => {
    storage = new InMemoryStorage();
    TestBed.configureTestingModule({
      providers: [{ provide: STORAGE_BACKEND, useValue: storage }],
    });
  });

  describe('the contrast warning', () => {
    it('says nothing about text and paper a reader can actually read', () => {
      open({ colours: { light: { ink: '#1a1a1a', surface: '#fbfaf7' } } });
      expect(warning()).toBe('');
    });

    it('warns, with the ratio, when the pair falls under what AA asks', () => {
      open({ colours: { light: { ink: '#1a1a1a', surface: '#fbfaf7' } } });
      pick('Text', '#b0aca4');

      expect(warning()).toContain('under the 4.5:1 that WCAG AA asks');
      expect(warning()).toMatch(/Text on paper is 2\.\d:1/);
    });

    it('stops warning the moment the pair is readable again', () => {
      open({ colours: { light: { ink: '#b0aca4', surface: '#fbfaf7' } } });
      expect(warning()).not.toBe('');

      pick('Text', '#1a1a1a');
      expect(warning()).toBe('');
    });

    it('warns rather than blocks: the colour is still the one that was chosen', () => {
      open({ colours: { light: { ink: '#1a1a1a', surface: '#fbfaf7' } } });
      pick('Text', '#b0aca4');

      expect(settings().ui().colours.light?.ink).toBe('#b0aca4');
      expect(swatch('Text').value).toBe('#b0aca4');
    });

    it('says nothing at all about a colour it cannot read', () => {
      // Not something the picker can produce — but a settings file is a file,
      // and `NaN:1` on the page would be worse than saying nothing.
      open({ colours: { light: { ink: 'rebeccapurple', surface: '#fbfaf7' } } });

      expect(warning()).toBe('');
    });
  });

  describe('which page the palette row is editing', () => {
    it('sets the story page when the open chapter has none of its own', () => {
      open();
      choose('Frost');

      expect(settings().ui().palette).toBe('frost');
      expect(chapters().chapter().palette).toBeUndefined();
    });

    it('sets the chapter page when the chapter is what the reader is looking at', () => {
      open({ palette: 'dusk' }, { palette: 'ember' });
      expect(host().textContent).toContain('Chapter 1 has a page of its own.');

      choose('Frost');

      expect(chapters().chapter().palette).toBe('frost');
      // The story's page is left where it was, under the chapter's.
      expect(settings().ui().palette).toBe('dusk');
    });

    it('gives a chapter back to the story when its page is set to the shipped one', () => {
      open({ palette: 'dusk' }, { palette: 'ember' });
      choose('As it ships');

      expect(chapters().chapter().palette).toBeUndefined();
      expect(settings().ui().palette).toBe('dusk');
    });

    it('marks the page the story is being read on', () => {
      open({ palette: 'frost' });
      const on = [...host().querySelectorAll('.palette.on')].map((button) =>
        button.querySelector('.palette-label')?.textContent.trim(),
      );

      expect(on).toEqual(['Frost']);
    });
  });
});
