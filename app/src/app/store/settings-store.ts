import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { DEFAULT_GENERATION, DEFAULT_SETTINGS } from '../core/defaults';
import { Layout } from '../core/layout';
import {
  ColourKey,
  ConnectionSettings,
  GenerationParams,
  PanelSection,
  Settings,
  ThemeName,
  UiSettings,
} from '../core/models';
import { KEYS } from './documents';
import { STORAGE_BACKEND } from './storage';

/**
 * The global `settings.json` slice. Everything is auto-saved: mutate through
 * the patch methods and the write happens on the next microtask.
 */
@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly storage = inject(STORAGE_BACKEND);
  private readonly layout = inject(Layout);
  private readonly state = signal<Settings>(this.load());
  /**
   * The document as it was last read or written. A state that differs from
   * this is a change worth a request; one that matches is the document coming
   * back from where it already is.
   */
  private written = JSON.stringify(this.state());

  readonly settings = this.state.asReadonly();
  readonly connection = computed(() => this.state().connection);
  readonly generation = computed(() => this.state().generation);
  readonly ui = computed(() => this.state().ui);

  /**
   * Which of the two palettes the reader is looking at.
   *
   * `ui().theme` is the setting and has a third state — `system`, which is
   * what a fresh install is — and everything the app writes down twice is
   * written under the other two: the halves of a colour, the two sets of
   * overrides, a page palette's light and dark, a character's pair. So this is
   * the one place the setting and the machine are put together, and everything
   * that has to pick a side reads it: `applyUi`, the cast's colours in the
   * panel and the message list, and the swatch beside a name.
   *
   * A computed over `Layout`, so following the machine means exactly that: a
   * desktop that turns dark at sunset repaints the app, because the effect in
   * `Workspace` reads this.
   */
  readonly theme = computed<ThemeName>(() => {
    const chosen = this.ui().theme;
    if (chosen !== 'system') return chosen;
    return this.layout.prefersDark() ? 'dark' : 'light';
  });

  /**
   * What the selected model says its own window is, or 0 where the provider
   * publishes no such thing. Read from the list the model picker already
   * fetched; nothing acts on it, because the context budget is the reader's
   * number and this is only how they find out it is too big.
   */
  readonly modelContextLength = computed(() => {
    const { model, modelsCache } = this.state().connection;
    return modelsCache.find((known) => known.id === model)?.contextLength ?? 0;
  });

  /** Enough to send a request: URL and model. A key is optional (local servers). */
  readonly isConnected = computed(() => {
    const c = this.state().connection;
    return !!c.baseUrl.trim() && !!c.model.trim();
  });

  readonly connectionHint = computed(() => {
    const c = this.state().connection;
    if (!c.baseUrl.trim()) return 'Set an endpoint URL in Connection';
    if (!c.model.trim()) return 'Pick a model in Connection';
    return '';
  });

  constructor() {
    // Skip the write the effect would otherwise make the moment it runs: the
    // document came off disk a tick ago and putting it straight back is a
    // request that says nothing. The story and chapter stores do the same with
    // their `written` maps.
    effect(() => {
      const next = JSON.stringify(this.state());
      if (next === this.written) return;
      this.written = next;
      this.storage.write(KEYS.settings, this.state());
    });
  }

  /**
   * Reads the document again, for a session whose copy was replaced by one
   * written on another device. `written` is primed with it for the same reason
   * the constructor primes it: what has just been read is not a change, and
   * sending it straight back would be a request that says nothing.
   */
  reload(): void {
    const settings = this.load();
    this.written = JSON.stringify(settings);
    this.state.set(settings);
  }

  patchConnection(patch: Partial<ConnectionSettings>): void {
    this.state.update((s) => ({ ...s, connection: { ...s.connection, ...patch } }));
  }

  patchGeneration(patch: Partial<GenerationParams>): void {
    this.state.update((s) => ({ ...s, generation: { ...s.generation, ...patch } }));
  }

  patchUi(patch: Partial<UiSettings>): void {
    this.state.update((s) => ({ ...s, ui: { ...s.ui, ...patch } }));
  }

  /** The chapter panel: open, or the thin edge. Ctrl+. and the handle both land here. */
  setSidebarOpen(open: boolean): void {
    this.patchUi({ sidebarOpen: open });
  }

  /**
   * One section of the chapter panel, folded or unfolded. Only the folded ones
   * are written down, so a section a later version adds arrives open.
   */
  setPanelSection(section: PanelSection, open: boolean): void {
    this.state.update((s) => {
      const sections = { ...s.ui.sidebarSections };
      if (open) delete sections[section];
      else sections[section] = false;
      return { ...s, ui: { ...s.ui, sidebarSections: sections } };
    });
  }

  /**
   * One swatch, in one theme. Passing nothing puts the shipped colour back:
   * the palette is stored as overrides, so forgetting a name *is* the default.
   */
  setColour(theme: ThemeName, key: ColourKey, colour: string | null): void {
    this.state.update((s) => {
      const colours = { ...(s.ui.colours[theme] ?? {}) };
      if (colour) colours[key] = colour;
      else delete colours[key];
      return { ...s, ui: { ...s.ui, colours: { ...s.ui.colours, [theme]: colours } } };
    });
  }

  /**
   * The page a story is read on when no chapter has one of its own. Passing
   * nothing is the page as it ships, which is what the row's first swatch does.
   */
  setPalette(name: string): void {
    this.patchUi({ palette: name });
  }

  /**
   * Every colour this theme overrides, gone. The other theme is untouched, and
   * so is the palette underneath: this is the way back to a clean preset, and
   * the row's own first swatch is the way out of presets altogether.
   */
  resetColours(theme: ThemeName): void {
    this.state.update((s) => {
      const colours = { ...s.ui.colours };
      delete colours[theme];
      return { ...s, ui: { ...s.ui, colours } };
    });
  }

  setActiveStory(id: string | null): void {
    this.state.update((s) => ({ ...s, activeStoryId: id }));
  }

  /** The upgrade notice for this version has been seen; do not show it again. */
  acknowledgeVersion(version: string): void {
    this.state.update((s) => ({ ...s, acknowledgedVersion: version }));
  }

  resetGeneration(): void {
    this.state.update((s) => ({ ...s, generation: { ...DEFAULT_GENERATION } }));
  }

  /** Merged field by field so a document from an older version still loads. */
  private load(): Settings {
    const stored = this.storage.read<Partial<Settings>>(KEYS.settings);
    if (!stored) return structuredClone(DEFAULT_SETTINGS);
    return {
      connection: { ...DEFAULT_SETTINGS.connection, ...stored.connection },
      generation: { ...DEFAULT_SETTINGS.generation, ...stored.generation },
      // `colours`, `palette` and `font` arrived after 0.1.0, so a file written by
      // it has none of them and takes all three from the defaults — no preset, no
      // overrides and the serif, which is the theme exactly as it shipped. The chapter
      // panel is later still: a file that predates it opens with the panel a
      // thin edge and nothing folded away inside it.
      ui: { ...DEFAULT_SETTINGS.ui, ...stored.ui },
      activeStoryId: stored.activeStoryId ?? null,
      acknowledgedVersion: stored.acknowledgedVersion ?? null,
    };
  }
}
