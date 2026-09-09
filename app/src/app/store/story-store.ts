import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { DEFAULT_STORY_TITLE } from '../core/defaults';
import {
  BlockId,
  Character,
  Instruction,
  LoreCategory,
  LoreEntry,
  RoleplaySettings,
  Story,
} from '../core/models';
import { nextColour } from '../core/character-colours';
import { SettingsStore } from './settings-store';
import { STORAGE_BACKEND } from './storage';
import {
  KEYS,
  copyStoryChapters,
  newId,
  newStory,
  now,
  readStories,
  removeStoryDocuments,
} from './documents';

/**
 * What can be decided about a story before it exists. Everything else about it
 * — its id, when it was made, its cast, its world — is the store's to fill in.
 */
export type NewStory = Partial<Pick<Story, 'title' | 'mode' | 'persona'>>;

/**
 * Every story on this machine, and which one is open. A story is one
 * self-contained document: mode, persona, cast, world. Its chapters are
 * separate documents, held by the ChapterStore.
 */
@Injectable({ providedIn: 'root' })
export class StoryStore {
  private readonly storage = inject(STORAGE_BACKEND);
  private readonly settings = inject(SettingsStore);

  private readonly state = signal<Story[]>(this.load());
  private readonly written = new Map<string, Story>();

