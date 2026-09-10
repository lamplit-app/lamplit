import { Injectable } from '@angular/core';
import { DEFAULT_GENERATION } from './defaults';
import {
  ConnectionSettings,
  GenerationParams,
  ModelInfo,
  OutboundMessage,
  TokenUsage,
} from './models';
import { ProviderPreset, providerPreset } from './providers';
import { readSseData } from './sse';
import { ModelError, errorFromResponse, errorFromThrown } from './model-errors';

/**
 * Where a request goes and how it is signed: the connection document, minus
 * the model list fetched off it.
 *
 * Named as a slice of `ConnectionSettings` rather than as four fields of its
 * own, so that renaming one of them in the document renames it here. Every
 * caller had spelled the four out by hand — four times in one file — and each
 * of those was a place a fifth field would not arrive.
 */
export type ChatEndpoint = Pick<ConnectionSettings, 'provider' | 'baseUrl' | 'apiKey' | 'model'>;

export interface ChatStreamRequest extends ChatEndpoint {
  messages: readonly OutboundMessage[];
  params: GenerationParams;
  /**
   * What to tell a provider that routes, so consecutive turns land where the
   * warm prefix is. The chapter id, from the one caller that has one; absent
   * everywhere else, and ignored by every provider whose row does not name a
   * field for it.
   */
  cacheKey?: string;
}

/**
 * The three dials on the body that are not the user's: each is asked for
 * first and dropped on the 400 that names it, because half of what speaks
 * chat-completions does not speak all of it and there is no list of who does
 * that would stay true.
 */
export interface WireOptions {
  /** `stream_options: { include_usage: true }`. */
  streamOptions?: boolean;
  /** `cache_control` breakpoints, where the provider's row asks for them. */
  caching?: boolean;
  /** Present on the JSON path: the answer must be one object, and is not streamed. */
  json?: { schema?: JsonChatRequest['schema'] };
}

export interface ChatStreamResult {
  content: string;
  reasoning: string;
  usage?: TokenUsage;
  finishReason?: string;
  aborted: boolean;
  /**
   * The reply ended early and not because anyone asked it to: the provider
   * sent an error mid-stream, or the connection went. Whatever had arrived is
   * in `content`, which is the point of saying this rather than throwing.
   */
  interrupted?: ModelError;
}

export type DeltaHandler = (delta: { content?: string; reasoning?: string }) => void;

/** A request that must come back as one JSON object rather than as prose. */
export interface JsonChatRequest extends ChatStreamRequest {
  /** The shape asked for, when the endpoint will take one. */
  schema: { name: string; schema: Record<string, unknown> };
}

export interface JsonChatResult<T> {
  /** Null when nothing JSON-shaped could be found in the answer. */
  value: T | null;
  /** What actually came back, for an error message worth reading. */
  raw: string;
  usage?: TokenUsage;
}

@Injectable({ providedIn: 'root' })
export class ModelClient {
  /**
   * `GET {baseUrl}/models`, with whatever the provider's row asks for: NanoGPT's
   * `?detailed=true` for display names and context lengths, Anthropic's two
   * headers, Gemini's `models/` prefix off the ids. A provider with no list of
   * its own (Perplexity) carries one in the table and is never called.
   */
  async listModels(baseUrl: string, apiKey: string, provider?: string): Promise<ModelInfo[]> {
    const preset = providerPreset(provider);
    if (preset.modelsFixed?.length) return preset.modelsFixed.map((m) => ({ ...m }));

    let response: Response;
    try {
      response = await fetch(modelsUrl(baseUrl, preset), {
        headers: { ...authHeaders(apiKey), ...(preset.headers ?? {}) },
      });
    } catch (e) {
      throw errorFromThrown(e);
    }
    if (!response.ok) throw errorFromResponse(response.status, await safeText(response));

    const payload: unknown = await response.json().catch(() => null);
    const models = toModelList(payload, preset.stripModelPrefix);
    if (!models.length) {
      throw new ModelError('bad-request', 'The endpoint returned no models.');
    }
    return models;
  }

