import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { CastChange, Chapter, ChapterMessage, LoreEntry, Story, TokenUsage } from '../core/models';
import { LORE_SCHEMA, LoreProposal, buildLorePrompt, readProposals } from '../core/lore-extraction';
import { ModelClient } from '../core/model-client';
import {
  PagePalette,
  buildPalettePrompt,
  pagePalette,
  paletteSchema,
  readPaletteName,
} from '../core/page-palettes';
import {
  ModelError,
  contextLimitOf,
  describeContextLimit,
  errorFromThrown,
} from '../core/model-errors';
import {
  BuiltPrompt,
  activeCharacter,
  buildPrompt,
  buildSummaryPrompt,
  chapterName,
  isOneAtATime,
  writtenIn,
} from '../core/prompt-builder';
import { TOKEN_ESTIMATOR } from '../core/tokens';
import { SettingsStore } from './settings-store';
import { NewStory, StoryStore } from './story-store';
import { STORAGE_BACKEND } from './storage';
import { KEYS, newChapter, newId, now, readChapters } from './documents';

/** Why the composer is closed, and the one button that opens it again. */
export interface WriteBlock {
  reason: string;
  action: 'scene' | 'connection' | 'continue' | null;
}

/**
 * The chapters of the open story, and the streaming turn.
 *
 * Every request is rebuilt by the prompt builder from the story, the chapter
 * and the message list — nothing about a turn is remembered between requests,
 * so edit / regenerate / replay all go through the same path as a fresh send.
 */
@Injectable({ providedIn: 'root' })
export class ChapterStore {
  private readonly storage = inject(STORAGE_BACKEND);
  private readonly settings = inject(SettingsStore);
  private readonly stories = inject(StoryStore);
  private readonly client = inject(ModelClient);
  private readonly estimator = inject(TOKEN_ESTIMATOR);

  private readonly state = signal<Chapter[]>([]);
  private readonly streamingIdState = signal<string | null>(null);
  private readonly saved = new Map<string, Chapter>();
  private loadedStoryId = '';
  /** The chapter a running turn belongs to, in case the reader moves away. */
  private streamingChapterId = '';
  private controller: AbortController | null = null;

  /** Deltas land here and are flushed to the signal once per frame. */
  private pendingContent = '';
  private pendingReasoning = '';
  private frame: number | null = null;

  readonly chapters = this.state.asReadonly();
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

  /** Everything the next request will carry, for the pill and the preview. */
  preview(draft = '', draftDirection = ''): BuiltPrompt {
    return buildPrompt({
      story: this.stories.story(),
      chapter: this.chapter(),
      draft,
      draftDirection,
      params: this.settings.generation(),
      estimator: this.estimator,
    });
  }

  /**
   * A turn from the writer: what their persona did, what the author wants, or
   * both. Either half on its own is a message worth sending.
   */
  async send(text: string, direction = ''): Promise<void> {
    const content = text.trim();
    const said = direction.trim();
    if ((!content && !said) || this.isStreaming() || !this.canWrite()) return;
    this.appendMessage({
      id: newId(),
      role: 'user',
      content,
      direction: said || undefined,
      createdAt: now(),
    });
    await this.runTurn();
  }

  stop(): void {
    this.controller?.abort();
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
    if (this.streamingIdState() === id) this.stop();
    this.patchChapter(this.chapter().id, (chapter) => ({
      messages: chapter.messages.filter((m) => m.id !== id),
    }));
  }

  /** Drops this assistant answer (and anything after it) and asks again. */
  async regenerate(id: string): Promise<void> {
    if (this.isStreaming() || !this.canWrite()) return;
    const index = this.indexOf(id);
    if (index < 0) return;
    this.truncateTo(index);
    await this.runTurn();
  }

  /** Keeps this user message, drops every later message, sends it again. */
  async replayFrom(id: string): Promise<void> {
    if (this.isStreaming() || !this.canWrite()) return;
    const index = this.indexOf(id);
    if (index < 0) return;
    this.truncateTo(index + 1);
    await this.runTurn();
  }

