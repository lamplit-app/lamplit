import { Injectable, inject } from '@angular/core';
import { ChapterMessage, TokenUsage } from '../core/models';
import { LORE_SCHEMA, LoreProposal, buildLorePrompt, readProposals } from '../core/lore-extraction';
import { ChatEndpoint, ModelClient } from '../core/model-client';
import { buildPalettePrompt, paletteSchema, readPaletteName } from '../core/page-palettes';
import {
  ModelError,
  contextLimitOf,
  describeContextLimit,
  errorFromThrown,
} from '../core/model-errors';
import { BuiltPrompt, buildPrompt, buildSummaryPrompt } from '../core/prompt-builder';
import { TOKEN_ESTIMATOR } from '../core/tokens';
import { ChapterStore } from './chapter-store';
import { SettingsStore } from './settings-store';
import { StoryStore } from './story-store';
import { newId, now } from './documents';

/**
 * Everything the app asks a model, and what it does with the answers.
 *
 * Four requests, and they are four because they are billed four times: the
 * streaming turn, the page a scene wants, the summary that closes a chapter,
 * and the entries that chapter established. Every one of them is rebuilt from
 * the story, the chapter and the message list at the moment it is made —
 * nothing about a turn is remembered between requests, so edit, regenerate and
 * replay all go down the same path as a fresh send.
 *
 * Built on `ChapterStore` and writing through the five methods it offers a
 * turn. It was all one file until the store held the documents, the write
 * policy, the cast, four endpoints and a `requestAnimationFrame` buffer at
 * once — a data store that knew about paint frames, and seven hundred lines in
 * which the four `{provider, baseUrl, apiKey, model}` objects were spelled out
 * by hand four times.
 */
@Injectable({ providedIn: 'root' })
export class ChapterRequests {
  private readonly chapters = inject(ChapterStore);
  private readonly stories = inject(StoryStore);
  private readonly settings = inject(SettingsStore);
  private readonly client = inject(ModelClient);
  private readonly estimator = inject(TOKEN_ESTIMATOR);

  /** The chapter a running turn belongs to, in case the reader moves away. */
  private streamingChapterId = '';
  private controller: AbortController | null = null;

  /** Deltas land here and are flushed to the store once per frame. */
  private pendingContent = '';
  private pendingReasoning = '';
  private frame: number | null = null;

  constructor() {
    this.chapters.whenTurnsMustEnd(() => this.endAndKeep());
  }

