import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChapterStore } from './chapter-store';
import { StoryStore } from './story-store';
import { KEYS } from './documents';
import { STORAGE_BACKEND } from './storage';
import { InMemoryStorage } from './testing/in-memory-storage';

/**
 * The documents and the rules about them. Not a single one of these tests
 * provides a `ModelClient`, and that is the point of the split: this store
 * cannot reach an endpoint, so a spec about chapters cannot need a fake one.
 * What a request carries and what comes back of it is in
 * `chapter-requests.spec.ts`.
 */
const STORY_ID = 'story-1';
const CHAPTER_ID = 'chapter-1';

describe('ChapterStore and the page it is drawn on', () => {
  let storage: InMemoryStorage;

  /** Seeded before the store is built: it reads its documents at construction. */
  function seed(chapter: Record<string, unknown> = {}): void {
    storage.write(KEYS.settings, {
      connection: { provider: 'nanogpt', baseUrl: 'https://x/v1', apiKey: '', model: 'm' },
      activeStoryId: STORY_ID,
    });
    storage.write(KEYS.story(STORY_ID), {
      id: STORY_ID,
      title: 'A story',
      updatedAt: '2026-01-01T00:00:00.000Z',
      activeChapterId: CHAPTER_ID,
      chapterCounter: 1,
    });
    storage.write(KEYS.chapter(CHAPTER_ID), {
      id: CHAPTER_ID,
      storyId: STORY_ID,
      number: 1,
      title: '',
      scene: 'A monastery under snow.',
      status: 'writing',
      summary: '',
      messages: [],
      ...chapter,
    });
  }

  const store = () => TestBed.inject(ChapterStore);
  const chapter = () => store().chapters()[0];

  beforeEach(() => {
    storage = new InMemoryStorage();
    TestBed.configureTestingModule({
      providers: [{ provide: STORAGE_BACKEND, useValue: storage }],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('draws the open chapter on its own page, and the story on its own', () => {
    seed({ palette: 'tide' });

    expect(store().palette()?.name).toBe('tide');
    // Given back by hand, the chapter falls through to what Preferences says —
    // which, in a settings file that has never chosen one, is nothing.
    store().setPalette(CHAPTER_ID, '');
    expect(chapter().palette).toBeUndefined();
    expect(store().palette()).toBeNull();
  });
});

describe('ChapterStore and losing a chapter', () => {
  let storage: InMemoryStorage;

  /** Three chapters, open on the second, and a message in each. */
  function seed(): void {
    storage.write(KEYS.settings, {
      connection: { provider: 'nanogpt', baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' },
      activeStoryId: STORY_ID,
    });
    storage.write(KEYS.story(STORY_ID), {
      id: STORY_ID,
      title: 'A story',
      updatedAt: '2026-01-01T00:00:00.000Z',
      activeChapterId: 'chapter-2',
      chapterCounter: 3,
      autoTheme: false,
    });
    for (const number of [1, 2, 3]) {
      storage.write(KEYS.chapter(`chapter-${number}`), {
        id: `chapter-${number}`,
        storyId: STORY_ID,
        number,
        title: '',
        scene: `Scene ${number}.`,
        status: 'writing',
        summary: '',
        messages: [{ id: `m-${number}`, role: 'user', content: 'The bell rings.' }],
      });
    }
  }

  const store = () => TestBed.inject(ChapterStore);

  beforeEach(() => {
    storage = new InMemoryStorage();
    TestBed.configureTestingModule({
      providers: [{ provide: STORAGE_BACKEND, useValue: storage }],
    });
    seed();
  });

  afterEach(() => vi.restoreAllMocks());

  it('takes the document with it, not just the row in the list', () => {
    store().deleteChapter('chapter-1');

    expect(
      store()
        .chapters()
        .map((c) => c.id),
    ).toEqual(['chapter-2', 'chapter-3']);
    expect(storage.read(KEYS.chapter('chapter-1'))).toBeNull();
  });

  it('leaves the open chapter open when it was another one that went', () => {
    store().deleteChapter('chapter-3');

    expect(store().chapter().id).toBe('chapter-2');
  });

  it('opens the last chapter left when the open one is the one deleted', () => {
    store().deleteChapter('chapter-2');

    expect(store().chapter().id).toBe('chapter-3');
    expect(TestBed.inject(StoryStore).story().activeChapterId).toBe('chapter-3');
  });

  it('never leaves a story with no chapter in it', () => {
    for (const id of ['chapter-1', 'chapter-2', 'chapter-3']) store().deleteChapter(id);

    const chapters = store().chapters();
    expect(chapters).toHaveLength(1);
    expect(chapters[0].id).not.toBe('chapter-3');
    expect(store().chapter().id).toBe(chapters[0].id);
    // Empty, waiting for its scene, and numbered after the three that went:
    // a chapter 3 that was deleted does not come back as chapter 3.
    expect(chapters[0].messages).toEqual([]);
    expect(chapters[0].scene).toBe('');
    expect(chapters[0].number).toBe(4);
  });

  it('clearing a chapter takes the messages and leaves the chapter', () => {
    store().clearMessages();

    const chapter = store().chapter();
    expect(chapter.id).toBe('chapter-2');
    expect(chapter.messages).toEqual([]);
    expect(chapter.scene).toBe('Scene 2.');
    expect(chapter.number).toBe(2);
    // The other chapters are not touched by it.
    expect(store().chapters()[2].messages).toHaveLength(1);
  });
});

/**
 * Every open story has a chapter to write in, and exactly one when it is new.
 * The story document is `StoryStore`'s and the chapter document is this
 * store's, so the invariant is kept here — which means it has to hold for a
 * story made by `create` and left to the effect, and for one made through
 * `startStory` and read from in the same breath.
 */
describe('ChapterStore and a story that has just been made', () => {
  let storage: InMemoryStorage;

  const store = () => TestBed.inject(ChapterStore);
  const stories = () => TestBed.inject(StoryStore);

  beforeEach(() => {
    storage = new InMemoryStorage();
    TestBed.configureTestingModule({
      providers: [{ provide: STORAGE_BACKEND, useValue: storage }],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('gives an install with nothing in it one story and one chapter', () => {
    const chapters = store().chapters();

    expect(stories().stories()).toHaveLength(1);
    expect(chapters).toHaveLength(1);
    expect(chapters[0].storyId).toBe(stories().story().id);
    expect(chapters[0].number).toBe(1);
    expect(store().chapter().id).toBe(chapters[0].id);
    // Filed as well as held, so a reload finds it. Written by the same effect
    // that writes every other change to a chapter, hence the tick.
    TestBed.tick();
    expect(storage.read(KEYS.chapter(chapters[0].id))).toBeTruthy();
  });

  it('hands back the new story’s first chapter, there and then', () => {
    const first = store().chapter().id;

    const chapter = store().startStory({ title: 'The Lamplighter', mode: 'roleplay' });

    expect(chapter.id).not.toBe(first);
    expect(stories().story().title).toBe('The Lamplighter');
    expect(stories().story().mode).toBe('roleplay');
    expect(chapter.storyId).toBe(stories().story().id);
    expect(chapter.number).toBe(1);
    // The one the app is now writing in, without waiting for anything.
    expect(
      store()
        .chapters()
        .map((c) => c.id),
    ).toEqual([chapter.id]);
    expect(store().chapter().id).toBe(chapter.id);
    expect(stories().story().activeChapterId).toBe(chapter.id);
  });

  it('does not make a second chapter when the effect catches up afterwards', () => {
    const chapter = store().startStory({ title: 'The Lamplighter' });
    TestBed.tick();

    expect(
      store()
        .chapters()
        .map((c) => c.id),
    ).toEqual([chapter.id]);
  });

  it('gives the last story deleted a fresh story with a chapter in it', () => {
    stories().delete(stories().story().id);
    TestBed.tick();

    expect(stories().stories()).toHaveLength(1);
    expect(store().chapters()).toHaveLength(1);
    expect(store().chapter().storyId).toBe(stories().story().id);
  });

  /**
   * What the app asks before it puts the first-run questions over a story that
   * already exists — it always exists, because the app makes one rather than
   * ask. The test lived in `Workspace`, where nothing could hold it; each of
   * these five is a way somebody could already have begun, and any one of them
   * means the questions would be asked over their work.
   */
  describe('and whether anybody has begun', () => {
    it('is untouched on an install with nothing in it', () => {
      expect(store().isUntouched()).toBe(true);
    });

    it('is not, the moment the story has a name of its own', () => {
      stories().patch({ title: 'The Lighthouse' });
      expect(store().isUntouched()).toBe(false);
    });

    it('is not, once there is a persona or a story so far', () => {
      stories().patch({ persona: { name: 'Mara', description: '' } });
      expect(store().isUntouched()).toBe(false);

      stories().patch({ persona: { name: '', description: '' } });
      expect(store().isUntouched()).toBe(true);

      stories().setStorySoFar('She arrived on the island.');
      expect(store().isUntouched()).toBe(false);
    });

    it('is not, once a line has been written or a second chapter started', () => {
      store().update(store().chapter().id, {
        messages: [{ id: 'm1', role: 'user', content: 'I knock.', createdAt: '' }],
      });
      expect(store().isUntouched()).toBe(false);

      store().clearMessages();
      expect(store().isUntouched()).toBe(true);

      store().createChapter('A second scene.');
      expect(store().isUntouched()).toBe(false);
    });
  });
});
