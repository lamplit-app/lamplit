import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesDialog } from './preferences-dialog';
import { ModelClient } from '../../core/model-client';
import { ChapterStore } from '../../store/chapter-store';
import { SettingsStore } from '../../store/settings-store';
import { ShareStore } from '../../store/share-store';
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
 * Two things on this sheet decide something rather than record it.
 *
 * The contrast warning is the only place the app has an opinion about a choice
 * the reader made, and it has to be right about the arithmetic and quiet about
 * a colour it cannot read at all. And the palette row edits either the chapter
 * or the story, depending on which of them the page on screen came from —
 * writing to the wrong one looks exactly like the click doing nothing.
 */
describe('PreferencesDialog', () => {
  let storage: InMemoryStorage;
  let fixture: ReturnType<typeof TestBed.createComponent<PreferencesDialog>>;

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
    fixture = TestBed.createComponent(PreferencesDialog);
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

  /** What one folded section says about itself, found by the name on it. */
  function summaryOf(title: string): string {
    const panel = [...host().querySelectorAll('mat-expansion-panel')].find(
      (candidate) => candidate.querySelector('mat-panel-title')?.textContent.trim() === title,
    );
    if (!panel) throw new Error(`no section called ${title}`);
    return panel.querySelector('mat-panel-description')?.textContent.trim() ?? '';
  }

  /** One of the choices in Accessibility, reached by the name above the box. */
  function choice(label: string): HTMLSelectElement {
    const field = [...host().querySelectorAll('li-field')].find(
      (candidate) => candidate.querySelector('.li-field-label')?.textContent.trim() === label,
    );
    if (!field) throw new Error(`no field called ${label}`);
    return field.querySelector<HTMLSelectElement>('select')!;
  }

  function say(label: string, value: string): void {
    const select = choice(label);
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  /** A named slide toggle in Advanced, as the reader would reach it. */
  function toggle(label: string): HTMLElement | null {
    const row = [...host().querySelectorAll<HTMLElement>('mat-slide-toggle')].find((candidate) =>
      candidate.textContent.includes(label),
    );
    return row?.querySelector<HTMLElement>('button[role="switch"], input[type="checkbox"]') ?? null;
  }

  beforeEach(() => {
    storage = new InMemoryStorage();
    TestBed.configureTestingModule({
      providers: [
        { provide: STORAGE_BACKEND, useValue: storage },
        { provide: ModelClient, useValue: { chatJson: vi.fn(), streamChat: vi.fn() } },
      ],
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

  /**
   * The panel is two questions and both of them have an answer already — the
   * reader's own machine. What is asserted is that saying otherwise is written
   * down as a setting, because that is the whole of the panel: `applyUi` turns
   * it into an attribute and `styles.scss` has a block per state.
   */
  describe('accessibility', () => {
    it('offers three states for contrast and two for motion', () => {
      open();

      expect([...choice('Contrast').options].map((option) => option.value)).toEqual([
        'system',
        'high',
        'normal',
      ]);
      // No "always animate": see `MotionMode`, which is where the reason is.
      expect([...choice('Motion').options].map((option) => option.value)).toEqual([
        'system',
        'reduced',
      ]);
    });

    it('starts on the machine, and writes down whichever way it is overruled', () => {
      open();
      expect(choice('Contrast').value).toBe('system');
      expect(summaryOf('Accessibility')).toBe('following your computer');

      say('Contrast', 'high');
      expect(settings().ui().contrast).toBe('high');
      expect(summaryOf('Accessibility')).toBe('stronger contrast');

      say('Contrast', 'normal');
      expect(settings().ui().contrast).toBe('normal');

      say('Motion', 'reduced');
      expect(settings().ui().motion).toBe('reduced');
      expect(summaryOf('Accessibility')).toBe('contrast as it ships, nothing moves');
    });

    it('shows what a settings file already says', () => {
      open({ contrast: 'high', motion: 'reduced' });

      expect(choice('Contrast').value).toBe('high');
      expect(choice('Motion').value).toBe('reduced');
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

  /**
   * The switch that changes who can reach the writing.
   *
   * Everything it shows comes from the server — the app is deliberately never
   * told the pairing token, so there is nothing here to check about it beyond
   * the fact that the picture of it is asked for. What is worth checking is
   * that the sheet says nothing at all where there is nothing to say, and that
   * the two things a person could be caught out by are on screen when sharing
   * is on: what a paired phone can read, and a model a phone cannot reach.
   */
  describe('sharing on this network', () => {
    const LABEL = 'Share on this network';

    /** The server's three answers, from a state the test can change. */
    function serving(state: { share: boolean; port: number; addresses: string[] } | null): void {
      let held = state;
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: string, init?: RequestInit) => {
          if (held === null) {
            return Promise.resolve(new Response(JSON.stringify({ ok: false }), { status: 404 }));
          }
          if (init?.method === 'PUT') {
            const asked = JSON.parse(init.body as string) as { share?: boolean };
            if (typeof asked.share === 'boolean') held = { ...held, share: asked.share };
          }
          return Promise.resolve(
            new Response(JSON.stringify(held), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }),
      );
    }

    /**
     * The sheet, with the server's answer already in hand. Loaded through the
     * store rather than waited for after the component asks, so the first
     * render is the one the assertions are about.
     */
    async function openSharing(
      state: { share: boolean; port: number; addresses: string[] } | null,
      ui: Record<string, unknown> = {},
    ): Promise<void> {
      serving(state);
      await TestBed.inject(ShareStore).load();
      open(ui);
    }

    function warnings(): string {
      return [...host().querySelectorAll('.warning')].map((one) => one.textContent).join(' ');
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('is not on the sheet where the server has no sharing to report', async () => {
      await openSharing(null);
      expect(toggle(LABEL)).toBeNull();
    });

    it('is on the sheet, off, with nothing to pair yet', async () => {
      await openSharing({ share: false, port: 0, addresses: [] });

      expect(toggle(LABEL)).not.toBeNull();
      expect(toggle(LABEL)?.getAttribute('aria-checked')).toBe('false');
      expect(host().querySelector('.qr')).toBeNull();
      expect(warnings()).not.toContain('everything you can here');
    });

    it('shows the code, the address and the warning once it is on', async () => {
      await openSharing({ share: true, port: 4177, addresses: ['192.168.1.5'] });

      const qr = host().querySelector<HTMLImageElement>('.qr');
      expect(qr?.getAttribute('src')).toContain('/api/server/share/qr?address=192.168.1.5');
      expect(host().textContent).toContain('http://192.168.1.5:4177/');
      // The two facts somebody could be caught out by, both said out loud.
      expect(warnings()).toContain('everything you can here');
      expect(host().textContent).toContain('firewall');
    });

    it('offers every address the machine has, because only the phone knows which', async () => {
      await openSharing({ share: true, port: 4177, addresses: ['192.168.1.5', '172.28.0.1'] });

      const addresses = [...host().querySelectorAll('.address')].map((one) =>
        one.textContent.trim(),
      );
      expect(addresses).toEqual(['192.168.1.5', '172.28.0.1']);
      // The first until somebody says otherwise, and then the one they said.
      expect(host().querySelector('.qr')?.getAttribute('src')).toContain('192.168.1.5');
      host().querySelectorAll<HTMLButtonElement>('.address')[1].click();
      fixture.detectChanges();
      expect(host().querySelector('.qr')?.getAttribute('src')).toContain('172.28.0.1');
    });

    it('says so when the model is on this computer and the phone cannot reach it', async () => {
      await openSharing({ share: true, port: 4177, addresses: ['192.168.1.5'] });
      expect(warnings()).not.toContain('which is this computer');

      settings().patchConnection({ baseUrl: 'http://localhost:11434/v1' });
      fixture.detectChanges();
      expect(warnings()).toContain('which is this computer');
    });

    it('is the first thing the folded panel says about itself', async () => {
      await openSharing({ share: true, port: 4177, addresses: ['192.168.1.5'] });
      expect(summaryOf('Advanced')).toBe('shared on this network');
    });
  });

  /**
   * The window always starts without a proxy, because finding one is allowed to
   * take twenty seconds and on the way in that is twenty seconds of nothing on
   * screen. This switch is how someone whose network only lets them out through
   * a proxy asks for it back — so it has to reach the shell when it is clicked
   * rather than at the next start, and it has to be absent where there is no
   * shell to reach.
   */
  describe('reaching the model through the machine’s proxy', () => {
    const LABEL = 'Reach the model through this computer’s proxy';
    let useSystemProxy: ReturnType<typeof vi.fn>;

    function inTheDesktopApp(): void {
      useSystemProxy = vi.fn().mockResolvedValue(undefined);
      (globalThis as { lamplit?: unknown }).lamplit = {
        openDataFolder: vi.fn(),
        checkForUpdates: vi.fn(),
        useSystemProxy,
      };
    }

    afterEach(() => {
      delete (globalThis as { lamplit?: unknown }).lamplit;
    });

    it('is not on the sheet at all in a browser tab, where the proxy is the browser’s', () => {
      open();
      expect(toggle(LABEL)).toBeNull();
    });

    it('is on the sheet in the desktop app, and off until it is asked for', () => {
      inTheDesktopApp();
      open();

      expect(toggle(LABEL)).not.toBeNull();
      expect(settings().ui().systemProxy).toBe(false);
    });

    it('tells the shell when it is clicked, rather than at the next start', () => {
      inTheDesktopApp();
      open();
      toggle(LABEL)!.click();
      fixture.detectChanges();

      expect(settings().ui().systemProxy).toBe(true);
      expect(useSystemProxy).toHaveBeenCalledWith(true);
    });

    it('gives it up again the same way', () => {
      inTheDesktopApp();
      open({ systemProxy: true });
      toggle(LABEL)!.click();
      fixture.detectChanges();

      expect(settings().ui().systemProxy).toBe(false);
      expect(useSystemProxy).toHaveBeenCalledWith(false);
    });
  });
});
