import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/defaults';
import { KEYS } from './documents';
import { SettingsStore } from './settings-store';
import { STORAGE_BACKEND, StorageBackend } from './storage';

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
 * A `settings.json` as 0.1.0 wrote one: four reading fields, and no idea that
 * a palette or a reading font were ever going to exist.
 */
const SETTINGS_0_1_0 = {
  connection: { provider: 'nanogpt', baseUrl: 'https://x/v1', apiKey: '', model: 'm' },
  generation: { temperature: 0.7 },
  ui: { theme: 'light', bookStyleDialogue: false, fontSize: 22, showTokenCounts: false },
  activeStoryId: 'abc',
};

describe('SettingsStore', () => {
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = new InMemoryStorage();
    TestBed.configureTestingModule({
      providers: [{ provide: STORAGE_BACKEND, useValue: storage }],
    });
  });

  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  /** The store reads at construction, so seed the document before asking. */
  const store = () => TestBed.inject(SettingsStore);

  /**
   * A machine with an answer about the theme, which jsdom has not: it ships no
   * media-query engine at all, so `Layout` reads nothing as matching and the
   * theme following the machine lands on light. This is the other half of that
   * question, and it is the whole reason `Layout` is asked rather than the
   * setting being read as the answer.
   */
  function machineIsDark(): void {
    window.matchMedia = ((query: string) => ({
      matches: query.includes('dark'),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
  }

  it('opens a 0.1.0 settings file with no colours customised', () => {
    storage.write(KEYS.settings, SETTINGS_0_1_0);

    const ui = store().ui();
    // What it did say is kept, to the letter.
    expect(ui.theme).toBe('light');
    expect(ui.fontSize).toBe(22);
    expect(ui.showTokenCounts).toBe(false);
    // What it did not say is the theme exactly as it shipped, and an app that
    // shows the writer's half of itself and nothing else.
    expect(ui.colours).toEqual({});
    expect(ui.font).toBe(DEFAULT_SETTINGS.ui.font);
    expect(ui.developerMode).toBe(false);
    // On by default, so an upgrade is something an old install hears about.
    expect(ui.checkForUpdates).toBe(true);
    // The chapter panel is later still: a thin edge, with nothing folded away
    // inside it when it is opened for the first time.
    expect(ui.sidebarOpen).toBe(false);
    expect(ui.sidebarSections).toEqual({});
  });

  /**
   * The theme is the one preference with three states *and* a resolved answer
   * the app has to draw with: a colour per character, a set of overrides, a
   * page palette's half. So the store answers which of the two is on screen,
   * and nothing else in the app resolves it a second time.
   */
  describe('which theme is on screen', () => {
    it('follows the machine on a fresh install, which is what system means', () => {
      machineIsDark();
      expect(store().ui().theme).toBe('system');
      expect(store().theme()).toBe('dark');
    });

    it('is light where the machine says nothing at all', () => {
      // jsdom, and every spec in the app: nothing matches, so neither does the
      // dark query, and light is what a page with no preference is.
      expect(store().theme()).toBe('light');
    });

    it('is the setting the moment there is one, whatever the machine says', () => {
      machineIsDark();
      const settings = store();

      settings.patchUi({ theme: 'light' });
      expect(settings.theme()).toBe('light');

      settings.patchUi({ theme: 'dark' });
      expect(settings.theme()).toBe('dark');
    });

    it('opens a 0.1.x file in the theme it names, whatever the machine is in', () => {
      machineIsDark();
      storage.write(KEYS.settings, SETTINGS_0_1_0);

      expect(store().theme()).toBe('light');
    });
  });

  it('keeps developer mode once it is switched on', () => {
    const settings = store();
    expect(settings.ui().developerMode).toBe(false);

    settings.patchUi({ developerMode: true });
    expect(settings.ui().developerMode).toBe(true);
    // It is a setting, not a mode: nothing else moved with it.
    expect(settings.ui().colours).toEqual({});
    expect(settings.ui().showTokenCounts).toBe(DEFAULT_SETTINGS.ui.showTokenCounts);
  });

  it('keeps a colour per theme, and reset takes only the one theme back', () => {
    const settings = store();
    settings.setColour('dark', 'page', '#101010');
    settings.setColour('light', 'page', '#fafafa');
    settings.setColour('dark', 'ink', '#eeeeee');

    expect(settings.ui().colours).toEqual({
      dark: { page: '#101010', ink: '#eeeeee' },
      light: { page: '#fafafa' },
    });

    settings.resetColours('dark');
    expect(settings.ui().colours).toEqual({ light: { page: '#fafafa' } });
  });

  it('writes down the folded panel sections and nothing else', () => {
    const settings = store();
    settings.setSidebarOpen(true);
    settings.setPanelSection('cast', false);
    settings.setPanelSection('scene', true);

    // An open section is an absent one, so a section a later version adds
    // arrives open rather than inheriting somebody's old answer.
    expect(settings.ui().sidebarOpen).toBe(true);
    expect(settings.ui().sidebarSections).toEqual({ cast: false });

    settings.setPanelSection('cast', true);
    expect(settings.ui().sidebarSections).toEqual({});
  });

  it('drops the override rather than storing the shipped colour', () => {
    const settings = store();
    settings.setColour('dark', 'accent', '#c0a060');
    settings.setColour('dark', 'accent', null);

    expect(settings.ui().colours.dark).toEqual({});
  });
});
