import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Chapter, ChapterMessage, LoreEntry } from '../core/models';
import { PagePalette, pagePalette } from '../core/page-palettes';
import { activeCharacter, chapterName, isOneAtATime, writtenIn } from '../core/prompt-builder';
import { CastState, castState, withCastRecord } from './cast-records';
import { SettingsStore } from './settings-store';
import { NewStory, StoryStore } from './story-store';
import { STORAGE_BACKEND } from './storage';
import { KEYS, newChapter, now, readChapters } from './documents';

/** Why the composer is closed, and the one button that opens it again. */
export interface WriteBlock {
  reason: string;
  action: 'scene' | 'connection' | 'continue' | null;
}

/**
 * The chapters of the open story: the documents, the cast records filed in
 * them, and the one rule about writing into them.
 *
 * Nothing here talks to a model. What a request carries, and what arrives back
 * of it, is `ChapterRequests` — built on this store, and writing into a
 * chapter through `update` like anything else does, or, while a reply is
 * arriving, through the five methods under *what a turn writes*. That split is
 * why a spec about chapters needs neither an endpoint nor a paint frame: this
 * file has never heard of either.
 */
@Injectable({ providedIn: 'root' })
export class ChapterStore {
  private readonly storage = inject(STORAGE_BACKEND);
  private readonly settings = inject(SettingsStore);
  private readonly stories = inject(StoryStore);

  private readonly state = signal<Chapter[]>([]);
  private readonly streamingIdState = signal<string | null>(null);
  private readonly saved = new Map<string, Chapter>();
  private loadedStoryId = '';

  readonly chapters = this.state.asReadonly();

  /**
   * Which message a reply is arriving into, or none.
   *
   * Turn state, and yet here, because everything that reads it is asking about
   * the chapter in front of it: the composer's Stop, the caret on the message,
   * the toolbar, the reading voice waiting for a paragraph to finish, and the
   * catching-up that will not run mid-reply. `ChapterRequests` sets it at both
   * ends of a turn; nothing else may.
   */
  readonly streamingId = this.streamingIdState.asReadonly();
  readonly isStreaming = computed(() => this.streamingIdState() !== null);

  /** The chapter being read or written. There is always one. */
  readonly chapter = computed<Chapter>(() => {
    const chapters = this.state();
    const active = this.stories.story().activeChapterId;
    return chapters.find((c) => c.id === active) ?? chapters[chapters.length - 1]!;
  });

  readonly messages = computed(() => this.chapter().messages);

  /**
   * The page everything is drawn on: the open chapter's own, or the one chosen
   * under Preferences, or none at all — which is the theme as it ships.
   * `Workspace` hands it to `applyUi`, so switching chapters switches pages.
   */
  readonly palette = computed<PagePalette | null>(() =>
    pagePalette(this.chapter().palette || this.settings.ui().palette),
  );

  /** What the chapter reads as: the records of the cast changing are not it. */
  readonly written = computed(() => writtenIn(this.chapter()));
  readonly isEmpty = computed(() => this.written().length === 0);
  readonly hasScene = computed(() => !!this.chapter().scene.trim());
  readonly isClosed = computed(() => this.chapter().status === 'closed');

  /**
   * A story nobody has started: our own title, no persona, no story so far,
   * one chapter, and nothing written in it.
   *
   * Here rather than in `Workspace`, which is the one thing that asks it, for
   * two reasons: it is a question about the documents and this is where they
   * are, and a component cannot be held to it by a spec. Five tests and every
   * one of them a way somebody could have begun — a title, a persona, a
   * paragraph of story, a second chapter, a line of prose — because what turns
   * on the answer is whether the app opens the first-run questions over the
   * story that is already there.
   */
  readonly isUntouched = computed(() => {
    const story = this.stories.story();
    return (
      this.stories.isUntitled() &&
      !story.persona.name.trim() &&
      !story.world.storySoFar.trim() &&
      this.chapters().length === 1 &&
      this.isEmpty()
    );
  });

  /**
   * The one compulsory step in the app: a chapter cannot be written into until
   * its scene is written.
   */
  readonly writeBlock = computed<WriteBlock>(() => {
    if (!this.hasScene()) {
      return { reason: 'This chapter has no scene yet', action: 'scene' };
    }
    if (this.isClosed()) {
      return { reason: `${chapterName(this.chapter())} is closed`, action: 'continue' };
    }
    if (!this.settings.isConnected()) {
      return { reason: this.settings.connectionHint(), action: 'connection' };
    }
    return { reason: '', action: null };
  });

  readonly canWrite = computed(() => !this.writeBlock().action);

