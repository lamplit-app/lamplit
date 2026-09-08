import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChatStreamResult,
  JsonChatRequest,
  JsonChatResult,
  ModelClient,
} from '../core/model-client';
import { DEFAULT_GENERATION } from '../core/defaults';
import { errorFromResponse } from '../core/model-errors';
import { ChapterStore } from './chapter-store';
import { SettingsStore } from './settings-store';
import { StoryStore } from './story-store';
import { KEYS } from './documents';
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

/** An endpoint that answers whatever the test told it to, and counts. */
class FakeClient {
  answer: JsonChatResult<unknown> = { value: { palette: 'frost' }, raw: '{"palette":"frost"}' };
  readonly requests: JsonChatRequest[] = [];

  chatJson = <T>(request: JsonChatRequest): Promise<JsonChatResult<T>> => {
    this.requests.push(request);
    return Promise.resolve(this.answer as JsonChatResult<T>);
  };

  /** Sends one delta and then waits, the way a reply half-way through does. */
  streamChat = (
    _request: unknown,
    onDelta: (delta: { content?: string }) => void,
    signal: AbortSignal,
  ): Promise<ChatStreamResult> => {
    onDelta({ content: 'The lantern room, ' });
    return new Promise((fulfil) => {
      signal.addEventListener('abort', () =>
        // Aborting resolves rather than throws, so the partial text is kept.
        fulfil({ content: 'The lantern room, ', reasoning: '', aborted: true }),
      );
    });
  };
}

const STORY_ID = 'story-1';
const CHAPTER_ID = 'chapter-1';

