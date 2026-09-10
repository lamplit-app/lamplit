/**
 * A deterministic stand-in for an OpenAI-compatible endpoint.
 *
 * The tests steer it from the message they send:
 *   "!prose"  one paragraph holding narration and two quoted lines, which is
 *             the only shape book style actually has work to do on
 *   "!slow"   stream one word every 120 ms, so Stop has something to cut into
 *   "!error"  answer 500 before streaming
 *   "!401"    answer 401
 *   "!long"   stream a long passage
 *   "!loop"   stream a long passage of emphasis that never closes, which is
 *             what a model that has started repeating itself writes and what
 *             a markdown parser is slowest on
 *   "!nolore" answer 500 to the lore request only, and stream as usual
 * Anything else gets a short canned scene with speech and an action in it,
 * suffixed with a counter so a regenerated answer is visibly different.
 *
 * A request that is not streamed is the lore extraction or the page palette,
 * and comes back as one JSON object rather than as prose. The model id decides
 * how well this endpoint speaks JSON:
 *   fake/no-json-schema   refuses `response_format` with a 400, the way an
 *                         endpoint that has never heard of it does, and then
 *                         answers with the object inside a ```json fence
 * Anything else takes the schema and answers with a bare object. That id is
 * deliberately not in the list above: a spec that wants it names it in the
 * settings it seeds, and two specs count what `/models` returns.
 *
 * And one more that the model id decides:
 *   …no-cache-control…    refuses array content with a 400 naming
 *                         `cache_control`, the way a local server that has
 *                         only ever seen strings does
 * Every other id takes it, and a request that marked a prefix is answered with
 * a cached count for exactly what it marked — which is what the app reads back
 * and writes under the reply. A request that marked nothing gets no such
 * field, which is what most endpoints report and every local one.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_API_PORT ?? 4310);

const MODELS = [
  {
    id: 'fake/storyteller-large',
    owned_by: 'fake',
    created: 1,
    name: 'Storyteller Large',
  },
  { id: 'fake/storyteller-small', owned_by: 'fake', created: 2 },
  { id: 'other/echo-1', owned_by: 'other', created: 3 },
];

const SCENE = [
  'The knight lowered her lantern.',
  '"You are smaller than the songs promised," she said.',
  '*The dragon shifted, scales grinding on stone.*',
  '"And you are louder," it answered.',
];

const LONG = Array.from({ length: 60 }, (_, i) => `Sentence ${i + 1} of the long passage.`);

/**
 * Thirty thousand characters of emphasis that never closes, which is what a
 * markdown parser is slowest on and what the app now renders a paragraph at a
 * time rather than whole. Here so that the shape a model produces when it has
 * lost the thread is a shape the app is known to draw.
 */
const LOOPING = Array.from({ length: 300 }, () => '**a **b** '.repeat(10)).join('\n\n');

/** Everything in one paragraph, the way plenty of real models answer. */
const PROSE = [
  'The knight lowered her lantern. "You are smaller than the songs promised," she said.',
  '*The dragon shifted.* "And you are louder," it answered.',
].join(' ');

let turn = 0;

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);

  // Browser calls carry Authorization and Content-Type, so preflight matters.
  cors(response);
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === '/v1/models' && request.method === 'GET') {
    json(response, 200, { object: 'list', data: MODELS });
    return;
  }

  if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
    const body = await readJson(request);
    if (noCacheControl(response, body)) return;
    const prompt = lastUserMessage(body);

    if (prompt.includes('!401') || request.headers.authorization === 'Bearer bad-key') {
      json(response, 401, {
        error: {
          message: 'Incorrect API key provided.',
          code: 'invalid_api_key',
        },
      });
      return;
    }
    if (prompt.includes('!error')) {
      json(response, 500, {
        error: { message: 'The upstream model is on fire.' },
      });
      return;
    }

    // Not streamed: the two requests in the app shaped like that both want
    // JSON back. The catalogue of palettes is only in one of them.
    if (body?.stream === false) {
      if (prompt.includes('The palettes:')) palette(response, body, prompt);
      else lore(response, body, prompt);
      return;
    }

    await stream(response, body, prompt);
    return;
  }

  json(response, 404, {
    error: { message: `No route for ${request.method} ${url.pathname}` },
  });
});

async function stream(response, body, prompt) {
  const model = body?.model ?? 'fake/storyteller-large';
  const slow = prompt.includes('!slow');
  const words = pick(prompt).split(/(?<=\s)/);

  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const promptTokens = countPrompt(body);

  for (const word of words) {
    if (response.writableEnded || response.destroyed) return;
    send(response, {
      id: 'chatcmpl-fake',
      object: 'chat.completion.chunk',
      model,
      choices: [{ index: 0, delta: { content: word }, finish_reason: null }],
    });
    if (slow) await delay(120);
  }

  send(response, {
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    model,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  });
  if (body?.stream_options?.include_usage) {
    send(response, {
      id: 'chatcmpl-fake',
      object: 'chat.completion.chunk',
      model,
      choices: [],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: words.length,
        total_tokens: promptTokens + words.length,
        // What a provider with a prefix cache says it did not have to read
        // again: everything up to and including the last message the request
        // marked. Said only when the request marked something, because an
        // endpoint that does not cache says nothing rather than zero.
        ...(marked(body) ? { prompt_tokens_details: { cached_tokens: cached(body) } } : {}),
      },
    });
  }
  response.write('data: [DONE]\n\n');
  response.end();
}