  constructor() {
    this.loadFor(this.stories.story().id);
    // A story switch is answered here rather than announced by whoever made
    // it. `loadFor` records the story it read, so the one flow that switches
    // and loads in the same breath — `startStory` — is not read twice.
    effect(() => {
      const storyId = this.stories.story().id;
      if (storyId !== this.loadedStoryId) this.loadFor(storyId);
    });
    effect(() => {
      for (const chapter of this.state()) {
        if (this.saved.get(chapter.id) === chapter) continue;
        this.saved.set(chapter.id, chapter);
        this.storage.write(KEYS.chapter(chapter.id), chapter);
      }
    });
  }

  /**
   * Reads the open story's chapters again, for a session whose copies were
   * replaced by ones written on another device. The same path a story switch
   * takes, because it is the same question — what are this story's chapters —
   * asked of a folder that has changed rather than of a different folder.
   */
  reload(): void {
    this.loadFor(this.stories.story().id);
  }

  /** Both halves of a message at once: an edit can remove either of them. */
  editMessage(id: string, content: string, direction = ''): void {
    this.patchChapter(this.chapter().id, (chapter) => ({
      messages: chapter.messages.map((m) =>
        m.id === id
          ? { ...m, content, direction: direction.trim() || undefined, editedAt: now() }
          : m,
      ),
    }));
  }

  deleteMessage(id: string): void {
    if (this.streamingIdState() === id) this.endTurn();
    this.patchChapter(this.chapter().id, (chapter) => ({
      messages: chapter.messages.filter((m) => m.id !== id),
    }));
  }

  clearMessages(): void {
    this.endTurn();
    this.patchChapter(this.chapter().id, () => ({ messages: [] }));
  }

  // -- the cast, as the chapter sees it -------------------------------------

  /** The character the model is playing, or none in an ensemble. */
  readonly playing = computed(() =>
    isOneAtATime(this.stories.story()) ? activeCharacter(this.stories.story()) : null,
  );

  /** Hands the model a different character to be, from here on. */
  setActiveCharacter(id: string): void {
    const story = this.stories.story();
    if (story.roleplay.activeCharacterId === id) return;
    const was = castState(story);
    this.stories.patchRoleplay({ activeCharacterId: id });
    this.recordCast(was);
  }

  /** In the scene, or out of it. A change either way is told to the model. */
  setCharacterEnabled(id: string, enabled: boolean): void {
    const story = this.stories.story();
    if (story.characters.find((c) => c.id === id)?.enabled === enabled) return;
    const was = castState(story);
    this.stories.patchCharacter(id, { enabled });
    this.recordCast(was);
  }

  /**
   * A change to the cast, filed where in the chapter it happened. What a
   * record means, and when there is one worth filing, is `cast-records.ts`.
   */
  private recordCast(was: CastState): void {
    const chapter = this.chapter();
    // Before the first word there is nothing for a record to sit between: the
    // mode block already opens by saying who is on stage.
    if (!chapter.messages.length) return;

    this.patchChapter(chapter.id, (current) => ({
      messages: withCastRecord(current.messages, this.stories.story(), was),
    }));
  }

  // -- the chapters themselves ----------------------------------------------

  /**
   * A story of one's own, and the chapter that is going to be written in it.
   *
   * Both documents exist by the time this returns, which is what lets the flow
   * behind it open the scene sheet on the new chapter in the same breath. The
   * story is `StoryStore`'s to make and the chapter is this store's, so the
   * two are put together here — the store that already follows the open story
   * — rather than in the service that opens the sheets.
   */
  startStory(setup: NewStory = {}): Chapter {
    const story = this.stories.create(setup);
    // `loadFor` finds no chapters filed under a story that has just been made,
    // and makes the first one, which is the invariant this store keeps.
    this.loadFor(story.id);
    return this.chapter();
  }

  /**
   * A new chapter exists the moment it is asked for, with the scene still
   * empty; the scene sheet opens over it and the composer waits.
   */
  createChapter(scene = '', title = ''): Chapter {
    const story = this.stories.story();
    const chapter = newChapter(story.id, this.stories.takeChapterNumber(), scene, title);
    this.state.update((chapters) => [...chapters, chapter]);
    this.stories.setActiveChapter(chapter.id);
    return chapter;
  }

  open(id: string): void {
    if (this.state().some((c) => c.id === id)) this.stories.setActiveChapter(id);
  }

  update(id: string, patch: Partial<Chapter>): void {
    this.patchChapter(id, () => patch);
  }

  /** Flips a closed chapter back to `writing`, from the Chapters list. */
  continueChapter(id: string): void {
    this.patchChapter(id, () => ({ status: 'writing' }));
    this.open(id);
  }