  /** Retry for the inline error bubble, and for Ctrl+Enter. */
  async retryLast(): Promise<void> {
    const messages = this.written();
    const last = messages[messages.length - 1];
    if (!last) return;
    await (last.role === 'assistant' ? this.regenerate(last.id) : this.replayFrom(last.id));
  }

  clearMessages(): void {
    this.stop();
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
   * A change to the cast, filed where in the chapter it happened.
   *
   * The record carries the cast as it now stands *and* as it stood, so it says
   * what changed without being read next to its neighbours — a message
   * deleted or replayed between two of them must not change what either means.
   */
  private recordCast(was: CastChange['was']): void {
    const chapter = this.chapter();
    // Before the first word there is nothing for a record to sit between: the
    // mode block already opens by saying who is on stage.
    if (!chapter.messages.length) return;

    this.patchChapter(chapter.id, (current) => {
      const messages = [...current.messages];
      const last = messages[messages.length - 1];
      // Two changes with nothing written between them are one change, and it
      // is the older record that knows what the cast was before both.
      const from = last?.kind === 'cast' ? (last.cast?.was ?? was) : was;
      if (last?.kind === 'cast') messages.pop();

      const cast = castState(this.stories.story());
      // Clicked away and back again: there is no change left to tell anyone.
      if (sameCast(from, cast)) return { messages };

      messages.push({
        id: newId(),
        kind: 'cast',
        role: 'system',
        content: '',
        createdAt: now(),
        cast: { ...cast, was: from },
      });
      return { messages };
    });
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

  /**
   * Which page this chapter's scene wants, asked of the model.
   *
   * One short request, made when the scene sheet is confirmed and only when the
   * story asked for it. Nothing waits for it: the answer lands a moment later
   * and the page changes under the chapter that is already open.
   *
   * A scene that has not changed is not asked about twice — re-opening the
   * sheet to fix a typo in the title is not a new chapter — and a failure of
   * any kind changes nothing and is one line in the console. There is no
   * message to put an error in, and a page that stayed as it was is not a fault
   * worth a dialog.
   */
  async choosePalette(id: string, previousScene?: string): Promise<string> {
    const story = this.stories.story();
    const chapter = this.state().find((c) => c.id === id);
    const scene = chapter?.scene.trim() ?? '';
    if (!story.autoTheme || !chapter || !scene) return '';
    if (chapter.palette && scene === previousScene?.trim()) return '';
    if (!this.settings.isConnected()) return '';

    const connection = this.settings.connection();
    const messages = buildPalettePrompt(scene);
    try {
      const answer = await this.client.chatJson<unknown>({
        provider: connection.provider,
        baseUrl: connection.baseUrl,
        apiKey: connection.apiKey,
        model: connection.model,
        messages,
        params: this.settings.generation(),
        schema: paletteSchema(),
      });
      const name = readPaletteName(answer.value, answer.raw);
      if (!name) {
        console.warn('The page palette answer named no palette:', answer.raw.slice(0, 200));
        return '';
      }
      this.patchChapter(id, () => ({
        palette: name,
        // What it cost, for the scene sheet's footer. Estimated when the
        // endpoint says nothing, which is the same fallback a turn makes.
        paletteTokens:
          answer.usage?.totalTokens ??
          this.estimator.countMessages(messages) + this.estimator.count(answer.raw),
      }));
      return name;
    } catch (e) {
      console.warn('The page palette could not be chosen:', errorFromThrown(e).message);
      return '';
    }
  }

  /** Streams the close-chapter summary; the review modal owns the result. */
  async summarise(
    onDelta: (text: string) => void,
    signal: AbortSignal,
  ): Promise<{ text: string; usage?: TokenUsage; error?: string }> {
    const connection = this.settings.connection();
    if (!this.settings.isConnected()) {
      return { text: '', error: this.settings.connectionHint() };
    }
    try {
      const result = await this.client.streamChat(
        {
          provider: connection.provider,
          baseUrl: connection.baseUrl,
          apiKey: connection.apiKey,
          model: connection.model,
          messages: buildSummaryPrompt(this.stories.story(), this.chapter()),
          params: this.settings.generation(),
        },
        (delta) => {
          if (delta.content) onDelta(delta.content);
        },
        signal,
      );
      return { text: result.content, usage: result.usage, error: result.interrupted?.message };
    } catch (e) {
      return { text: '', error: errorFromThrown(e).message };
    }
  }

  /**
   * Asks what this chapter established, as entries rather than as prose.
   *
   * A second request and a second bill, so it is made only when the story asked
   * for it or the writer pressed the button. Nothing it returns is written
   * anywhere: the review sheet ticks them, and the close applies the ticks.
   */
  async proposeLore(
    signal: AbortSignal,
  ): Promise<{ proposals: LoreProposal[]; usage?: TokenUsage; error?: string }> {
    const connection = this.settings.connection();
    if (!this.settings.isConnected()) {
      return { proposals: [], error: this.settings.connectionHint() };
    }
    const story = this.stories.story();
    try {
      const answer = await this.client.chatJson<unknown>(
        {
          provider: connection.provider,
          baseUrl: connection.baseUrl,
          apiKey: connection.apiKey,
          model: connection.model,
          messages: buildLorePrompt(story, this.chapter()),
          params: this.settings.generation(),
          schema: { name: LORE_SCHEMA.name, schema: LORE_SCHEMA.schema },
        },
        signal,
      );
      if (!answer.value) {
        // It answered, and not with anything that could be read as entries.
        return { proposals: [], usage: answer.usage, error: 'The answer was not JSON.' };
      }
      return { proposals: readProposals(answer.value, story.world.entries), usage: answer.usage };
    } catch (e) {
      return { proposals: [], error: errorFromThrown(e).message };
    }
  }

  // -- the streaming turn ----------------------------------------------------

  private async runTurn(): Promise<void> {
    const connection = this.settings.connection();
    if (!this.settings.isConnected()) return;
    const chapterId = this.chapter().id;

    const playing = this.playing();
    const placeholder: ChapterMessage = {
      id: newId(),
      role: 'assistant',
      content: '',
      createdAt: now(),
      // Who is answering, when somebody in particular is. An ensemble reply is
      // the room talking and belongs to nobody.
      speakerId: playing?.id,
      // And what they were called at the time, so a rename later does not go
      // back and change who said what.
      speakerName: playing?.name.trim() || undefined,
      meta: { model: connection.model },
    };
    this.appendMessage(placeholder);
    this.streamingChapterId = chapterId;
    this.streamingIdState.set(placeholder.id);

    const { messages } = buildPrompt({
      story: this.stories.story(),
      chapter: this.chapter(),
      messages: this.messages().filter((m) => m.id !== placeholder.id),
      params: this.settings.generation(),
      estimator: this.estimator,
    });
    this.controller = new AbortController();

    try {
      const result = await this.client.streamChat(
        {
          provider: connection.provider,
          baseUrl: connection.baseUrl,
          apiKey: connection.apiKey,
          model: connection.model,
          messages,
          params: this.settings.generation(),
        },
        (delta) => {
          if (delta.content) this.pendingContent += delta.content;
          if (delta.reasoning) this.pendingReasoning += delta.reasoning;
          this.queueFlush();
        },
        this.controller.signal,
      );
      this.flush();
      this.patchMessage(chapterId, placeholder.id, {
        content: result.content,
        reasoning: result.reasoning || undefined,
        meta: {
          model: connection.model,
          promptTokens: result.usage?.promptTokens ?? this.estimator.countMessages(messages),
          completionTokens: result.usage?.completionTokens ?? this.estimator.count(result.content),
          finishReason: result.finishReason,
          aborted: result.aborted || undefined,
          interrupted: result.interrupted?.message,
        },
      });
    } catch (e) {
      this.flush();
      const error: ModelError = errorFromThrown(e);
      // A refusal for length is the one failure the endpoint has told us how
      // to fix, so it is said in those terms and the numbers are kept for the
      // button that offers the change. Sending again is still a press.
      const limit = contextLimitOf(error);
      const budget = this.settings.generation().maxContextTokens;
      this.patchMessage(chapterId, placeholder.id, {
        meta: {
          model: connection.model,
          error: limit ? describeContextLimit(limit, budget, error.detail ?? '') : error.message,
          contextLimit: limit ? { ...limit, budget } : undefined,
        },
      });
    } finally {
      this.cancelFlush();
      this.controller = null;
      this.streamingIdState.set(null);
      this.streamingChapterId = '';
      this.patchChapter(chapterId, () => ({}));
    }
  }

  private queueFlush(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.flush();
    });
  }