  /**
   * One short round trip, used by the Connection modal's Test button.
   *
   * The shipped parameters with two of them replaced, rather than three fields
   * cast into a `GenerationParams` that was missing the other four. The cast
   * compiled and the request was correct — `buildBody` only ever sends what is
   * a number — but it was a promise the type could not keep, and the day
   * `buildBody` reads a fifth field the probe is the one caller that would not
   * have it. Two overrides, because a probe wants the shortest answer the
   * endpoint will give and the same answer every time.
   */
  async testConnection(endpoint: ChatEndpoint): Promise<string> {
    const result = await this.streamChat(
      {
        ...endpoint,
        messages: [{ role: 'user', content: 'Say OK.' }],
        params: { ...DEFAULT_GENERATION, maxResponseTokens: 8, temperature: 0 },
      },
      () => {
        /* the probe wants the answer whole, not as it arrives */
      },
    );
    return result.content.trim();
  }

  /**
   * `POST {baseUrl}/chat/completions` with `stream: true`, parsed as SSE.
   * Deltas arrive through `onDelta`; the resolved result carries the provider's
   * own `usage` and `finish_reason` when the final chunk includes them.
   * Aborting via `signal` resolves rather than throwing, so partial text is kept.
   */
  async streamChat(
    request: ChatStreamRequest,
    onDelta: DeltaHandler,
    signal?: AbortSignal,
  ): Promise<ChatStreamResult> {
    const url = `${normaliseBaseUrl(request.baseUrl)}/chat/completions`;

    let response = await this.post(url, request, {}, signal);
    // Not every OpenAI-compatible server knows `stream_options`, and plenty of
    // local ones reject array content outright; one retry without whichever
    // the refusal named costs nothing and keeps odd endpoints working.
    if (response.status === 400) {
      const body = await safeText(response);
      const relaxed = relaxation(body, {});
      if (!relaxed) throw errorFromResponse(400, body);
      response = await this.post(url, request, relaxed, signal);
    }
    if (!response.ok) throw errorFromResponse(response.status, await safeText(response));
    if (!response.body) throw new ModelError('unknown', 'The endpoint returned an empty stream.');

    // An endpoint that does not stream answers the same request with the whole
    // completion as one JSON object, and says so in its content type. Read as
    // SSE that has no `data:` lines in it at all, which is an empty reply
    // filed as if the model had said nothing.
    if (/^application\/json\b/i.test(response.headers.get('content-type') ?? '')) {
      return this.whole(response, onDelta);
    }

    const result: ChatStreamResult = { content: '', reasoning: '', aborted: false };
    let saw = false;
    try {
      for await (const payload of readSseData(response.body)) {
        saw = true;
        if (payload === '[DONE]') break;
        const chunk = parseChunk(payload);
        if (!chunk) continue;
        if (chunk.error) throw new ModelError('unknown', chunk.error);
        if (chunk.usage) result.usage = chunk.usage;
        if (chunk.finishReason) result.finishReason = chunk.finishReason;
        if (chunk.content) {
          result.content += chunk.content;
          onDelta({ content: chunk.content });
        }
        if (chunk.reasoning) {
          result.reasoning += chunk.reasoning;
          onDelta({ reasoning: chunk.reasoning });
        }
      }
    } catch (e) {
      const error = errorFromThrown(e);
      // Text the reader has already watched arrive is not something to replace
      // with an error card: a reply cut short is kept, and the footer says it
      // was cut short. Nothing at all is a failed turn, with a Try again.
      if (error.kind === 'aborted') result.aborted = true;
      else if (result.content || result.reasoning) result.interrupted = dropped(error);
      else throw error;
    }
    if (signal?.aborted) result.aborted = true;
    // Not one event, and nobody stopped it: something answered 200 and said
    // nothing, which is worth a sentence rather than an empty message.
    if (!saw && !result.aborted) {
      throw new ModelError('unknown', 'The endpoint answered without sending anything.');
    }
    return result;
  }

  /** A completion that arrived whole, handed on as if it had streamed. */
  private async whole(response: Response, onDelta: DeltaHandler): Promise<ChatStreamResult> {
    const payload: unknown = await response.json().catch(() => null);
    const answer = readCompletion(payload);
    if (!answer.content) {
      throw new ModelError('bad-request', 'The endpoint answered, but with no text in it.');
    }
    onDelta({ content: answer.content });
    return { content: answer.content, reasoning: '', usage: answer.usage, aborted: false };
  }

