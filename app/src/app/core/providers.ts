/**
 * Every endpoint the connection modal offers, as data.
 *
 * The browser talks to the provider directly (§1.4), so the only thing that
 * decides whether a provider can be on this list is whether it answers a CORS
 * preflight. All of these do — probed on 2026-09-03 from `http://localhost:4177`
 * with a `POST` asking for `authorization, content-type`; `tools/probe-providers.mjs`
 * re-runs that probe and prints the table in *docs/models-and-parameters.md*.
 *
 * Adding a provider is adding a row. The two hooks below (`headers`,
 * `modelsQuery` / `modelsFixed` / `stripModelPrefix`) exist because four
 * providers need one line each, not because the shape is negotiable: every one
 * of these speaks OpenAI's chat-completions, which is the only shape this app
 * sends.
 */

import type { ModelInfo } from './models';
import { WEBSITE } from './project';

export type ProviderGroup = 'Hosted' | 'Aggregators' | 'Run locally' | 'Other';

export interface ProviderPreset {
  /** Stored in `settings.json` as `connection.provider`. Never reuse one. */
  id: string;
  name: string;
  group: ProviderGroup;
  /** Empty for `custom`, which means "the URL is whatever was typed". */
  baseUrl: string;
  /** Where this provider hands out keys; shown as a link beside the field. */
  keyUrl?: string;
  /** Fixed extra headers, merged into every request to this provider. */
  headers?: Readonly<Record<string, string>>;
  /** Query string appended to `GET /models`, without the `?`. */
  modelsQuery?: string;
  /** For providers with no `/models`: the list is typed out here instead. */
  modelsFixed?: readonly ModelInfo[];
  /** Stripped off ids coming back from `/models` (Gemini's `models/`). */
  stripModelPrefix?: string;
  /**
   * What this endpoint needs from us to reuse a prompt prefix it has already
   * read, and charge a fraction for it.
   *
   * Absent is the common answer and means "send plain strings": every provider
   * on this list either caches implicitly or does not cache at all, and both
   * of those want the request exactly as it has always been sent. `breakpoints`
   * is the aggregators that route Claude and Qwen models, which cache only
   * where the request marks the prefix with `cache_control` — and only for
   * those models, which is why the model id decides as well as this field.
   *
   * Anthropic's own row does not have it. `api.anthropic.com/v1` is their
   * OpenAI compatibility layer, and its documentation lists prompt caching
   * under what that layer does not support, with `prompt_tokens_details`
   * always empty. Caching a Claude model against Anthropic directly means
   * speaking `/v1/messages`, which is a different request, response and
   * stream; through NanoGPT or OpenRouter the same model caches normally.
   */
  caching?: 'implicit' | 'breakpoints';
  /**
   * The body field this provider takes a sticky-routing hint in, if any.
   *
   * An aggregator routes each request on its own, so a warm prefix on one
   * upstream is no use to a turn that lands somewhere else; OpenAI uses the
   * same hint to pick which of its own machines answers. The chapter id is
   * what the app sends, because it changes exactly when the prompt legitimately
   * changes wholesale.
   */
  cacheKeyField?: 'prompt_cache_key' | 'session_id';
  /** One line under the URL field, when this provider needs something said. */
  note?: string;
  /** True when the endpoint works with the key box left empty. */
  keyOptional?: boolean;
}

export const CUSTOM_PROVIDER_ID = 'custom';
export const DEFAULT_PROVIDER_ID = 'nanogpt';

/** Sent to providers that credit the apps calling them. */
const ATTRIBUTION_HEADERS: Readonly<Record<string, string>> = {
  'HTTP-Referer': WEBSITE,
  'X-Title': 'Lamplit',
};

/** Perplexity publishes no `/models`; this is its documented chat set. */
const PERPLEXITY_MODELS: readonly ModelInfo[] = [
  { id: 'sonar', name: 'Sonar' },
  { id: 'sonar-pro', name: 'Sonar Pro' },
  { id: 'sonar-reasoning', name: 'Sonar Reasoning' },
  { id: 'sonar-reasoning-pro', name: 'Sonar Reasoning Pro' },
  { id: 'sonar-deep-research', name: 'Sonar Deep Research' },
];