/**
 * The page palette: one name out of the list the request carried.
 *
 * Read out of the scene the way the lore is read out of the chapter, by looking
 * for a word the spec planted — a scene with snow in it is cold, and the spec
 * that seeded that scene can say which page it expects. Anything else is
 * `pallor`, so a spec that planted nothing gets a page and not a failure.
 */
function palette(response, body, prompt) {
  if (noSchema(response, body)) return;
  const scene = prompt.split('The palettes:')[0];
  const name = /snow|winter|cold|frost/i.test(scene)
    ? 'frost'
    : /neon|midnight|jazz|city/i.test(scene)
      ? 'nocturne'
      : 'pallor';
  answer(response, body, JSON.stringify({ palette: name }));
}

/**
 * The 400 a server that has only ever seen string content answers a request
 * with `cache_control` blocks in it. One model id only, so the spec that wants
 * to watch the retry names it; the retry sends plain strings and works.
 */
function noCacheControl(response, body) {
  if (!String(body?.model ?? '').includes('no-cache-control')) return false;
  if (!(body?.messages ?? []).some((m) => Array.isArray(m.content))) return false;
  json(response, 400, {
    error: { message: "Unknown parameter: 'cache_control'.", type: 'invalid_request_error' },
  });
  return true;
}

/**
 * How many prompt tokens a request carries, over its first `upTo` messages —
 * all of them by default. Content is a string, or the array form a request
 * that marks a cache breakpoint sends.
 */
function countPrompt(body, upTo) {
  const messages = (body?.messages ?? []).slice(0, upTo ?? undefined);
  return messages.reduce((total, message) => total + Math.ceil(textOf(message).length / 4), 0);
}

function textOf(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  return (Array.isArray(content) ? content : []).map((part) => part?.text ?? '').join('');
}

/** What the marked prefix costs, which is what this endpoint calls a hit. */
function cached(body) {
  return countPrompt(body, marked(body));
}

/** How many leading messages the request asked to have cached, if any. */
function marked(body) {
  const messages = body?.messages ?? [];
  let upTo = 0;
  messages.forEach((message, i) => {
    const parts = Array.isArray(message?.content) ? message.content : [];
    if (parts.some((part) => part?.cache_control)) upTo = i + 1;
  });
  return upTo;
}

/**
 * The 400 an endpoint that has never heard of `response_format` answers with.
 * True of one model id only, so the specs that want that path name it.
 */
function noSchema(response, body) {
  if ((body?.model ?? '') !== 'fake/no-json-schema' || !body?.response_format) return false;
  json(response, 400, {
    error: { message: "Unknown parameter: 'response_format'.", type: 'invalid_request_error' },
  });
  return true;
}

/**
 * One completion that is not a stream. The endpoint that could not take the
 * schema fences its object and puts a sentence in front of it, which is what
 * the fallback path has to read and what a real one of those does.
 */
function answer(response, body, object) {
  const model = body?.model ?? 'fake/storyteller-large';
  const content = model === 'fake/no-json-schema' ? '```json\n' + object + '\n```' : object;

  const promptTokens = countPrompt(body);
  const completionTokens = Math.ceil(content.length / 4);

  json(response, 200, {
    id: 'chatcmpl-fake-json',
    object: 'chat.completion',
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  });
}

/**
 * The lore extraction: one JSON object, and a chance to be an endpoint that
 * cannot do schemas.
 *
 * What it proposes is read out of the chapter it was sent, so a test plants a
 * town in the story and gets that town back rather than a fixture nobody can
 * trace: `Ashport` becomes a place, and an entry the world already holds comes
 * back as an update to it.
 */
function lore(response, body, prompt) {
  // Only this request fails, so a spec can watch a chapter close with the
  // summary written and the entries not.
  if (prompt.includes('!nolore')) {
    json(response, 500, { error: { message: 'The upstream model is on fire.' } });
    return;
  }
  if (noSchema(response, body)) return;

  const entries = [];
  if (prompt.includes('Ashport')) {
    entries.push({
      title: 'Ashport',
      category: 'place',
      keys: ['ashport', 'the town'],
      content: 'A town of nine hundred at the mouth of the estuary, an hour up the coast road.',
      updates: '',
    });
  }
  // Named in the list of what the world already holds, so it is an update.
  if (prompt.includes('Old Tomas')) {
    entries.push({
      title: 'Old Tomas',
      category: 'person',
      keys: ['tomas', 'keeper'],
      content: 'Kept the light before Mara’s father, and was last seen boarding the Ashport ferry.',
      updates: 'Old Tomas',
    });
  }

  answer(response, body, JSON.stringify({ entries }));
}

/** The passage this turn answers with, before it is cut into deltas. */
function pick(prompt) {
  if (prompt.includes('!loop')) return LOOPING;
  if (prompt.includes('!long')) return LONG.join('\n\n');
  if (prompt.includes('!prose')) return PROSE;
  return [...SCENE, `(take ${++turn})`].join('\n\n');
}

function send(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function lastUserMessage(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return textOf(messages[i]);
  }
  return '';
}

function readJson(request) {
  return new Promise((resolve) => {
    let raw = '';
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}

function json(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload));
}

function cors(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

server.listen(PORT, () => console.log(`fake OpenAI endpoint on http://localhost:${PORT}/v1`));