  /**
   * One answer, not streamed, that has to be JSON.
   *
   * `response_format: json_schema` is asked for first and dropped on a 400 that
   * names it — the same shape as the `stream_options` retry above, and for the
   * same reason: half of what speaks chat-completions does not speak all of it,
   * and there is no list of who does that would stay true. The instruction to
   * answer with JSON and nothing else is in the prompt either way, so the
   * fallback is a request that asks for the same thing less formally.
   *
   * Nothing here throws on a badly-shaped answer: `value` is null and `raw` is
   * whatever came back, because the caller has something better to do with that
   * than a stack trace.
   */
  async chatJson<T>(request: JsonChatRequest, signal?: AbortSignal): Promise<JsonChatResult<T>> {
    const url = `${normaliseBaseUrl(request.baseUrl)}/chat/completions`;

    const asked: WireOptions = { json: { schema: request.schema } };
    let response = await this.post(url, request, asked, signal);
    if (response.status === 400) {
      const body = await safeText(response);
      // Without the schema, and still not streamed: the answer is a whole
      // object or it is nothing, and there is no half of one worth watching.
      const relaxed = /response_format|json_schema/i.test(body)
        ? { ...asked, json: {} }
        : relaxation(body, asked);
      if (!relaxed) throw errorFromResponse(400, body);
      response = await this.post(url, request, relaxed, signal);
    }
    if (!response.ok) throw errorFromResponse(response.status, await safeText(response));

    const payload: unknown = await response.json().catch(() => null);
    const answer = readCompletion(payload);
    return { value: parseJsonObject<T>(answer.content), raw: answer.content, usage: answer.usage };
  }

  private async post(
    url: string,
    request: ChatStreamRequest,
    options: WireOptions,
    signal?: AbortSignal,
  ): Promise<Response> {
    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          ...authHeaders(request.apiKey),
          ...(providerPreset(request.provider).headers ?? {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildBody(request, options)),
        signal,
      });
    } catch (e) {
      throw errorFromThrown(e);
    }
  }
}

/**
 * A failure that arrived mid-reply, said as what it is. `errorFromThrown`
 * cannot know that the endpoint was answering a moment ago, so its "check the
 * base URL and CORS" is about a connection that was demonstrably working.
 */
function dropped(error: ModelError): ModelError {
  if (error.kind !== 'network') return error;
  return new ModelError(
    'network',
    'The connection dropped part-way through the reply.',
    error.status,
    error.detail,
  );
}

/**
 * The whole request body, rebuilt from parameters every time.
 *
 * `options.json` marks the other path: an answer that has to be one object,
 * which is not streamed — there is nothing to watch arrive, and half of an
 * object is no use to anybody. It stays not-streamed when the schema is
 * dropped, because dropping the schema is a retry of the same request rather
 * than a different kind of one.
 */
export function buildBody(
  request: ChatStreamRequest,
  options: WireOptions = {},
): Record<string, unknown> {
  const p = request.params;
  const json = options.json;
  const streaming = !json;
  const preset = providerPreset(request.provider);
  const body: Record<string, unknown> = {
    model: request.model,
    // Never on the JSON path: the summary and the lore proposals are their own
    // prompts, asked once each, and marking a prefix nothing will read again
    // is a cache write paid for and thrown away.
    messages:
      options.caching === false || json
        ? request.messages
        : breakpointed(request.messages, request, preset),
    stream: streaming,
    max_tokens: p.maxResponseTokens,
  };
  if (streaming && options.streamOptions !== false) {
    body['stream_options'] = { include_usage: true };
  }
  // Where the provider takes one: which of its upstreams — or which of its own
  // machines — should answer, so the turn lands on the prefix the last one left
  // warm. One value for a chapter, and a different one for the next chapter.
  if (preset.cacheKeyField && request.cacheKey) body[preset.cacheKeyField] = request.cacheKey;
  if (json?.schema) {
    body['response_format'] = {
      type: 'json_schema',
      json_schema: { name: json.schema.name, schema: json.schema.schema, strict: true },
    };
  }

  // Defined-only, so an endpoint never sees a parameter the user did not set.
  setIfNumber(body, 'temperature', p.temperature);
  setIfNumber(body, 'top_p', p.topP);
  setIfNumber(body, 'frequency_penalty', p.frequencyPenalty);
  setIfNumber(body, 'presence_penalty', p.presencePenalty);
  setIfNumber(body, 'seed', p.seed);
  setIfNumber(body, 'top_k', p.topK);
  setIfNumber(body, 'min_p', p.minP);
  setIfNumber(body, 'repetition_penalty', p.repetitionPenalty);
  setIfNumber(body, 'top_a', p.topA);
  if (p.stop.length) body['stop'] = p.stop;
  if (p.reasoningEffort && p.reasoningEffort !== 'none') {
    body['reasoning_effort'] = p.reasoningEffort;
  }
  return body;
}

