import { DEFAULT_ROLEPLAY, DEFAULT_SCAN, DEFAULT_STORY_TITLE, DEFAULT_STYLE } from './defaults';
import { Chapter, Story } from './models';

/**
 * The documents this folder's specs build on. Nothing outside a spec imports
 * this file.
 *
 * `core/` is the layer that depends on nothing: the prompt builder, the lore
 * scan, the speaker labels and the palettes are all pure functions over the
 * models. Five of its specs were reaching into `store/documents` for
 * `newStory` and `newChapter`, which made the layer with no dependencies
 * depend on the filing layer — for its test data alone.
 *
 * These build the same documents from the same `core/defaults`, without the
 * two things only a store wants: a random id and a real clock. A fixture is
 * better off without either — an id a spec can read, and a date that is the
 * same on every run.
 *
 * A field added to `Story` or `Chapter` stops this file compiling, which is
 * what keeps it in step with the documents the app actually writes.
 */

/** Enough to tell two fixtures apart in a failure message. */
let made = 0;

/** Not the day of anything; just not today. */
const AT = '2026-01-01T00:00:00.000Z';

export function newStory(title = DEFAULT_STORY_TITLE): Story {
  return {
    id: `story-${++made}`,
    title,
    createdAt: AT,
    updatedAt: AT,
    mode: 'narrator',
    narrator: { useDefault: true, prompt: '' },
    characters: [],
    roleplay: { ...DEFAULT_ROLEPLAY, instruction: { useDefault: true, prompt: '' } },
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
    id: `chapter-${++made}`,
    storyId,
    number,
    title,
    scene,
    status: 'writing',
    summary: '',
    createdAt: AT,
    updatedAt: AT,
    messages: [],
  };
}