  readonly stories = computed(() =>
    [...this.state()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );

  /**
   * Whether the open story is still called what the app called it.
   *
   * Two places ask, and neither should be comparing a title to a constant of
   * its own: the first-run questions open the title box empty rather than with
   * our word already in it, and `ChapterStore.isUntouched` counts it as one of
   * the signs that nobody has started yet.
   */
  readonly isUntitled = computed(() => this.story().title === DEFAULT_STORY_TITLE);

  /** There is always an open story: the app creates one rather than ask. */
  readonly story = computed<Story>(() => {
    const stories = this.state();
    const active = this.settings.settings().activeStoryId;
    return stories.find((s) => s.id === active) ?? stories[0]!;
  });

  constructor() {
    const active = this.settings.settings().activeStoryId;
    if (!this.state().some((s) => s.id === active)) {
      this.settings.setActiveStory(this.state()[0]!.id);
    }
    // Only the documents that actually changed are rewritten.
    effect(() => {
      for (const story of this.state()) {
        if (this.written.get(story.id) === story) continue;
        this.written.set(story.id, story);
        this.storage.write(KEYS.story(story.id), story);
      }
    });
  }

  /**
   * Reads every story again, for a session whose copies were replaced by ones
   * written on another device. The open story may be among the ones that went;
   * `story()` insists there is always one, so a story that is no longer there
   * has to be stood down here rather than found missing later.
   */
  reload(): void {
    const stories = this.load();
    this.written.clear();
    for (const story of stories) this.written.set(story.id, story);
    this.state.set(stories);
    if (!stories.some((story) => story.id === this.settings.settings().activeStoryId)) {
      this.settings.setActiveStory(stories[0]!.id);
    }
  }

  patch(patch: Partial<Story>, id = this.story().id): void {
    this.state.update((stories) =>
      stories.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: now() } : s)),
    );
  }

  select(id: string): void {
    if (this.state().some((s) => s.id === id)) this.settings.setActiveStory(id);
  }

  /**
   * A story, open, with whatever was decided about it before it existed.
   *
   * It has no chapter yet: chapters are `ChapterStore`'s documents, and the
   * invariant that the open story always has one is kept there — this call
   * makes the story the open one, so by the time anything reads a chapter,
   * that store has made the first. `ChapterStore.startStory` is the way in for
   * a flow that needs the chapter in the same breath.
   */
  create(setup: NewStory = {}): Story {
    const story: Story = {
      ...newStory(),
      ...setup,
      title: (setup.title ?? '').trim() || DEFAULT_STORY_TITLE,
    };
    this.state.update((stories) => [...stories, story]);
    this.settings.setActiveStory(story.id);
    return story;
  }

  duplicate(id: string): Story | null {
    const source = this.state().find((s) => s.id === id);
    if (!source) return null;
    // Without the revision the server stamped on the original: that number
    // belongs to the document it was stamped on, and a copy has never been
    // written anywhere. `Persistence` keys revisions by storage key rather
    // than reading them off the document, so nothing was broken by carrying
    // one — but a new document claiming to be a revision of something is a
    // sentence that is simply not true.
    const { rev: _rev, ...original } = structuredClone(source);
    const copy: Story = {
      ...original,
      id: newId(),
      title: `${source.title} (copy)`,
      createdAt: now(),
      updatedAt: now(),
    };
    // Chapters are documents of their own, so the copy needs its own set —
    // filed by the module that knows how a story's chapters are filed.
    copy.activeChapterId = copyStoryChapters(
      this.storage,
      source.id,
      copy.id,
      source.activeChapterId,
    );
    this.state.update((stories) => [...stories, copy]);
    this.settings.setActiveStory(copy.id);
    return copy;
  }

  /** Deletes the story and every chapter filed under it. */
  delete(id: string): void {
    removeStoryDocuments(this.storage, id);
    this.written.delete(id);
    const remaining = this.state().filter((s) => s.id !== id);
    this.state.set(remaining);
    if (!remaining.length) {
      this.create();
    } else if (this.settings.settings().activeStoryId === id) {
      this.settings.setActiveStory(remaining[0]!.id);
    }
  }

  // -- cast -----------------------------------------------------------------

  /**
   * How role-play is cast, and who is being played. The chapter store is what
   * calls these: a change mid-chapter is also a record in the chapter, and it
   * is the one place that knows where in the chapter "now" is.
   */
  patchRoleplay(patch: Partial<RoleplaySettings>): void {
    this.patch({ roleplay: { ...this.story().roleplay, ...patch } });
  }

  addCharacter(name = ''): Character {
    const cast = this.story().characters;
    const character: Character = {
      id: newId(),
      name,
      description: '',
      enabled: true,
      // Nobody is asked to choose: the first ten in a story are all different.
      colour: nextColour(cast.map((c) => c.colour)),
    };
    this.patch({ characters: [...cast, character] });
    return character;
  }

  /** One of the ten, chosen from the swatch on the character's row. */
  setCharacterColour(id: string, colour: string): void {
    this.patchCharacter(id, { colour, colourOverride: undefined });
  }

  /**
   * A colour of their own, from Preferences. Passing nothing puts the palette
   * back: an override is stored as an override, so forgetting it *is* the
   * palette colour, exactly as the reading palette works.
   */
  setCharacterColourOverride(id: string, colour: string | null): void {
    this.patchCharacter(id, { colourOverride: colour ?? undefined });
  }

  patchCharacter(id: string, patch: Partial<Character>): void {
    this.patch({
      characters: this.story().characters.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  }

  removeCharacter(id: string): void {
    this.patch({ characters: this.story().characters.filter((c) => c.id !== id) });
  }

  // -- world ----------------------------------------------------------------

  setStorySoFar(text: string): void {
    this.patch({ world: { ...this.story().world, storySoFar: text } });
  }

  /**
   * What "close chapter" does with the summary it just wrote: replace the story
   * so far rather than append to it. The model was handed the old text and
   * asked to fold this chapter into it, so what comes back is the whole story
   * — and the summary stays one readable page however long the story runs.
   */
  replaceStorySoFar(summary: string): void {
    const text = summary.trim();
    if (text) this.setStorySoFar(text);
  }

  /**
   * The narrator's preamble: the switch under Story, the box under Story, and
   * the box in the chapter panel, which adopts ours by writing into it. All
   * three are this, so that "whose words are these" is one field of one
   * document and not three spellings of a patch.
   */
  setNarrator(patch: Partial<Instruction>): void {
    this.patch({ narrator: { ...this.story().narrator, ...patch } });
  }

  setSummaryPrompt(patch: Partial<Instruction>): void {
    const world = this.story().world;
    this.patch({ world: { ...world, summary: { ...world.summary, ...patch } } });
  }

  patchScan(patch: Partial<Story['world']['scan']>): void {
    const world = this.story().world;
    this.patch({ world: { ...world, scan: { ...world.scan, ...patch } } });
  }

  addLore(category: LoreCategory = 'fact'): LoreEntry {
    const entry: LoreEntry = {
      id: newId(),
      title: '',
      category,
      keys: [],
      content: '',
      enabled: true,
      alwaysOn: false,
    };
    const world = this.story().world;
    this.patch({ world: { ...world, entries: [...world.entries, entry] } });
    return entry;
  }

  patchLore(id: string, patch: Partial<LoreEntry>): void {
    const world = this.story().world;
    this.patch({
      world: {
        ...world,
        entries: world.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      },
    });
  }

  duplicateLore(id: string): void {
    const world = this.story().world;
    const source = world.entries.find((e) => e.id === id);
    if (!source) return;
    const copy: LoreEntry = {
      ...structuredClone(source),
      id: newId(),
      title: `${source.title} (copy)`,
    };
    const index = world.entries.indexOf(source);
    const entries = [...world.entries];
    entries.splice(index + 1, 0, copy);
    this.patch({ world: { ...world, entries } });
  }

  /** Whether closing a chapter also asks what it established. */
  setExtractLore(extractLore: boolean): void {
    const world = this.story().world;
    this.patch({ world: { ...world, extractLore } });
  }

  /**
   * Files what the writer ticked in the close-chapter sheet: an entry whose id
   * the world already holds is rewritten where it stands, and the rest are
   * appended. One patch, so a chapter close is one write however many entries
   * came out of it.
   */
  saveLore(entries: readonly LoreEntry[]): void {
    if (!entries.length) return;
    const world = this.story().world;
    const changed = new Map(entries.map((entry) => [entry.id, entry]));
    const rewritten = world.entries.map((entry) => changed.get(entry.id) ?? entry);
    const added = entries.filter((entry) => !world.entries.some((e) => e.id === entry.id));
    this.patch({ world: { ...world, entries: [...rewritten, ...added] } });
  }

  removeLore(id: string): void {
    const world = this.story().world;
    this.patch({ world: { ...world, entries: world.entries.filter((e) => e.id !== id) } });
  }

  // -- the shape of the prompt ----------------------------------------------

  /**
   * The order this story's movable blocks are assembled in. Stored per story
   * because it is a judgement about the story and the model behind it, not a
   * preference about the app.
   */
  setPromptOrder(order: BlockId[], id = this.story().id): void {
    this.patch({ promptOrder: [...order] }, id);
  }

  /** Back to the shipped order, with nothing left in the document to say so. */
  resetPromptOrder(id = this.story().id): void {
    this.state.update((stories) =>
      stories.map((story) => {
        if (story.id !== id) return story;
        const { promptOrder: _shipped, ...rest } = story;
        return { ...rest, updatedAt: now() };
      }),
    );
  }

  // -- chapters (the story's side of them) -----------------------------------

  setActiveChapter(id: string): void {
    this.patch({ activeChapterId: id });
  }

  /** Numbers only ever go up: chapter 3 stays chapter 3 after a deletion. */
  takeChapterNumber(): number {
    const next = this.story().chapterCounter + 1;
    this.patch({ chapterCounter: next });
    return next;
  }

  /**
   * An install with nothing in it gets one story, so there is always one open.
   * Its first chapter is `ChapterStore`'s to make, and it makes it as soon as
   * it is built — which is immediately, since it is built on this one.
   */
  private load(): Story[] {
    const stored = readStories(this.storage);
    if (stored.length) return stored;

    const story = newStory();
    this.storage.write(KEYS.story(story.id), story);
    return [story];
  }
}