export const PROVIDERS: readonly ProviderPreset[] = [
  // -- Hosted: the model's own maker -----------------------------------------
  {
    id: 'openai',
    name: 'OpenAI',
    group: 'Hosted',
    baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    // Automatic from 1024 tokens up, in 128-token increments; the key only
    // improves which machine the request lands on.
    caching: 'implicit',
    cacheKeyField: 'prompt_cache_key',
    note: 'The list includes models that cannot chat; filter for gpt.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    group: 'Hosted',
    baseUrl: 'https://api.anthropic.com/v1',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    // Anthropic blocks browser calls unless they say, in a header, that the
    // key is meant to be there. It is: this app has no server to hide it on.
    headers: {
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
  },
  {
    id: 'google',
    name: 'Google Gemini',
    group: 'Hosted',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    caching: 'implicit',
    keyUrl: 'https://aistudio.google.com/apikey',
    stripModelPrefix: 'models/',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    group: 'Hosted',
    baseUrl: 'https://api.mistral.ai/v1',
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    group: 'Hosted',
    baseUrl: 'https://api.deepseek.com/v1',
    caching: 'implicit',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    group: 'Hosted',
    baseUrl: 'https://api.x.ai/v1',
    caching: 'implicit',
    keyUrl: 'https://console.x.ai',
  },
  {
    id: 'groq',
    name: 'Groq',
    group: 'Hosted',
    baseUrl: 'https://api.groq.com/openai/v1',
    caching: 'implicit',
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'together',
    name: 'Together',
    group: 'Hosted',
    baseUrl: 'https://api.together.xyz/v1',
    keyUrl: 'https://api.together.xyz/settings/api-keys',
  },
  {
    id: 'fireworks',
    name: 'Fireworks',
    group: 'Hosted',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    keyUrl: 'https://fireworks.ai/account/api-keys',
  },
  {
    id: 'cohere',
    name: 'Cohere',
    group: 'Hosted',
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    keyUrl: 'https://dashboard.cohere.com/api-keys',
  },
  {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    group: 'Hosted',
    baseUrl: 'https://api.moonshot.ai/v1',
    caching: 'implicit',
    keyUrl: 'https://platform.moonshot.ai/console/api-keys',
  },
  {
    id: 'zai',
    name: 'Z.ai (GLM)',
    group: 'Hosted',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    caching: 'implicit',
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    group: 'Hosted',
    baseUrl: 'https://api.siliconflow.com/v1',
    keyUrl: 'https://cloud.siliconflow.com/account/ak',
    note: 'Mainland China has its own host: api.siliconflow.cn.',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    group: 'Hosted',
    baseUrl: 'https://api.minimax.io/v1',
    keyUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key',
    note: 'Mainland China has its own host: api.minimaxi.com.',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    group: 'Hosted',
    baseUrl: 'https://api.perplexity.ai',
    keyUrl: 'https://www.perplexity.ai/settings/api',
    modelsFixed: PERPLEXITY_MODELS,
    note: 'Perplexity publishes no model list, so this one is built in.',
  },

  // -- Aggregators: one key, many makers -------------------------------------
  {
    id: 'openrouter',
    name: 'OpenRouter',
    group: 'Aggregators',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys',
    headers: ATTRIBUTION_HEADERS,
    caching: 'breakpoints',
    // Ten minutes idle, and ≤256 characters, which a chapter id is.
    cacheKeyField: 'session_id',
  },
  {
    id: DEFAULT_PROVIDER_ID,
    name: 'NanoGPT',
    group: 'Aggregators',
    baseUrl: 'https://nano-gpt.com/api/v1',
    keyUrl: 'https://nano-gpt.com/api',
    caching: 'breakpoints',
    // `?detailed=true` is what turns a list of ids into a list with display
    // names and context lengths, which is what the model picker reads.
    modelsQuery: 'detailed=true',
  },
  {
    id: 'aimlapi',
    name: 'AIMLAPI',
    group: 'Aggregators',
    baseUrl: 'https://api.aimlapi.com/v1',
    keyUrl: 'https://aimlapi.com/app/keys',
    headers: ATTRIBUTION_HEADERS,
  },
  {
    id: 'cometapi',
    name: 'CometAPI',
    group: 'Aggregators',
    baseUrl: 'https://api.cometapi.com/v1',
    keyUrl: 'https://api.cometapi.com/console/token',
  },
  {
    id: 'electronhub',
    name: 'ElectronHub',
    group: 'Aggregators',
    baseUrl: 'https://api.electronhub.ai/v1',
    keyUrl: 'https://playground.electronhub.ai',
  },
  {
    id: 'chutes',
    name: 'Chutes',
    group: 'Aggregators',
    baseUrl: 'https://llm.chutes.ai/v1',
    keyUrl: 'https://chutes.ai/app/api',
  },
  {
    id: 'pollinations',
    name: 'Pollinations',
    group: 'Aggregators',
    baseUrl: 'https://gen.pollinations.ai/v1',
    keyUrl: 'https://auth.pollinations.ai',
    keyOptional: true,
    note: 'Has a free tier that works with the key box left empty.',
  },

  // -- Run locally: a model on this machine, no key, no bill -----------------
  {
    id: 'ollama',
    name: 'Ollama',
    group: 'Run locally',
    baseUrl: 'http://localhost:11434/v1',
    keyOptional: true,
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    group: 'Run locally',
    baseUrl: 'http://localhost:1234/v1',
    keyOptional: true,
  },
  {
    id: 'llamacpp',
    name: 'llama.cpp server',
    group: 'Run locally',
    baseUrl: 'http://localhost:8080/v1',
    keyOptional: true,
  },
  {
    id: 'vllm',
    name: 'vLLM',
    group: 'Run locally',
    baseUrl: 'http://localhost:8000/v1',
    keyOptional: true,
  },
  {
    id: 'koboldcpp',
    name: 'KoboldCpp',
    group: 'Run locally',
    baseUrl: 'http://localhost:5001/v1',
    keyOptional: true,
  },
  {
    id: 'tabbyapi',
    name: 'TabbyAPI',
    group: 'Run locally',
    baseUrl: 'http://localhost:5000/v1',
    keyOptional: true,
  },
  {
    id: 'textgenwebui',
    name: 'text-generation-webui',
    group: 'Run locally',
    baseUrl: 'http://localhost:5000/v1',
    keyOptional: true,
  },

  // -- Anything else ---------------------------------------------------------
  {
    id: CUSTOM_PROVIDER_ID,
    name: 'Custom (OpenAI-compatible)',
    group: 'Other',
    baseUrl: '',
    keyOptional: true,
    note: 'Anything that answers /models and /chat/completions.',
  },
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

/**
 * The row for a stored provider id. A settings file naming a provider this
 * version has never heard of reads as Custom, which keeps the URL it saved.
 */
export function providerPreset(id: string | undefined): ProviderPreset {
  return (id && BY_ID.get(id)) || BY_ID.get(CUSTOM_PROVIDER_ID)!;
}

export interface ProviderGroupView {
  label: ProviderGroup;
  providers: readonly ProviderPreset[];
}

/** The select's optgroups, in the order the modal shows them. */
export const PROVIDER_GROUPS: readonly ProviderGroupView[] = (
  ['Aggregators', 'Hosted', 'Run locally', 'Other'] as const
).map((label) => ({ label, providers: PROVIDERS.filter((p) => p.group === label) }));

/** True when the URL field is the provider's to fill, not the user's. */
export function hasFixedUrl(preset: ProviderPreset): boolean {
  return preset.id !== CUSTOM_PROVIDER_ID;
}
