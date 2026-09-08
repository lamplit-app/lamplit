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
 * The contrast warnings are the only place the app has an opinion about a
 * choice the reader made, and they have to be right about the arithmetic, right
 * about which pair went under, and quiet about a colour they cannot read at
 * all. And the palette row edits either the chapter or the story, depending on
 * which of them the page on screen came from — writing to the wrong one looks
 * exactly like the click doing nothing. The row is `li-page-palette`, tested
 * here rather than on its own because what it is handed — the ten presets,
 * drawn as the stylesheet draws them — is this panel's answer to give.
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

  /** Every warning on the sheet, in the order the panel gives them. */
  function warnings(): string[] {
    return [...host().querySelectorAll('.warning')].map((p) => p.textContent.trim());
  }

  /** The one about the pair the story is read in, which most of these are. */
  function warning(): string {
    return warnings().find((text) => text.startsWith('Text on paper')) ?? '';
  }

  /**
   * A page whose two watched pairs are both readable, so that a test says which
   * one it is putting out of reach.
   *
   * Every swatch a settings file does not name falls back to `#000000` here —
   * there is no stylesheet for `shippedColour` to read the shipped one off — so
   * a panel opened on nothing at all has both pairs at 1:1 and warns twice.
   */
  const LEGIBLE = { ink: '#1a1a1a', surface: '#fbfaf7', page: '#f6f3ec', accent: '#6b4ea8' };

  function openLegible(colours: Record<string, string> = {}): void {
    open({ colours: { light: { ...LEGIBLE, ...colours } } });
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

  describe('the contrast warnings', () => {
    it('says nothing about a page a reader can actually read', () => {
      openLegible();
      expect(warnings()).toEqual([]);
    });

    it('warns, with the ratio, when the pair falls under what AA asks', () => {
      openLegible();
      pick('Text', '#b0aca4');

      expect(warning()).toContain('under the 4.5:1 that WCAG AA asks');
      expect(warning()).toMatch(/Text on paper is 2\.\d:1/);
    });

    it('stops warning the moment the pair is readable again', () => {
      openLegible({ ink: '#b0aca4' });
      expect(warning()).not.toBe('');

      pick('Text', '#1a1a1a');
      expect(warning()).toBe('');
    });

    it('warns rather than blocks: the colour is still the one that was chosen', () => {
      openLegible();
      pick('Text', '#b0aca4');

      expect(settings().ui().colours.light?.ink).toBe('#b0aca4');
      expect(swatch('Text').value).toBe('#b0aca4');
    });

    it('says nothing at all about a colour it cannot read', () => {
      // Not something the picker can produce — but a settings file is a file,
      // and `NaN:1` on the page would be worse than saying nothing.
      openLegible({ ink: 'rebeccapurple' });

      expect(warnings()).toEqual([]);
    });

    /**
     * The pair nothing on this sheet names: a filled button's label is
     * `--mat-sys-on-primary`, which `styles.scss` sets to the page colour, so
     * dragging Page far enough takes Send, Done and Delete with it — on sheets
     * the reader is not looking at while they drag.
     */
    it('warns about a filled button when the page it is labelled in goes mid-tone', () => {
      openLegible();
      pick('Page', '#8a8a8a');

      expect(warnings()).toHaveLength(1);
      expect(warnings()[0]).toContain("A filled button's label is 1.9:1");
      expect(warnings()[0]).toContain('the page colour drawn on the accent');
    });

    it('follows the accent as well, which is the other half of that pair', () => {
      openLegible();
      pick('Accent', '#f2efe6');

      expect(warnings()[0]).toContain("A filled button's label");
    });

    it('says both when both pairs are under, story first', () => {
      openLegible({ ink: '#b0aca4', page: '#8a8a8a' });

      expect(warnings().map((text) => text.split(' is ')[0])).toEqual([
        'Text on paper',
        "A filled button's label",
      ]);
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
