import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Composer } from './composer';
import { ChapterMessage } from '../../core/models';
import { ChatStreamResult, ModelClient } from '../../core/model-client';
import { ChapterStore } from '../../store/chapter-store';
import { KEYS } from '../../store/documents';
import { STORAGE_BACKEND } from '../../store/storage';
import { InMemoryStorage } from '../../store/testing/in-memory-storage';
import { ProseEditor } from '../../shared/prose-editor';
import { NOTHING_MATCHES, stubMatchMedia } from '../../core/testing/media-queries';

/** An endpoint that answers at once, so a send finishes inside the test. */
const CLIENT = {
  chatJson: () => Promise.resolve({ value: null, raw: '' }),
  streamChat: (): Promise<ChatStreamResult> =>
    Promise.resolve({ content: 'The stairs turn twice.', reasoning: '', aborted: false }),
};

const STORY_ID = 'story-1';
const CHAPTER_ID = 'chapter-1';

/**
 * One message in two voices. The persona's words and the author's directions
 * are kept apart all the way to the request, and `[AUTHOR]` is the shorthand
 * for the button that does it — a shorthand that has to split as it is typed
 * and show the split, because a writer who cannot see which half a sentence
 * landed in has no way of finding out until the model answers.
 *
 * The other half of this is the composer listening to the whole document: a
 * letter pressed with nothing focused goes into the box, and Space does not,
 * because Space pages the story down and a reader presses it far more often
 * than a writer opens a line with one.
 */
