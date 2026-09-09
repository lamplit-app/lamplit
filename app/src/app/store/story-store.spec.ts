import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Chapter, Story } from '../core/models';
import { KEYS, readChapters } from './documents';
import { SettingsStore } from './settings-store';
import { StoryStore } from './story-store';
import { STORAGE_BACKEND } from './storage';
import { InMemoryStorage } from './testing/in-memory-storage';

const STORY_ID = 'story-1';

/**
 * Duplicating a story is the one operation that writes the file format rather
 * than reading it: a story document and a chapter document each, all with new
 * ids, and one id inside the story that has to be pointed at the new chapter
 * rather than the old one. Get that last part wrong and the copy opens on a
 * chapter belonging to the story it was copied from — which reads as the copy
 * having worked, right up until either of them is edited.
 */
describe('StoryStore and duplicating a story', () => {
  let storage: InMemoryStorage;

  /** A story of three chapters, open on the second. */
  function seed(): void {
    storage.write(KEYS.settings, {
      connection: { provider: 'nanogpt', baseUrl: 'https://x/v1', apiKey: '', model: 'm' },
      activeStoryId: STORY_ID,
    });
    storage.write(KEYS.story(STORY_ID), {
      id: STORY_ID,
      title: 'The Lamplighter',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      activeChapterId: 'chapter-2',
      chapterCounter: 3,
      persona: { name: 'Elin', description: 'A keeper of lamps.' },
      world: {
        storySoFar: 'The lamps have been lit since spring.',
        entries: [{ id: 'lore-1', title: 'The lighthouse', keys: ['light'], content: 'Tall.' }],
      },
    });
    for (const number of [1, 2, 3]) {
      storage.write(KEYS.chapter(`chapter-${number}`), {
        id: `chapter-${number}`,
        storyId: STORY_ID,
        number,
        title: `Chapter ${number}`,
        scene: 'A scene.',
        status: number === 3 ? 'writing' : 'closed',
        summary: '',
        messages: [{ id: `m-${number}`, role: 'user', content: 'The keeper went up.' }],
      });
    }
  }

  const stories = () => TestBed.inject(StoryStore);
  const chaptersOf = (story: Story): Chapter[] => readChapters(storage, story.id);

  beforeEach(() => {
    storage = new InMemoryStorage();
    TestBed.configureTestingModule({
      providers: [{ provide: STORAGE_BACKEND, useValue: storage }],
    });
    seed();
  });

  it('makes a copy that says it is one, and opens it', () => {
    const copy = stories().duplicate(STORY_ID)!;

    expect(copy.title).toBe('The Lamplighter (copy)');
    expect(copy.id).not.toBe(STORY_ID);
    expect(stories().story().id).toBe(copy.id);
    expect(TestBed.inject(SettingsStore).settings().activeStoryId).toBe(copy.id);
  });

  it('gives the copy chapters of its own, filed under it and in order', () => {
    const copy = stories().duplicate(STORY_ID)!;
    const copied = chaptersOf(copy);

    expect(copied.map((c) => c.number)).toEqual([1, 2, 3]);
    expect(copied.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3']);
    expect(copied.every((c) => c.storyId === copy.id)).toBe(true);
    // Every id is new, and no two of them are the same.
    const ids = copied.map((c) => c.id);
    expect(ids.some((id) => id.startsWith('chapter-'))).toBe(false);
    expect(new Set(ids).size).toBe(3);
  });

  it('opens the copy on the chapter the original was open on', () => {
    const copy = stories().duplicate(STORY_ID)!;
    const open = chaptersOf(copy).find((c) => c.id === copy.activeChapterId);

    expect(open?.number).toBe(2);
    // And not at the chapter it was copied from, which belongs to the original.
    expect(copy.activeChapterId).not.toBe('chapter-2');
  });

  it('leaves the story it was copied from exactly as it was', () => {
    const before = storage.read<Story>(KEYS.story(STORY_ID))!;
    const copy = stories().duplicate(STORY_ID)!;

    const source = stories()
      .stories()
      .find((s) => s.id === STORY_ID)!;
    expect(source.title).toBe('The Lamplighter');
    expect(source.activeChapterId).toBe('chapter-2');
    expect(chaptersOf(source).map((c) => c.id)).toEqual(['chapter-1', 'chapter-2', 'chapter-3']);
    expect(storage.read<Story>(KEYS.story(STORY_ID))).toEqual(before);

    // Two documents, not one document under two names: the copy's world can be
    // rewritten without a word of the original changing.
    stories().patch({ world: { ...copy.world, storySoFar: 'Rewritten.' } }, copy.id);
    expect(
      stories()
        .stories()
        .find((s) => s.id === STORY_ID)!.world.storySoFar,
    ).toBe('The lamps have been lit since spring.');
  });

  it('brings everything the story is made of with it', () => {
    const copy = stories().duplicate(STORY_ID)!;

    expect(copy.persona).toEqual({ name: 'Elin', description: 'A keeper of lamps.' });
    expect(copy.world.storySoFar).toBe('The lamps have been lit since spring.');
    expect(copy.world.entries).toHaveLength(1);
    expect(copy.chapterCounter).toBe(3);
    expect(chaptersOf(copy)[1].messages).toHaveLength(1);
  });

  it('does nothing at all when asked to copy a story that is not there', () => {
    const before = [...storage.documents.keys()].sort();

    expect(stories().duplicate('no-such-story')).toBeNull();
    expect([...storage.documents.keys()].sort()).toEqual(before);
    expect(stories().story().id).toBe(STORY_ID);
  });
});