  private flush(): void {
    const id = this.streamingIdState();
    if (!id || (!this.pendingContent && !this.pendingReasoning)) return;
    const content = this.pendingContent;
    const reasoning = this.pendingReasoning;
    this.pendingContent = '';
    this.pendingReasoning = '';
    this.patchChapter(this.streamingChapterId, (chapter) => ({
      messages: chapter.messages.map((m) =>
        m.id === id
          ? {
              ...m,
              content: m.content + content,
              reasoning: reasoning ? (m.reasoning ?? '') + reasoning : m.reasoning,
            }
          : m,
      ),
    }));
  }

  private cancelFlush(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.pendingContent = '';
    this.pendingReasoning = '';
  }

  private appendMessage(message: ChapterMessage): void {
    this.patchChapter(this.chapter().id, (chapter) => ({
      messages: [...chapter.messages, message],
    }));
  }

  private patchMessage(chapterId: string, id: string, patch: Partial<ChapterMessage>): void {
    this.patchChapter(chapterId, (chapter) => ({
      messages: chapter.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
  }

  private truncateTo(length: number): void {
    this.patchChapter(this.chapter().id, (chapter) => ({
      messages: chapter.messages.slice(0, length),
    }));
  }

  private patchChapter(id: string, patch: (chapter: Chapter) => Partial<Chapter>): void {
    this.state.update((chapters) =>
      chapters.map((c) => (c.id === id ? { ...c, ...patch(c), updatedAt: now() } : c)),
    );
  }

  private indexOf(id: string): number {
    return this.messages().findIndex((m) => m.id === id);
  }

  /**
   * A turn still arriving when the reader leaves for another story.
   *
   * Aborting resolves rather than throws, so `runTurn` carries on — but by
   * then this store holds another story's chapters, and everything it does
   * next is aimed at a chapter that is no longer here: the last deltas, and
   * the mark that says the reply stopped early. Both are done here instead,
   * while the chapter is still in hand, and the chapter is written straight to
   * storage because the effect that writes chapters will only ever see the
   * story that replaced it.
   */
  private stopAndKeep(): void {
    const id = this.streamingIdState();
    const chapterId = this.streamingChapterId;
    this.stop();
    if (!id) return;

    this.flush();
    this.patchChapter(chapterId, (chapter) => ({
      messages: chapter.messages.map((message) =>
        message.id === id ? { ...message, meta: { ...message.meta, aborted: true } } : message,
      ),
    }));
    const chapter = this.state().find((c) => c.id === chapterId);
    if (!chapter) return;
    this.saved.set(chapter.id, chapter);
    this.storage.write(KEYS.chapter(chapter.id), chapter);
  }

  /** Switching stories swaps the whole set; every story keeps one chapter. */
  private loadFor(storyId: string): void {
    this.loadedStoryId = storyId;
    this.stopAndKeep();
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

/** Who is on stage, as a record of a change stores it. */
function castState(story: Story): { activeCharacterId: string; enabled: string[] } {
  return {
    activeCharacterId: activeCharacter(story)?.id ?? '',
    enabled: story.characters.filter((c) => c.enabled).map((c) => c.id),
  };
}

function sameCast(
  a: { activeCharacterId: string; enabled: string[] } | undefined,
  b: { activeCharacterId: string; enabled: string[] },
): boolean {
  return (
    !!a &&
    a.activeCharacterId === b.activeCharacterId &&
    a.enabled.length === b.enabled.length &&
    a.enabled.every((id, i) => id === b.enabled[i])
  );
}