/**
 * What to drop from a request the endpoint has just refused with a 400 that
 * names it. Null when the refusal is about something we did not choose, which
 * is a real error and not a dialect.
 */
function relaxation(body: string, options: WireOptions): WireOptions | null {
  if (body.includes('cache_control')) return { ...options, caching: false };
  if (body.includes('stream_options')) return { ...options, streamOptions: false };
  return null;
}

/**
 * The same messages, with up to two of them marked as worth caching.
 *
 * Anthropic-shaped caching is the one kind that has to be asked for: the
 * request marks where the reusable prefix ends and the provider keeps
 * everything up to that mark. Two marks, which is the pattern (the ceiling is
 * four): the leading system message, which is the same bytes for the whole
 * chapter, and the newest reply, which is the end of the history and so takes
 * the growing tail with it. What comes after that mark — the new line, and the
 * world block behind it — is the only part paid for in full.
 *
 * Only for the models that need it, on the providers that route them: a
 * `gpt-*` id on the same connection caches implicitly and wants the plain
 * string it has always been sent, and plenty of local servers reject array
 * content outright.
 */
function breakpointed(
  messages: readonly OutboundMessage[],
  request: ChatStreamRequest,
  preset: ProviderPreset,
): readonly (OutboundMessage | WireMessage)[] {
  if (preset.caching !== 'breakpoints' || !CACHE_CONTROL_MODELS.test(request.model)) {
    return messages;
  }

  const marked = new Set<number>();
  if (messages[0]?.role === 'system') marked.add(0);
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'assistant') {
      marked.add(i);
      break;
    }
  }

  return messages.map((message, i) =>
    marked.has(i)
      ? {
          role: message.role,
          content: [{ type: 'text' as const, text: message.content, cache_control: EPHEMERAL }],
        }
      : message,
  );
}

/** The families whose caching is explicit wherever they are routed from. */
const CACHE_CONTROL_MODELS = /claude|qwen/i;

const EPHEMERAL = { type: 'ephemeral' as const };

/**
 * A message as the wire may carry it when a breakpoint is on it.
 *
 * Only here, and only in `buildBody`: `OutboundMessage.content` stays a plain
 * string everywhere the app reasons about a prompt — the estimator counts it,
 * the preview draws it, the clipboard copies it — and the array form is a
 * dialect one provider asks for at the last moment.
 */
interface WireMessage {
  role: OutboundMessage['role'];
  content: { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }[];
}

interface ParsedChunk {
  content?: string;
  reasoning?: string;
  finishReason?: string;
  usage?: TokenUsage;
  error?: string;
}

/** One SSE `data:` payload of a chat-completions stream. */
export function parseChunk(payload: string): ParsedChunk | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null; // keep-alive noise or a line we can safely skip
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const error = field(parsed, 'error');
  if (error) {
    const message = typeof error === 'string' ? error : stringOrUndefined(field(error, 'message'));
    return { error: message || 'The provider reported an error mid-stream.' };
  }

  const chunk: ParsedChunk = {};
  const choices = field(parsed, 'choices');
  const choice: unknown = Array.isArray(choices) ? choices[0] : undefined;
  const delta = field(choice, 'delta');
  const content = field(delta, 'content');
  if (typeof content === 'string') chunk.content = content;
  // `reasoning_content` (DeepSeek-style) and `reasoning` (OpenRouter-style).
  const reasoning = field(delta, 'reasoning_content') ?? field(delta, 'reasoning');
  if (typeof reasoning === 'string') chunk.reasoning = reasoning;
  const finishReason = field(choice, 'finish_reason');
  if (typeof finishReason === 'string') chunk.finishReason = finishReason;

  const usage = usageOf(field(parsed, 'usage'));
  if (usage) chunk.usage = usage;
  return chunk;
}