describe('ChapterStore and the page palette', () => {
  let storage: InMemoryStorage;
  let client: FakeClient;

  /** Seeded before the store is built: it reads its documents at construction. */
  function seed(story: Record<string, unknown> = {}, chapter: Record<string, unknown> = {}): void {
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
      autoTheme: true,
      ...story,
    });
    storage.write(KEYS.chapter(CHAPTER_ID), {
      id: CHAPTER_ID,
      storyId: STORY_ID,
      number: 1,
      title: '',
      scene: 'A monastery under snow. Midwinter, and the bell has not rung since Tuesday.',
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
    client = new FakeClient();
    vi.spyOn(console, 'warn').mockImplementation(() => {
      /* the store warns on purpose in these tests; the run need not */
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: STORAGE_BACKEND, useValue: storage },
        { provide: ModelClient, useValue: client },
      ],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('asks nothing at all when the story has not asked for it', async () => {
    seed({ autoTheme: false });

    expect(await store().choosePalette(CHAPTER_ID)).toBe('');
    expect(client.requests).toHaveLength(0);
    expect(chapter().palette).toBeUndefined();
  });

  it('asks nothing when there is no endpoint to ask', async () => {
    seed();
    storage.write(KEYS.settings, { activeStoryId: STORY_ID });

    expect(await store().choosePalette(CHAPTER_ID)).toBe('');
    expect(client.requests).toHaveLength(0);
  });

  it('asks nothing about a scene that has not been written yet', async () => {
    seed({}, { scene: '   ' });

    expect(await store().choosePalette(CHAPTER_ID)).toBe('');
    expect(client.requests).toHaveLength(0);
  });

  it('files the answer on the chapter, with what it cost', async () => {
    seed();
    client.answer = {
      value: { palette: 'frost' },
      raw: '{"palette":"frost"}',
      usage: { totalTokens: 214 },
    };

    expect(await store().choosePalette(CHAPTER_ID)).toBe('frost');
    expect(chapter().palette).toBe('frost');
    expect(chapter().paletteTokens).toBe(214);
    // The scene went, and the schema with it.
    expect(client.requests[0].messages[1].content).toContain('monastery under snow');
    expect(client.requests[0].schema.name).toBe('page_palette');
  });

  it('estimates the cost when the endpoint does not say', async () => {
    seed();
    client.answer = { value: { palette: 'frost' }, raw: '{"palette":"frost"}' };

    await store().choosePalette(CHAPTER_ID);
    expect(chapter().paletteTokens).toBeGreaterThan(0);
  });

  it('changes nothing when the answer is not a palette', async () => {
    seed();
    client.answer = { value: null, raw: 'I would suggest a soft mauve.' };

    expect(await store().choosePalette(CHAPTER_ID)).toBe('');
    expect(chapter().palette).toBeUndefined();
    expect(chapter().paletteTokens).toBeUndefined();
  });

  it('changes nothing when the request itself fails', async () => {
    seed();
    client.chatJson = () => Promise.reject(new TypeError('Failed to fetch'));

    expect(await store().choosePalette(CHAPTER_ID)).toBe('');
    expect(chapter().palette).toBeUndefined();
  });

  it('does not ask twice about a scene that has not changed', async () => {
    seed({}, { palette: 'frost' });
    const scene = chapter().scene;

    expect(await store().choosePalette(CHAPTER_ID, scene)).toBe('');
    expect(client.requests).toHaveLength(0);

    // A rewritten scene is a new question, even in a chapter that has a page.
    store().update(CHAPTER_ID, { scene: 'A jazz club, two in the morning.' });
    client.answer = { value: { palette: 'nocturne' }, raw: '' };
    expect(await store().choosePalette(CHAPTER_ID, scene)).toBe('nocturne');
    expect(chapter().palette).toBe('nocturne');
  });

  it('marks a reply left half-written when the reader moves to another story', async () => {
    seed();
    // A second story, so there is somewhere to move to.
    const OTHER = 'story-2';
    storage.write(KEYS.story(OTHER), {
      id: OTHER,
      title: 'Another story',
      updatedAt: '2026-01-01T00:00:00.000Z',
      activeChapterId: 'chapter-2',
      chapterCounter: 1,
    });
    storage.write(KEYS.chapter('chapter-2'), {
      id: 'chapter-2',
      storyId: OTHER,
      number: 1,
      title: '',
      scene: 'Somewhere else entirely.',
      status: 'writing',
      summary: '',
      messages: [],
    });

    const chapters = store();
    const sending = chapters.send('I climb the stairs.');
    expect(chapters.isStreaming()).toBe(true);

    TestBed.inject(StoryStore).select(OTHER);
    // The store follows the open story through an effect, as it does in the app.
    TestBed.tick();
    await sending;

    // The chapter is not this store's any more, so the file is what can be read.
    const written = storage.read<{ messages: { content: string; meta?: { aborted?: boolean } }[] }>(
      KEYS.chapter(CHAPTER_ID),
    );
    const last = written!.messages[written!.messages.length - 1];
    expect(last.content).toBe('The lantern room, ');
    expect(last.meta?.aborted).toBe(true);
  });

  it('draws the open chapter on its own page, and the story on its own', () => {
    seed({}, { palette: 'tide' });

    expect(store().palette()?.name).toBe('tide');
    // Given back by hand, the chapter falls through to what Preferences says —
    // which, in a settings file that has never chosen one, is nothing.
    store().setPalette(CHAPTER_ID, '');
    expect(chapter().palette).toBeUndefined();
    expect(store().palette()).toBeNull();
  });
});

describe('ChapterStore and a turn the model would not take', () => {
  let storage: InMemoryStorage;
  let client: FakeClient;

  /** A story with one written turn, so `send` has somewhere to put a reply. */
  function seed(): void {
    storage.write(KEYS.settings, {
      connection: { provider: 'nanogpt', baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' },
      generation: { ...DEFAULT_GENERATION, maxContextTokens: 16384 },
      activeStoryId: STORY_ID,
    });
    storage.write(KEYS.story(STORY_ID), {
      id: STORY_ID,
      title: 'A story',
      updatedAt: '2026-01-01T00:00:00.000Z',
      activeChapterId: CHAPTER_ID,
      chapterCounter: 1,
      autoTheme: false,
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
    });
  }

  /** The endpoint refusing before a word of the reply has been streamed. */
  function refuses(detail: string): void {
    client.streamChat = () =>
      Promise.reject(errorFromResponse(400, JSON.stringify({ error: { message: detail } })));
  }

  const store = () => TestBed.inject(ChapterStore);
  const failed = () => store().written()[store().written().length - 1].meta!;

  beforeEach(() => {
    storage = new InMemoryStorage();
    client = new FakeClient();
    TestBed.configureTestingModule({
      providers: [
        { provide: STORAGE_BACKEND, useValue: storage },
        { provide: ModelClient, useValue: client },
      ],
    });
    seed();
  });

  afterEach(() => vi.restoreAllMocks());

  it('says what the endpoint said about the window, and keeps the numbers', async () => {
    refuses(
      "This model's maximum context length is 8192 tokens, however you requested 19004 tokens",
    );

    await store().send('Go on.');

    expect(failed().error).toContain('this model takes 8192 tokens');
    expect(failed().error).toContain('your context budget is set to 16384');
    expect(failed().contextLimit).toEqual({ window: 8192, requested: 19004, budget: 16384 });
  });

  it('sends nothing more on its own, and changes no setting', async () => {
    const sent: unknown[] = [];
    client.streamChat = (request) => {
      sent.push(request);
      return Promise.reject(
        errorFromResponse(400, JSON.stringify({ error: 'maximum context length is 8192' })),
      );
    };

    await store().send('Go on.');

    // The whole of the decision: one request, because one was asked for, and
    // the budget still says what the reader set it to.
    expect(sent).toHaveLength(1);
    expect(TestBed.inject(SettingsStore).generation().maxContextTokens).toBe(16384);
  });

  it('names the refusal even when the endpoint counted nothing out loud', async () => {
    refuses('Too many tokens in prompt.');

    await store().send('Go on.');

    expect(failed().error).toContain('Too long for this model');
    // No window named, so nothing for the bubble to offer: it will not invent one.
    expect(failed().contextLimit).toEqual({
      window: undefined,
      requested: undefined,
      budget: 16384,
    });
  });

  it('leaves every other refusal exactly as it was', async () => {
    refuses('unknown model: m');

    await store().send('Go on.');

    expect(failed().error).toContain('The endpoint rejected the request');
    expect(failed().error).toContain('unknown model');
    expect(failed().contextLimit).toBeUndefined();
  });
});

describe('ChapterStore and asking again after a failure', () => {
  let storage: InMemoryStorage;
  let client: FakeClient;
  /** Every request the endpoint was asked to answer, in order. */
  let asked: { role: string; content: string }[][];

  function seed(messages: unknown[] = []): void {
    storage.write(KEYS.settings, {
      connection: { provider: 'nanogpt', baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' },
      generation: { ...DEFAULT_GENERATION },
      activeStoryId: STORY_ID,
    });
    storage.write(KEYS.story(STORY_ID), {
      id: STORY_ID,
      title: 'A story',
      updatedAt: '2026-01-01T00:00:00.000Z',
      activeChapterId: CHAPTER_ID,
      chapterCounter: 1,
      autoTheme: false,
    });
    storage.write(KEYS.chapter(CHAPTER_ID), {
      id: CHAPTER_ID,
      storyId: STORY_ID,
      number: 1,
      title: '',
      scene: 'A monastery under snow.',
      status: 'writing',
      summary: '',
      messages,
    });
  }

  /** A user turn, and the failed answer to it that the bubble offers to retry. */
  const ASKED = { id: 'm-user', role: 'user', content: 'The bell rings.', createdAt: '' };
  const FAILED = {
    id: 'm-failed',
    role: 'assistant',
    content: '',
    createdAt: '',
    meta: { model: 'm', error: 'The endpoint refused: 502.' },
  };

  const store = () => TestBed.inject(ChapterStore);
  const written = () => store().written();

  beforeEach(() => {
    storage = new InMemoryStorage();
    client = new FakeClient();
    asked = [];
    client.streamChat = (request, onDelta) => {
      asked.push((request as { messages: { role: string; content: string }[] }).messages);
      onDelta({ content: 'The bell answers.' });
      return Promise.resolve({
        content: 'The bell answers.',
        reasoning: '',
        aborted: false,
        finishReason: 'stop',
      });
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: STORAGE_BACKEND, useValue: storage },
        { provide: ModelClient, useValue: client },
      ],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('drops the failed answer and asks for another one', async () => {
    seed([ASKED, FAILED]);
    await store().retryLast();

    expect(asked).toHaveLength(1);
    // The bubble that failed is gone, replaced rather than added to.
    expect(written()).toHaveLength(2);
    expect(written()[1].content).toBe('The bell answers.');
    expect(written()[1].meta?.error).toBeUndefined();
    // And the turn it was answering is still the turn it was answering.
    expect(asked[0][asked[0].length - 1].content).toContain('The bell rings.');
  });

  it('sends the last turn again when there is no answer to drop', async () => {
    seed([ASKED]);
    await store().retryLast();

    expect(asked).toHaveLength(1);
    expect(written().map((m) => m.id)).toContain('m-user');
    expect(written()[1].content).toBe('The bell answers.');
  });

  it('asks again from the last thing written, whatever failed before it', async () => {
    seed([ASKED, FAILED, { id: 'm-late', role: 'user', content: 'Anyone there?', createdAt: '' }]);
    await store().retryLast();

    // `m-late` is the last thing written, so it is what is sent again — and
    // the failed bubble in front of it is not part of what gets sent.
    expect(written().map((m) => m.id)).toEqual(['m-user', 'm-failed', 'm-late', written()[3].id]);
    expect(written()[3].content).toBe('The bell answers.');
  });

  it('looks past a record of the cast changing to the last thing written', async () => {
    seed([
      ASKED,
      FAILED,
      { id: 'm-cast', kind: 'cast', role: 'system', content: '', createdAt: '', cast: {} },
    ]);
    await store().retryLast();

    // The record is not a turn, so it is the failed answer that is asked again.
    expect(written().map((m) => m.id)).toEqual(['m-user', written()[1].id]);
    expect(written()[1].content).toBe('The bell answers.');
  });

  it('asks nothing of a chapter with nothing in it', async () => {
    seed([]);
    await store().retryLast();

    expect(asked).toEqual([]);
    expect(written()).toEqual([]);
  });

  it('asks nothing while a turn is already arriving', async () => {
    seed([ASKED, FAILED]);
    let arrive: (() => void) | undefined;
    client.streamChat = (request, onDelta) => {
      asked.push((request as { messages: { role: string; content: string }[] }).messages);
      onDelta({ content: 'Still writing' });
      return new Promise((fulfil) => {
        arrive = () => fulfil({ content: 'Still writing.', reasoning: '', aborted: false });
      });
    };

    const first = store().retryLast();
    await store().retryLast();
    expect(asked).toHaveLength(1);

    arrive!();
    await first;
  });

  it('asks nothing when there is nowhere to send it', async () => {
    seed([ASKED, FAILED]);
    TestBed.inject(SettingsStore).patchConnection({ model: '' });
    await store().retryLast();

    expect(asked).toEqual([]);
    expect(written()[1].meta?.error).toBe('The endpoint refused: 502.');
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
      providers: [
        { provide: STORAGE_BACKEND, useValue: storage },
        { provide: ModelClient, useValue: new FakeClient() },
      ],
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
      providers: [
        { provide: STORAGE_BACKEND, useValue: storage },
        { provide: ModelClient, useValue: new FakeClient() },
      ],
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
