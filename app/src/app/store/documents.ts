import {
  DEFAULT_ROLEPLAY,
  DEFAULT_SCAN,
  DEFAULT_STORY_TITLE,
  DEFAULT_STYLE,
} from '../core/defaults';
import { CHARACTER_COLOURS } from '../core/character-colours';
import { Chapter, ChapterMessage, Character, Story } from '../core/models';
import { StorageBackend } from './storage';

/**
 * One document per file, the same shape the step-3 server will hold. Both
 * stores go through here so neither has to know how the other is filed —
 * deleting a story can take its chapters with it without a circular import.
 */
export const KEYS = {
  settings: 'settings',
  story: (id: string) => `story:${id}`,
  storyPrefix: 'story:',
  chapter: (id: string) => `chapter:${id}`,
  chapterPrefix: 'chapter:',
} as const;

export function newId(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}

export function newStory(title = DEFAULT_STORY_TITLE): Story {
  return {
    id: newId(),
    title,
    createdAt: now(),
    updatedAt: now(),
    mode: 'narrator',
    narrator: { useDefault: true, prompt: '' },
    characters: [],
    roleplay: { ...DEFAULT_ROLEPLAY },
    persona: { name: '', description: '' },
    style: { ...DEFAULT_STYLE },
    world: {
      storySoFar: '',
      summary: { useDefault: true, prompt: '' },
      entries: [],
      scan: { ...DEFAULT_SCAN },
      extractLore: false,
    },
    activeChapterId: '',
    chapterCounter: 0,
    autoTheme: false,
  };
}

export function newChapter(storyId: string, number: number, scene = '', title = ''): Chapter {
  return {
    id: newId(),
    storyId,
    number,
    title,
    scene,
    status: 'writing',
    summary: '',
    createdAt: now(),
    updatedAt: now(),
    messages: [],
  };
}

export function readStories(storage: StorageBackend): Story[] {
  const stories: Story[] = [];
  for (const key of storage.keys(KEYS.storyPrefix)) {
    const stored = storage.read<Partial<Story>>(key);
    if (stored?.id) stories.push(normaliseStory(stored));
  }
  return stories.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function readChapters(storage: StorageBackend, storyId: string): Chapter[] {
  const chapters: Chapter[] = [];
  for (const key of storage.keys(KEYS.chapterPrefix)) {
    const stored = storage.read<Partial<Chapter>>(key);
    if (stored?.id && stored.storyId === storyId) chapters.push(normaliseChapter(stored));
  }
  return chapters.sort((a, b) => a.number - b.number);
}

/**
 * Every chapter of one story, copied under another and filed under it.
 *
 * Returns the copy's own id for whichever chapter `activeChapterId` names,
 * because the story being copied points at a chapter that belongs to *it*: the
 * one field a duplicate cannot simply carry across.
 */
export function copyStoryChapters(
  storage: StorageBackend,
  from: string,
  to: string,
  activeChapterId: string,
): string {
  let active = '';
  for (const chapter of readChapters(storage, from)) {
    // The server's revision stays with the chapter it was stamped on; see
    // `StoryStore.duplicate`.
    const { rev: _rev, ...original } = structuredClone(chapter);
    const copy = { ...original, id: newId(), storyId: to };
    if (chapter.id === activeChapterId) active = copy.id;
    storage.write(KEYS.chapter(copy.id), copy);
  }
  return active;
}

export function removeStoryDocuments(storage: StorageBackend, storyId: string): void {
  for (const chapter of readChapters(storage, storyId)) {
    storage.remove(KEYS.chapter(chapter.id));
  }
  storage.remove(KEYS.story(storyId));
}

/** Fills in anything a document written by an older version is missing. */
export function normaliseStory(stored: Partial<Story>): Story {
  const base = newStory();
  return {
    ...base,
    ...stored,
    id: stored.id ?? base.id,
    narrator: { ...base.narrator, ...stored.narrator },
    characters: coloured(Array.isArray(stored.characters) ? stored.characters : []),
    // A story written before casting was a choice is an ensemble, which is
    // what it always was.
    roleplay: { ...base.roleplay, ...stored.roleplay },
    persona: { ...base.persona, ...stored.persona },
    style: { ...base.style, ...stored.style },
    world: {
      storySoFar: stored.world?.storySoFar ?? '',
      summary: { ...base.world.summary, ...stored.world?.summary },
      entries: Array.isArray(stored.world?.entries) ? stored.world.entries : [],
      scan: { ...base.world.scan, ...stored.world?.scan },
      extractLore: stored.world?.extractLore === true,
    },
  };
}

/**
 * Every character has a colour, including the ones written before there were
 * any. Taken from their place in the cast rather than from what is free, so a
 * story from an older version opens the same way every time it is opened —
 * and, because the store writes what it read back, only works it out once.
 */
function coloured(characters: Character[]): Character[] {
  return characters.map((character, i) =>
    character.colour
      ? character
      : {
          ...character,
          colour: (CHARACTER_COLOURS[i % CHARACTER_COLOURS.length] ?? CHARACTER_COLOURS[0]).name,
        },
  );
}

export function normaliseChapter(stored: Partial<Chapter>): Chapter {
  const base = newChapter(stored.storyId ?? '', stored.number ?? 1);
  const messages = Array.isArray(stored.messages) ? stored.messages : [];
  return {
    ...base,
    ...stored,
    id: stored.id ?? base.id,
    // A reload mid-stream would otherwise restore a message stuck at "typing".
    // A cast record has no words in it and is kept on the strength of its kind;
    // a message that is nothing but a direction is kept on the strength of it.
    messages: messages.filter(
      (m: ChapterMessage) => m.kind === 'cast' || m.content || m.direction || m.meta?.error,
    ),
  };
}
