import { Component, afterNextRender, effect, inject, untracked } from '@angular/core';
import { DEFAULT_STORY_TITLE } from './core/defaults';
import { desktop } from './core/desktop';
import { applyUi } from './core/theming';
import { ChapterPanel } from './features/chapters/chapter-panel';
import { ChaptersPage } from './features/chapters/chapters-page';
import { ReloadNotice } from './shared/reload-notice';
import { TopBar } from './shared/top-bar';
import { UpgradeNotice } from './shared/upgrade-notice';
import { SettingsStore } from './store/settings-store';
import { UpdatesStore } from './store/updates-store';
import { ChapterStore } from './store/chapter-store';
import { StoryStore } from './store/story-store';
import { Persistence } from './store/persistence';
import { DialogsService } from './shared/dialogs.service';
import { ReadAloud } from './shared/read-aloud.service';

/**
 * The app itself, once there are documents to show.
 *
 * Split from `App` so that the stores are only ever built when the server has
 * handed its documents over — they read at construction, and a store that
 * loaded from nothing would look exactly like a fresh install and start writing
 * over one.
 */
@Component({
  selector: 'li-workspace',
  imports: [TopBar, UpgradeNotice, ReloadNotice, ChapterPanel, ChaptersPage],
  template: `
    <li-top-bar />
    <li-upgrade-notice />
    <li-reload-notice />
    <div class="body">
      <li-chapters-page />
      <li-chapter-panel />
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }

    /* The page and the panel beside it. Positioned, because the panel's scrim
       covers this and nothing above it: the top bar is never taken away. */
    .body {
      position: relative;
      flex: 1;
      display: flex;
      min-height: 0;
      overflow: hidden;
    }

    li-chapters-page {
      flex: 1;
      min-width: 0;
      min-height: 0;
    }
  `,
  host: {
    '(document:keydown)': 'onKey($event)',
  },
})
export class Workspace {
  private readonly settings = inject(SettingsStore);
  private readonly chapters = inject(ChapterStore);
  private readonly stories = inject(StoryStore);
  private readonly dialogs = inject(DialogsService);
  private readonly persistence = inject(Persistence);

  constructor() {
    this.persistence.listen();
    this.watchForOtherDevices();
    // Built here rather than left to the first component that wants it: it
    // watches the chapter for a reply finishing, and a chapter with nothing in
    // it yet has no message list to build it.
    inject(ReadAloud);

    // Once, at start, and only when the reader has left it on — off means the
    // server is never asked, so GitHub is never asked either. Nothing waits
    // for the answer: it is a pill in the top bar or it is nothing.
    const checkForUpdates = this.settings.ui().checkForUpdates;
    if (checkForUpdates) void inject(UpdatesStore).load();
    // The other half of the same switch. The desktop shell runs an updater
    // that downloads the new version and installs it on quit, and it cannot
    // read settings.json by design, so the answer is carried to it from here.
    desktop()
      ?.checkForUpdates(checkForUpdates)
      .catch(() => undefined);

    // And the same again for the proxy. The window has already loaded by here,
    // which is the point of reporting it from the page rather than the shell
    // reading it: whatever the answer, starting up never waits on a proxy.
    desktop()
      ?.useSystemProxy(this.settings.ui().systemProxy)
      .catch(() => undefined);

    // Everything under Preferences that the page can see — the theme, the
    // customised colours of that theme, the face the story is set in — is
    // written onto <html> from here, so a change in the dialog is on the page
    // before the dialog has finished handling the event. The palette under
    // those colours comes from the open chapter, so switching chapters switches
    // pages by the same route.
    effect(() => {
      applyUi(document.documentElement, this.settings.ui(), this.chapters.palette());
    });

    afterNextRender(() => {
      void this.askWhatIsMissing();
    });
  }

  /**
   * Coming back to this tab after writing somewhere else.
   *
   * Only sharing makes this possible at all — a phone on the same network, or
   * a second tab — and there is no live push, so the moment to look is the
   * moment somebody looks at this window again. `Persistence` fetches what
   * moved; the stores read at construction and have to be told to read again,
   * which is this, because only here is it known whether that is safe.
   *
   * Never mid-turn. Reloading the chapters under a streaming reply would
   * throw away the words arriving in it, and there is no hurry: the effect
   * depends on `isStreaming`, so the moment the turn ends it runs and the
   * catching-up happens then.
   */
  private watchForOtherDevices(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (this.chapters.isStreaming()) return;
      void this.persistence.refresh();
    });

    let handled = 0;
    effect(() => {
      const changed = this.persistence.changed();
      if (changed === handled || this.chapters.isStreaming()) return;
      handled = changed;
      // Settings first, because the open story is named in it, and stories
      // before chapters, because which chapters are read depends on which
      // story is open. Untracked: these read documents, not signals, and an
      // effect that depended on what they set would run itself again.
      untracked(() => {
        this.settings.reload();
        this.stories.reload();
        this.chapters.reload();
      });
    });
  }

  /**
   * What a fresh install is asked, in the order it is asked.
   *
   * The connection comes first and insists on an answer: there is no point
   * writing a scene for a model the app cannot reach, and every other
   * question is downstream of this one. It is skipped the moment there is an
   * endpoint and a model, which is every run after the first.
   *
   * Then the story questions, on an install that has never been written in —
   * mode and persona shape every request the chapter will make. Then the
   * scene, because a chapter without one cannot be written into.
   */
  private async askWhatIsMissing(): Promise<void> {
    if (!this.settings.isConnected()) await this.dialogs.openModel(true);
    if (this.chapters.chapter().scene.trim()) return;
    if (this.neverWrittenIn()) await this.dialogs.setUpFirstStory();
    await this.dialogs.openScene(this.chapters.chapter().id, true);
  }

  /** One default story, one empty chapter, nothing typed anywhere yet. */
  private neverWrittenIn(): boolean {
    const story = this.stories.story();
    return (
      story.title === DEFAULT_STORY_TITLE &&
      !story.persona.name.trim() &&
      !story.world.storySoFar.trim() &&
      this.chapters.chapters().length === 1 &&
      this.chapters.isEmpty()
    );
  }

  /**
   * The shortcuts that belong to the page, and only while the page is what is
   * being used.
   *
   * A sheet over the page is a different thing to be typing into: Ctrl+Enter in
   * the scene box would regenerate the last reply behind it, and Ctrl+K would
   * open a second Model sheet on top of the first. Anything that has already
   * been dealt with — a menu answering Escape, a dialog its own shortcut — is
   * left alone for the same reason. And a key held down repeats dozens of times
   * a second, which for these four is never what was meant.
   */
  protected onKey(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.repeat || event.defaultPrevented || this.dialogs.anyOpen()) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      void this.chapters.retryLast();
    } else if (event.key.toLowerCase() === 'k') {
      event.preventDefault();
      void this.dialogs.openModel();
    } else if (event.key === '.') {
      // The chapter panel, in and out. A shortcut rather than a trip to a menu
      // because it is meant to be opened for one edit and shut again.
      event.preventDefault();
      this.settings.setSidebarOpen(!this.settings.ui().sidebarOpen);
    } else if (event.key === ',') {
      // The key every editor uses for its settings, and Preferences is behind
      // the ⋯ menu now rather than on the bar — a click further away, so it
      // gets the shortcut that costs no clicks at all.
      event.preventDefault();
      void this.dialogs.openPreferences();
    }
  }
}