  /** Everything the next request will carry, for the pill and the preview. */
  preview(draft = '', draftDirection = ''): BuiltPrompt {
    return buildPrompt({
      story: this.stories.story(),
      chapter: this.chapters.chapter(),
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
    if ((!content && !said) || this.busy()) return;
    this.chapters.appendMessage({
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

  /** Drops this assistant answer (and anything after it) and asks again. */
  async regenerate(id: string): Promise<void> {
    if (this.busy()) return;
    const index = this.indexOf(id);
    if (index < 0) return;
    this.chapters.truncateTo(index);
    await this.runTurn();
  }

  /** Keeps this user message, drops every later message, sends it again. */
  async replayFrom(id: string): Promise<void> {
    if (this.busy()) return;
    const index = this.indexOf(id);
    if (index < 0) return;
    this.chapters.truncateTo(index + 1);
    await this.runTurn();
  }

  /** Retry for the inline error bubble, and for Ctrl+Enter. */
  async retryLast(): Promise<void> {
    const messages = this.chapters.written();
    const last = messages[messages.length - 1];
    if (!last) return;
    await (last.role === 'assistant' ? this.regenerate(last.id) : this.replayFrom(last.id));
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
    const chapter = this.chapters.chapters().find((c) => c.id === id);
    const scene = chapter?.scene.trim() ?? '';
    if (!story.autoTheme || !chapter || !scene) return '';
    if (chapter.palette && scene === previousScene?.trim()) return '';
    if (!this.settings.isConnected()) return '';

    const messages = buildPalettePrompt(scene);
    try {
      const answer = await this.client.chatJson<unknown>({
        ...this.endpoint(),
        messages,
        params: this.settings.generation(),
        schema: paletteSchema(),
      });
      const name = readPaletteName(answer.value, answer.raw);
      if (!name) {
        console.warn('The page palette answer named no palette:', answer.raw.slice(0, 200));
        return '';
      }
      this.chapters.update(id, {
        palette: name,
        // What it cost, for the scene sheet's footer. Estimated when the
        // endpoint says nothing, which is the same fallback a turn makes.
        paletteTokens:
          answer.usage?.totalTokens ??
          this.estimator.countMessages(messages) + this.estimator.count(answer.raw),
      });
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
    if (!this.settings.isConnected()) {
      return { text: '', error: this.settings.connectionHint() };
    }
    try {
      const result = await this.client.streamChat(
        {
          ...this.endpoint(),
          messages: buildSummaryPrompt(this.stories.story(), this.chapters.chapter()),
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
    if (!this.settings.isConnected()) {
      return { proposals: [], error: this.settings.connectionHint() };
    }
    const story = this.stories.story();
    try {
      const answer = await this.client.chatJson<unknown>(
        {
          ...this.endpoint(),
          messages: buildLorePrompt(story, this.chapters.chapter()),
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
    const endpoint = this.endpoint();
    if (!this.settings.isConnected()) return;
    const chapterId = this.chapters.chapter().id;

    const playing = this.chapters.playing();
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
      meta: { model: endpoint.model },
    };
    this.chapters.appendMessage(placeholder);
    this.streamingChapterId = chapterId;
    this.chapters.markStreaming(placeholder.id);

    const { messages } = buildPrompt({
      story: this.stories.story(),
      chapter: this.chapters.chapter(),
      messages: this.chapters.messages().filter((m) => m.id !== placeholder.id),
      params: this.settings.generation(),
      estimator: this.estimator,
    });
    this.controller = new AbortController();

    try {
      const result = await this.client.streamChat(
        { ...endpoint, messages, params: this.settings.generation() },
        (delta) => {
          if (delta.content) this.pendingContent += delta.content;
          if (delta.reasoning) this.pendingReasoning += delta.reasoning;
          this.queueFlush();
        },
        this.controller.signal,
      );
      this.flush();
      this.chapters.patchMessage(chapterId, placeholder.id, () => ({
        content: result.content,
        reasoning: result.reasoning || undefined,
        meta: {
          model: endpoint.model,
          promptTokens: result.usage?.promptTokens ?? this.estimator.countMessages(messages),
          completionTokens: result.usage?.completionTokens ?? this.estimator.count(result.content),
          finishReason: result.finishReason,
          aborted: result.aborted || undefined,
          interrupted: result.interrupted?.message,
        },
      }));
    } catch (e) {
      this.flush();
      const error: ModelError = errorFromThrown(e);
      // A refusal for length is the one failure the endpoint has told us how
      // to fix, so it is said in those terms and the numbers are kept for the
      // button that offers the change. Sending again is still a press.
      const limit = contextLimitOf(error);
      const budget = this.settings.generation().maxContextTokens;
      this.chapters.patchMessage(chapterId, placeholder.id, () => ({
        meta: {
          model: endpoint.model,
          error: limit ? describeContextLimit(limit, budget, error.detail ?? '') : error.message,
          contextLimit: limit ? { ...limit, budget } : undefined,
        },
      }));
    } finally {
      this.cancelFlush();
      this.controller = null;
      this.chapters.markStreaming(null);
      this.streamingChapterId = '';
      this.chapters.keepChapter(chapterId);
    }
  }

  /**
   * A turn still arriving when what it is writing into goes away — the reader
   * left for another story, deleted the message, cleared the chapter.
   *
   * Aborting resolves rather than throws, so `runTurn` carries on — but by
   * then the store holds another story's chapters, and everything it does next
   * is aimed at a chapter that is no longer there: the last deltas, and the
   * mark that says the reply stopped early. Both are done here instead, while
   * the chapter is still in hand, and `keepChapter` writes it straight to
   * storage because the effect that saves chapters will only ever see the
   * story that replaced it.
   *
   * `ChapterStore` calls this through the hook it registered above; it is the
   * store that can see the moment, and this service that can end the request.
   */
  private endAndKeep(): void {
    const id = this.chapters.streamingId();
    const chapterId = this.streamingChapterId;
    this.stop();
    if (!id) return;

    this.flush();
    this.chapters.patchMessage(chapterId, id, (message) => ({
      meta: { ...message.meta, aborted: true },
    }));
    this.chapters.keepChapter(chapterId);
  }

  /** Nothing sends over a reply still arriving, or into a closed chapter. */
  private busy(): boolean {
    return this.chapters.isStreaming() || !this.chapters.canWrite();
  }

  private indexOf(id: string): number {
    return this.chapters.messages().findIndex((m) => m.id === id);
  }

  /**
   * Where this request goes and how it is signed.
   *
   * A connection *is* an endpoint, plus the model list fetched off it, so this
   * is the one place the four names are picked out of the document — they were
   * written out four times, once per request, which is four places for a fifth
   * field to be forgotten.
   */
  private endpoint(): ChatEndpoint {
    const { provider, baseUrl, apiKey, model } = this.settings.connection();
    return { provider, baseUrl, apiKey, model };
  }

  private queueFlush(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.flush();
    });
  }

  private flush(): void {
    const id = this.chapters.streamingId();
    if (!id || (!this.pendingContent && !this.pendingReasoning)) return;
    const content = this.pendingContent;
    const reasoning = this.pendingReasoning;
    this.pendingContent = '';
    this.pendingReasoning = '';
    this.chapters.patchMessage(this.streamingChapterId, id, (message) => ({
      content: message.content + content,
      reasoning: reasoning ? (message.reasoning ?? '') + reasoning : message.reasoning,
    }));
  }

  private cancelFlush(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.pendingContent = '';
    this.pendingReasoning = '';
  }
}