  /**
   * Closing a chapter, as one act.
   *
   * Three documents move together — the entries the writer kept, the chapter's
   * own status and summary, and the story so far the summary replaces — and
   * there is no state of the world in which some of them should happen and the
   * rest should not. The entries go first, because they are what the chapter
   * established and the chapter is about to stop being the one being written.
   *
   * Nothing is discarded: the chapter keeps its messages and its own summary.
   */
  closeChapter(id: string, summary: string, entries: readonly LoreEntry[] = []): void {
    this.stories.saveLore(entries);
    this.patchChapter(id, () => ({ status: 'closed', summary: summary.trim() }));
    this.stories.replaceStorySoFar(summary);
  }

  /** A deliberate act from the Chapters list; numbers are never reused. */
  deleteChapter(id: string): void {
    const remaining = this.state().filter((c) => c.id !== id);
    this.storage.remove(KEYS.chapter(id));
    this.saved.delete(id);
    this.state.set(remaining);
    if (!remaining.length) {
      this.createChapter();
    } else if (this.stories.story().activeChapterId === id) {
      this.stories.setActiveChapter(remaining[remaining.length - 1]!.id);
    }
  }

  /** The chapter's own page, chosen by hand; empty gives it back to the story. */
  setPalette(id: string, name: string): void {
    this.patchChapter(id, () => ({ palette: name || undefined }));
  }

  // -- what a turn writes ----------------------------------------------------
  //
  // `ChapterRequests` owns the request, the abort and the deltas; the chapter
  // it is filling in is still this store's. These five are all it is given for
  // that, on purpose — a service that could reach `state` for itself would be a
  // second place chapters are edited, and the effect that saves them would have
  // two authors to keep up with.

  /** Both ends of a turn, and the caret in between. */
  markStreaming(id: string | null): void {
    this.streamingIdState.set(id);
  }

  /** The writer's message, and the empty reply the deltas land in. */
  appendMessage(message: ChapterMessage): void {
    this.patchChapter(this.chapter().id, (chapter) => ({
      messages: [...chapter.messages, message],
    }));
  }

  /**
   * One message of one chapter, from what it is now.
   *
   * A function rather than a patch, because a delta is the text so far and a
   * little more. And the chapter is named rather than taken from `chapter()`,
   * because a reply can still be arriving into a chapter the reader has left.
   */
  patchMessage(
    chapterId: string,
    id: string,
    patch: (message: ChapterMessage) => Partial<ChapterMessage>,
  ): void {
    this.patchChapter(chapterId, (chapter) => ({
      messages: chapter.messages.map((m) => (m.id === id ? { ...m, ...patch(m) } : m)),
    }));
  }

  /** Regenerate and replay: everything from a point on is asked again. */
  truncateTo(length: number): void {
    this.patchChapter(this.chapter().id, (chapter) => ({
      messages: chapter.messages.slice(0, length),
    }));
  }

  /**
   * A chapter written to disk now rather than at the end of the frame.
   *
   * The effect in the constructor is how a chapter is normally saved, and it
   * is enough for every edit made to the chapter in front of the reader. It is
   * not enough for a reply that ended as the reader moved to another story: by
   * the time the effect runs, this store holds a different story's chapters
   * and the one with the words in it is not among them. So it goes straight
   * through, and `saved` is told, so the effect does not write it again.
   */
  keepChapter(chapterId: string): void {
    this.patchChapter(chapterId, () => ({}));
    const chapter = this.state().find((c) => c.id === chapterId);
    if (!chapter) return;
    this.saved.set(chapter.id, chapter);
    this.storage.write(KEYS.chapter(chapter.id), chapter);
  }

  /**
   * A turn that cannot go on, because what it is writing into is going away:
   * the story switched under it, the message it was filling was deleted, the
   * chapter was cleared.
   *
   * A hook rather than a call. `ChapterRequests` is the only thing that can
   * abort a request, and it is built on this store, so this store cannot be
   * built on it — while the moment to abort is visible only from in here,
   * inside `loadFor`, between reading the new story's chapters and putting
   * them in the signal. A store with nothing sending has nothing to run.
   */
  private endTurn: () => void = () => undefined;

  /** Registered once, by the service that owns the turn. */
  whenTurnsMustEnd(end: () => void): void {
    this.endTurn = end;
  }

  private patchChapter(id: string, patch: (chapter: Chapter) => Partial<Chapter>): void {
    this.state.update((chapters) =>
      chapters.map((c) => (c.id === id ? { ...c, ...patch(c), updatedAt: now() } : c)),
    );
  }

  /** Switching stories swaps the whole set; every story keeps one chapter. */
  private loadFor(storyId: string): void {
    this.loadedStoryId = storyId;
    this.endTurn();
    this.saved.clear();
    const chapters = readChapters(this.storage, storyId);
    for (const chapter of chapters) this.saved.set(chapter.id, chapter);
    this.state.set(chapters);
    if (!chapters.length) this.createChapter();
    else if (!chapters.some((c) => c.id === this.stories.story().activeChapterId)) {
      this.stories.setActiveChapter(chapters[chapters.length - 1]!.id);
    }
  }
}