describe('Composer', () => {
  let storage: InMemoryStorage;
  let fixture: ReturnType<typeof TestBed.createComponent<Composer>>;

  const host = () => fixture.nativeElement as HTMLElement;
  const chapters = () => TestBed.inject(ChapterStore);
  const sent = (): ChapterMessage[] => chapters().written();

  function seed(): void {
    storage.write(KEYS.settings, {
      connection: { provider: 'nanogpt', baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' },
      activeStoryId: STORY_ID,
    });
    storage.write(KEYS.story(STORY_ID), {
      id: STORY_ID,
      title: 'The Lamplighter',
      updatedAt: '2026-01-01T00:00:00.000Z',
      activeChapterId: CHAPTER_ID,
      chapterCounter: 1,
    });
    storage.write(KEYS.chapter(CHAPTER_ID), {
      id: CHAPTER_ID,
      storyId: STORY_ID,
      number: 1,
      title: '',
      scene: 'A lighthouse in a gale.',
      status: 'writing',
      summary: '',
      messages: [],
    });
  }

  async function open(): Promise<void> {
    fixture = TestBed.createComponent(Composer);
    fixture.detectChanges();
    // The editor mounts after the first render; nothing can be typed before it.
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Types into the prose box the way a keystroke does, through the editor. */
  function type(text: string): void {
    const editor = fixture.debugElement.query(By.directive(ProseEditor))
      .componentInstance as ProseEditor;
    editor.insertText(text);
    fixture.detectChanges();
  }

  const prose = () => host().querySelector('li-prose-editor .ProseMirror')?.textContent ?? '';

  function directionBox(): HTMLTextAreaElement | null {
    return host().querySelector<HTMLTextAreaElement>('.direction textarea');
  }

  function typeDirection(text: string): void {
    const box = directionBox()!;
    box.value = text;
    box.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function pressInDirection(key: string, modifiers: KeyboardEventInit = {}): void {
    directionBox()!.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }),
    );
    fixture.detectChanges();
  }

  /** A key pressed at the page, with whatever happens to be focused. */
  function pressAnywhere(key: string, modifiers: KeyboardEventInit = {}): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
    fixture.detectChanges();
  }

  /**
   * jsdom has no layout, so a Range has neither of the two methods ProseMirror
   * asks the caret's position with. It only asks once the box has been focused
   * — which the `[AUTHOR]` split does, on its way to the author's field — and
   * nothing here depends on the answer.
   */
  beforeAll(() => {
    // Filled in only where they really are missing, and named as the two the
    // DOM says are always there: `Partial<Pick<Range, ...>>` is what jsdom's
    // Range actually is, and a real one satisfies it too, so nothing is cast.
    const range: Partial<Pick<Range, 'getClientRects' | 'getBoundingClientRect'>> = Range.prototype;
    const rects: DOMRect[] = [];
    range.getClientRects ??= () => Object.assign(rects, { item: () => null });
    range.getBoundingClientRect ??= () => new DOMRect();

    // And no media-query engine either, which `Layout` asks the width and the
    // pointer with.
    stubMatchMedia(NOTHING_MATCHES);
  });

  beforeEach(() => {
    storage = new InMemoryStorage();
    TestBed.configureTestingModule({
      providers: [
        { provide: STORAGE_BACKEND, useValue: storage },
        { provide: ModelClient, useValue: CLIENT },
      ],
    });
    seed();
    document.body.focus();
  });

  describe('the author tag', () => {
    it('takes the tag and what follows it out of the prose', async () => {
      await open();
      type('[AUTHOR] Keep him from mentioning the lamp.');

      expect(prose()).toBe('');
      expect(directionBox()?.value).toBe('Keep him from mentioning the lamp.');
    });

    it('leaves the prose in front of the tag where it was', async () => {
      await open();
      type('He climbs the stairs.\n[AUTHOR] Keep him quiet.');

      expect(prose()).toBe('He climbs the stairs.');
      expect(directionBox()?.value).toBe('Keep him quiet.');
    });

    it('adds a second direction to the first rather than over it', async () => {
      await open();
      type('[AUTHOR] Keep him quiet.');
      type('[AUTHOR] And do not mention the lamp.');

      expect(directionBox()?.value).toBe('Keep him quiet.\nAnd do not mention the lamp.');
      expect(prose()).toBe('');
    });

    it('opens the author field with nothing in it when the tag stands alone', async () => {
      await open();
      type('[author]');

      expect(directionBox()).not.toBeNull();
      expect(directionBox()?.value).toBe('');
    });

    it('sends the two halves as two halves', async () => {
      await open();
      type('He climbs the stairs.\n[AUTHOR] Keep him quiet.');

      pressInDirection('Enter');
      await fixture.whenStable();

      expect(sent()[0].content).toBe('He climbs the stairs.');
      expect(sent()[0].direction).toBe('Keep him quiet.');
    });

    it('empties both halves and closes the field once it has gone', async () => {
      await open();
      type('He climbs the stairs.\n[AUTHOR] Keep him quiet.');

      pressInDirection('Enter');
      await fixture.whenStable();
      fixture.detectChanges();

      expect(prose()).toBe('');
      expect(directionBox()).toBeNull();
    });
  });

  describe('the keys the author field answers', () => {
    it('sends on Enter, from the direction as well as from the prose', async () => {
      await open();
      type('[AUTHOR] Keep him quiet.');
      typeDirection('Keep him quiet.');

      pressInDirection('Enter');
      await fixture.whenStable();

      expect(sent()).toHaveLength(2);
      expect(sent()[0].direction).toBe('Keep him quiet.');
    });

    it('leaves Ctrl+Enter alone, because that is the page asking again', async () => {
      await open();
      type('[AUTHOR] Keep him quiet.');

      pressInDirection('Enter', { ctrlKey: true });
      await fixture.whenStable();

      expect(sent()).toEqual([]);
      expect(directionBox()?.value).toBe('Keep him quiet.');
    });

    it('makes a new line on Shift+Enter rather than sending', async () => {
      await open();
      type('[AUTHOR] Keep him quiet.');

      pressInDirection('Enter', { shiftKey: true });
      await fixture.whenStable();

      expect(sent()).toEqual([]);
    });
  });

  describe('a key pressed with nothing focused', () => {
    it('goes into the box, so the writer need not go and find it', async () => {
      await open();
      pressAnywhere('h');

      expect(prose()).toBe('h');
    });

    it('leaves Space alone: it is how a reader pages the story down', async () => {
      await open();
      pressAnywhere(' ');

      expect(prose()).toBe('');
    });

    it('leaves a shortcut alone, whichever modifier it was pressed with', async () => {
      await open();
      pressAnywhere('k', { ctrlKey: true });
      pressAnywhere('k', { metaKey: true });
      pressAnywhere('k', { altKey: true });

      expect(prose()).toBe('');
    });

    it('leaves a key alone that something on the page is already taking', async () => {
      await open();
      type('[AUTHOR] Keep him quiet.');
      directionBox()!.focus();

      pressAnywhere('h');

      expect(prose()).toBe('');
    });
  });
});