/** One non-streamed chat completion: the text of it, and what it cost. */
export function readCompletion(payload: unknown): { content: string; usage?: TokenUsage } {
  const choices = field(payload, 'choices');
  const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
  const content = field(field(first, 'message'), 'content');
  return {
    content: typeof content === 'string' ? content : '',
    usage: usageOf(field(payload, 'usage')),
  };
}

/**
 * The first JSON object in an answer that was supposed to be nothing but one.
 *
 * Models asked for JSON hand it back fenced, or with a sentence in front of it,
 * or both, and an endpoint that enforced a schema hands back exactly what was
 * asked for. All three arrive here, and only the third is common enough to be
 * worth being strict about — so this tries the whole string, then the fenced
 * block, then the widest `{…}` it can find, and gives up rather than guessing.
 */
export function parseJsonObject<T>(text: string): T | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const candidates = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)?.[1];
  if (fenced) candidates.push(fenced.trim());
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as T;
    } catch {
      /* the next candidate, or nothing */
    }
  }
  return null;
}

/** The `/models` call a provider's row asks for, query string and all. */
export function modelsUrl(baseUrl: string, preset: ProviderPreset): string {
  const base = normaliseBaseUrl(baseUrl);
  return `${base}/models${preset.modelsQuery ? `?${preset.modelsQuery}` : ''}`;
}

/** Trims trailing slashes and a trailing `/chat/completions` a user may paste. */
export function normaliseBaseUrl(baseUrl: string): string {
  return baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '');
}

function authHeaders(apiKey: string): Record<string, string> {
  const key = apiKey.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function toModelList(payload: unknown, stripPrefix?: string): ModelInfo[] {
  const data = field(payload, 'data');
  const raw: unknown[] = Array.isArray(payload) ? payload : Array.isArray(data) ? data : [];
  const models: ModelInfo[] = [];
  for (const entry of raw) {
    let id = stringOrUndefined(field(entry, 'id'));
    if (!id) continue;
    if (stripPrefix && id.startsWith(stripPrefix)) id = id.slice(stripPrefix.length);
    const name = stringOrUndefined(field(entry, 'name'));
    models.push({
      id,
      name: name !== undefined && name !== id ? name : undefined,
      ownedBy: stringOrUndefined(field(entry, 'owned_by')),
      created: numberOrUndefined(field(entry, 'created')),
      contextLength: numberOrUndefined(
        field(entry, 'context_length') ?? field(entry, 'context_window'),
      ),
    });
  }
  models.sort((a, b) => a.id.localeCompare(b.id));
  return models;
}

function setIfNumber(body: Record<string, unknown>, key: string, value: unknown): void {
  if (typeof value === 'number' && Number.isFinite(value)) body[key] = value;
}

/**
 * One property of whatever JSON arrived, or undefined when there is no such
 * thing to have a property. Everything the wire says comes in as `unknown` and
 * leaves through here and the narrowers under it, so a provider that shapes
 * its answer differently is a missing field, never a crash.
 */
function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * What the request cost, in whichever of the three dialects the provider
 * counts a cache hit in.
 *
 * `prompt_tokens_details.cached_tokens` is OpenAI's and what most aggregators
 * copied; `prompt_cache_hit_tokens` is DeepSeek's; `cache_read_input_tokens`
 * is Anthropic's shape, which is what NanoGPT and OpenRouter report for a
 * Claude model. First one present wins, and a provider that reports none of
 * them leaves the field undefined rather than zero — nobody can tell a
 * provider that missed from one that does not count out loud, and a zero
 * would claim to.
 */
function usageOf(value: unknown): TokenUsage | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const details = field(value, 'prompt_tokens_details');
  return {
    promptTokens: numberOrUndefined(field(value, 'prompt_tokens')),
    completionTokens: numberOrUndefined(field(value, 'completion_tokens')),
    totalTokens: numberOrUndefined(field(value, 'total_tokens')),
    cachedTokens:
      numberOrUndefined(field(details, 'cached_tokens')) ??
      numberOrUndefined(field(value, 'prompt_cache_hit_tokens')) ??
      numberOrUndefined(field(value, 'cache_read_input_tokens')),
    cacheWriteTokens:
      numberOrUndefined(field(value, 'cache_write_tokens')) ??
      numberOrUndefined(field(value, 'cache_creation_input_tokens')),
  };
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
