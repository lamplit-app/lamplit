import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSseData } from './sse';
import { ModelClient, buildBody, normaliseBaseUrl, parseChunk } from './model-client';
import {
  budgetThatFits,
  contextLimitOf,
  describeContextLimit,
  errorFromResponse,
} from './model-errors';
import { formatTokens, heuristicEstimator } from './tokens';
import { renderMarkdown, renderStoryHtml } from './formatting';
import { after } from './text';
import { GenerationParams } from './models';

/** A body split at awkward places, the way a real socket delivers it. */
function streamOf(...pieces: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const payload of readSseData(stream)) out.push(payload);
  return out;
}

describe('readSseData', () => {
  it('yields one payload per event', async () => {
    expect(await collect(streamOf('data: a\n\ndata: b\n\n'))).toEqual(['a', 'b']);
  });

  it('reassembles events split across chunks', async () => {
    expect(await collect(streamOf('data: hel', 'lo\n', '\ndata: world\n\n'))).toEqual([
      'hello',
      'world',
    ]);
  });

  it('handles CRLF framing and ignores comments and other fields', async () => {
    const events = await collect(
      streamOf(': keep-alive\r\n\r\nevent: ping\r\ndata: x\r\n\r\nid: 7\r\n\r\n'),
    );
    expect(events).toEqual(['x']);
  });

  it('joins multi-line data and delivers a final unterminated event', async () => {
    expect(await collect(streamOf('data: one\ndata: two\n\ndata: [DONE]'))).toEqual([
      'one\ntwo',
      '[DONE]',
    ]);
  });
});

describe('streamChat', () => {
  const request = {
    baseUrl: 'https://endpoint.invalid/v1',
    apiKey: '',
    model: 'm',
    messages: [{ role: 'user' as const, content: 'Say something.' }],
    params: { maxResponseTokens: 100, stop: [] } as unknown as GenerationParams,
  };

  /** The endpoint answering with this body, and this content type. */
  function answers(body: ReadableStream<Uint8Array> | string, type = 'text/event-stream'): void {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': type } })),
    );
  }

  const event = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
  const said = (content: string) => event({ choices: [{ delta: { content } }] });

  afterEach(() => vi.unstubAllGlobals());

  it('keeps what arrived when the provider errors half way through it', async () => {
    answers(
      streamOf(said('The lantern room, '), said('and then'), event({ error: { message: 'boom' } })),
    );
    const seen: string[] = [];

    const result = await new ModelClient().streamChat(request, (delta) => {
      if (delta.content) seen.push(delta.content);
    });

    // Resolved, not thrown: the reader watched these words arrive.
    expect(result.content).toBe('The lantern room, and then');
    expect(seen).toHaveLength(2);
    expect(result.interrupted?.message).toContain('boom');
    expect(result.aborted).toBe(false);
  });

  it('takes a whole completion from an endpoint that would not stream', async () => {
    answers(
      JSON.stringify({
        choices: [{ message: { content: 'The lantern room.' } }],
        usage: { completion_tokens: 4 },
      }),
      'application/json',
    );
    const seen: string[] = [];

    const result = await new ModelClient().streamChat(request, (delta) => {
      if (delta.content) seen.push(delta.content);
    });

    expect(result.content).toBe('The lantern room.');
    expect(seen).toEqual(['The lantern room.']);
    expect(result.usage?.completionTokens).toBe(4);
  });

  it('says so when a 200 carries no events at all', async () => {
    answers(streamOf(''));
    await expect(
      new ModelClient().streamChat(request, () => {
        /* nothing to watch: this one is about how it ends */
      }),
    ).rejects.toThrow(/without sending anything/);
  });

  it('throws when it fails with nothing to show for it', async () => {
    answers(streamOf(event({ error: { message: 'boom' } })));
    await expect(
      new ModelClient().streamChat(request, () => {
        /* nothing to watch: this one is about how it ends */
      }),
    ).rejects.toThrow(/boom/);
  });

  it('says the connection dropped, rather than doubting a URL that was working', async () => {
    // Pulled rather than queued: `error()` throws away whatever is still in the
    // queue, and the point here is a connection that goes after the words came.
    let pulls = 0;
    answers(
      new ReadableStream({
        pull(controller) {
          if (pulls++ === 0) controller.enqueue(new TextEncoder().encode(said('Half a ')));
          else controller.error(new TypeError('network error'));
        },
      }),
    );

    const result = await new ModelClient().streamChat(request, () => {
      /* nothing to watch: this one is about how it ends */
    });

    expect(result.content).toBe('Half a ');
    expect(result.interrupted?.message).toBe('The connection dropped part-way through the reply.');
  });
});

describe('parseChunk', () => {
  it('reads content, finish reason and usage', () => {
    expect(
      parseChunk('{"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}'),
    ).toMatchObject({ content: 'Hi' });
    expect(parseChunk('{"choices":[{"delta":{},"finish_reason":"length"}]}')).toMatchObject({
      finishReason: 'length',
    });
    expect(
      parseChunk('{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":4}}'),
    ).toMatchObject({ usage: { promptTokens: 10, completionTokens: 4 } });
  });

  it('reads reasoning under either of the two field names', () => {
    expect(parseChunk('{"choices":[{"delta":{"reasoning_content":"hm"}}]}')).toMatchObject({
      reasoning: 'hm',
    });
    expect(parseChunk('{"choices":[{"delta":{"reasoning":"hm"}}]}')).toMatchObject({
      reasoning: 'hm',
    });
  });

  it('surfaces a mid-stream error and shrugs off noise', () => {
    expect(parseChunk('{"error":{"message":"boom"}}')).toMatchObject({ error: 'boom' });
    expect(parseChunk('not json')).toBeNull();
    expect(parseChunk('"a string"')).toBeNull();
  });
});

describe('buildBody', () => {
  const base = {
    baseUrl: 'https://x/v1',
    apiKey: '',
    model: 'm',
    messages: [{ role: 'user' as const, content: 'hi' }],
  };
  const params: GenerationParams = {
    maxContextTokens: 8192,
    maxResponseTokens: 500,
    temperature: 0.8,
    topP: 1,
    frequencyPenalty: 0,
    presencePenalty: 0,
    stop: [],
  };

  it('sends the OpenAI set and omits everything unset', () => {
    const body = buildBody({ ...base, params });
    expect(body).toMatchObject({
      model: 'm',
      stream: true,
      max_tokens: 500,
      temperature: 0.8,
      top_p: 1,
    });
    expect(body).not.toHaveProperty('top_k');
    expect(body).not.toHaveProperty('seed');
    expect(body).not.toHaveProperty('stop');
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('sends the advanced parameters once they are set', () => {
    const body = buildBody({
      ...base,
      params: {
        ...params,
        topK: 40,
        minP: 0.05,
        repetitionPenalty: 1.1,
        topA: 0.2,
        seed: 7,
        stop: ['THE END'],
        reasoningEffort: 'high',
      },
    });
    expect(body).toMatchObject({
      top_k: 40,
      min_p: 0.05,
      repetition_penalty: 1.1,
      top_a: 0.2,
      seed: 7,
      stop: ['THE END'],
      reasoning_effort: 'high',
    });
  });

  it('treats "none" reasoning as not set, and can drop stream_options', () => {
    expect(
      buildBody({ ...base, params: { ...params, reasoningEffort: 'none' } }),
    ).not.toHaveProperty('reasoning_effort');
    expect(buildBody({ ...base, params }, false)).not.toHaveProperty('stream_options');
  });
});

describe('normaliseBaseUrl', () => {
  it('tolerates trailing slashes and a pasted completions path', () => {
    expect(normaliseBaseUrl('  https://h/v1/  ')).toBe('https://h/v1');
    expect(normaliseBaseUrl('https://h/v1/chat/completions')).toBe('https://h/v1');
  });
});

describe('errorFromResponse', () => {
  it('classifies the statuses that matter and quotes the provider', () => {
    const auth = errorFromResponse(401, '{"error":{"message":"Incorrect API key"}}');
    expect(auth.kind).toBe('auth');
    expect(auth.message).toContain('Incorrect API key');

    expect(errorFromResponse(402, '').kind).toBe('credit');
    expect(errorFromResponse(404, '').kind).toBe('not-found');
    expect(errorFromResponse(429, '').kind).toBe('rate-limit');
    expect(errorFromResponse(503, '').kind).toBe('server');
  });
});

describe('a refusal for length', () => {
  const refusal = (detail: string) => errorFromResponse(400, JSON.stringify({ error: detail }));

  it('reads the numbers out of the wordings the providers use', () => {
    expect(
      contextLimitOf(
        refusal(
          "This model's maximum context length is 8192 tokens, however you requested 19004 tokens (18004 in the messages, 1000 in the completion). Please reduce the length of the messages or completion.",
        ),
      ),
    ).toEqual({ window: 8192, requested: 19004 });

    expect(contextLimitOf(refusal('prompt is too long: 210000 tokens > 200000 maximum'))).toEqual({
      window: 200000,
      requested: 210000,
    });

    expect(
      contextLimitOf(
        refusal(
          'Input validation error: `inputs` tokens + `max_new_tokens` must be <= 8193. Given: 9000 `inputs` tokens and 1000 `max_new_tokens`',
        ),
      ),
    ).toEqual({ window: 8193, requested: 9000 });
  });

  it('still recognises one that does not count out loud', () => {
    // Known to be about length, so the reader is told what it is about; no
    // window named, so nothing is offered that would be a guess.
    expect(contextLimitOf(refusal('Too many tokens in prompt.'))).toEqual({
      window: undefined,
      requested: undefined,
    });
  });

  it('is not every 400, and not every failure', () => {
    expect(contextLimitOf(refusal('Invalid value for `temperature`: must be <= 2'))).toBeNull();
    expect(contextLimitOf(refusal('unknown model'))).toBeNull();
    expect(contextLimitOf(errorFromResponse(401, ''))).toBeNull();
    expect(contextLimitOf(errorFromResponse(429, 'too many tokens'))).toBeNull();
  });

  it('says what the endpoint said, in the reader’s terms, and keeps its words', () => {
    const said =
      "This model's maximum context length is 8192 tokens, however you requested 19004 tokens";
    const message = describeContextLimit(contextLimitOf(refusal(said))!, 16384, said);
    expect(message).toContain('this model takes 8192 tokens');
    expect(message).toContain('the turn came to 19004');
    expect(message).toContain('your context budget is set to 16384');
    expect(message).toContain(said);
  });

  it('offers a budget that fits under the window, rounded to a number someone would pick', () => {
    expect(budgetThatFits(8192)).toBe(7680);
    expect(budgetThatFits(32768)).toBe(30976);
    // Never below what the setting will take, nor above it.
    expect(budgetThatFits(512)).toBe(1024);
    expect(budgetThatFits(1_000_000)).toBe(200000);
  });
});

/**
 * A paragraph of each script, with the fewest characters a token was measured
 * to buy across cl100k and o200k — the dearest either of them charges, which
 * is the number the estimate has to be able to pay.
 *
 * Fewer characters to the token means more tokens counted, so the estimate is
 * safe when it is at or *under* the figure in the middle column and wasteful
 * when it is far under: half again is the most that is worth trimming for.
 */
const PARAGRAPHS: readonly [script: string, dearest: number, text: string][] = [
  [
    'English',
    4.46,
    'The lamp on the harbour wall had been out for three nights running, and nobody in the village would say why. Mira walked the sea road at dusk with her coat buttoned to the throat, counting the boats that had not come back.',
  ],
  [
    'markdown',
    3.89,
    '## The Lighthouse\n\n**Mira** stood at the door. *Nothing* answered.\n\n- the lamp was cold\n- the stair was wet\n- the log book stopped on the ninth\n\n> "You should not have come," said the keeper, and shut the book.',
  ],
  [
    'French',
    3.6,
    "La lampe du phare était éteinte depuis trois nuits, et personne au village ne voulait dire pourquoi. Mira longeait la route côtière au crépuscule, le col relevé, comptant les barques qui n'étaient pas rentrées.",
  ],
  [
    'German',
    3.6,
    'Die Lampe auf der Hafenmauer war seit drei Nächten erloschen, und niemand im Dorf wollte sagen, warum. Mira ging in der Dämmerung die Küstenstraße entlang und zählte die Boote, die nicht zurückgekommen waren.',
  ],
  [
    'Russian',
    1.91,
    'Фонарь на молу не горел уже третью ночь, и никто в деревне не хотел говорить почему. Мира шла по приморской дороге в сумерках, застегнув пальто до горла, и считала лодки, которые не вернулись.',
  ],
  [
    'Greek',
    1.12,
    'Ο φάρος στον μόλο ήταν σβηστός τρεις νύχτες στη σειρά, και κανείς στο χωριό δεν ήθελε να πει γιατί. Η Μίρα περπατούσε τον παραλιακό δρόμο το σούρουπο, με το παλτό κουμπωμένο ως τον λαιμό.',
  ],
  [
    'Arabic',
    1.44,
    'كان المصباح على حائط الميناء مطفأً منذ ثلاث ليالٍ متتالية، ولم يرد أحد في القرية أن يقول لماذا. سارت ميرا على طريق البحر عند الغسق وقد أزرَّت معطفها حتى حلقها، تعد القوارب التي لم تعد.',
  ],
  [
    'Hindi',
    1.04,
    'बंदरगाह की दीवार पर लगा दीपक लगातार तीन रातों से बुझा हुआ था, और गाँव में कोई नहीं बताना चाहता था कि क्यों। मीरा शाम के धुँधलके में समुद्र की सड़क पर चली, कोट गले तक बंद किए हुए।',
  ],
  [
    'Chinese',
    0.83,
    '港口墙上的灯已经连续三个晚上没有亮了，村里没有人愿意说出原因。黄昏时分，米拉沿着海边的路走着，外套一直扣到喉咙，数着那些还没有回来的船。',
  ],
  [
    'Japanese',
    0.86,
    '港の防波堤の灯りは三晩続けて消えたままで、村の誰もその理由を語ろうとしなかった。夕暮れのなか、ミラは外套を喉元まで留めて海沿いの道を歩き、帰ってこない舟の数を数えていた。',
  ],
  [
    'Korean',
    0.97,
    '항구 벽의 등불은 사흘 밤 내내 꺼져 있었고, 마을의 누구도 그 이유를 말하려 하지 않았다. 미라는 해질 무렵 외투를 목까지 여미고 바닷가 길을 걸으며 돌아오지 않은 배를 세었다.',
  ],
  [
    'emoji',
    1.91,
    'she wrote back 🌊🚨 and then 👩‍🚒👨‍👩‍👧 turned up at the door 🏮🏮 with ❤️ and a note that said 🔦🕯️🚤 — nobody laughed 😐',
  ],
  [
    'digits',
    1.8,
    'Log 2026-09-05 14:32:07 — entries 118293, 118294, 118295 closed at 1,204,338 units; ids 8f3a91c2, 4471, 90210, 33128, 60622 and 1998-03-14 07:45.',
  ],
];

const charsPerToken = (text: string) => text.length / heuristicEstimator.count(text);

describe('token estimates', () => {
  it('counts per message plus its role overhead', () => {
    expect(heuristicEstimator.count('')).toBe(0);
    expect(heuristicEstimator.countMessages([{ role: 'user', content: '' }])).toBe(4);
    expect(heuristicEstimator.countMessages([{ role: 'user', content: 'a'.repeat(36) }])).toBe(14);
  });

  it('charges at least what the dearest tokenizer does, whatever the script', () => {
    for (const [script, dearest, text] of PARAGRAPHS) {
      expect(charsPerToken(text), script).toBeLessThanOrEqual(dearest);
    }
  });

  it('does not throw away context by charging far more than it has to', () => {
    for (const [script, dearest, text] of PARAGRAPHS) {
      expect(charsPerToken(text), script).toBeGreaterThan(dearest / 1.6);
    }
  });

  it('counts a code point once, however many UTF-16 units it takes', () => {
    // An ideograph from a later plane and an emoji are one character each, not
    // two, and are charged as the one thing they are.
    expect(heuristicEstimator.count('𠀋')).toBe(2);
    expect(heuristicEstimator.count('🌊')).toBe(3);
    // A lone surrogate is nobody's character: charged the once, as the odd
    // thing it is, without reading past the end of the string looking for it.
    expect(heuristicEstimator.count('\ud83c')).toBe(2);
  });

  it('formats for the pill', () => {
    expect(formatTokens(812)).toBe('812');
    expect(formatTokens(3200)).toBe('3.2k');
    expect(formatTokens(16384)).toBe('16k');
  });

  it('rounds before it chooses the shape, so there is no 10.0k or 1000k', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(9999)).toBe('10k');
    expect(formatTokens(999_999)).toBe('1.0M');
    expect(formatTokens(2_000_000)).toBe('2.0M');
  });
});

describe('renderStoryHtml', () => {
  const plain = { bookStyleDialogue: false };
  const book = { bookStyleDialogue: true };

  it('marks speech and actions', () => {
    const html = renderStoryHtml('He nodded. "Come in," he said. *The door closed.*', plain);
    expect(html).toContain('<span class="speech">"Come in,"</span>');
    expect(html).toContain('class="action"');
  });

  it('recognises curly quotes', () => {
    expect(renderStoryHtml('“Who goes there?”', plain)).toContain('class="speech"');
  });

  it('gives each spoken line its own paragraph in book style', () => {
    const html = renderStoryHtml('He grinned. "Hello." "And you?"', book);
    expect(html.match(/<p>/g)).toHaveLength(3);
    expect(html).toMatch(/<p><span class="speech">"Hello."<\/span><\/p>/);
  });

  it('leaves the paragraph alone when it opens with speech', () => {
    expect(renderStoryHtml('"Just one line," she said.', book).match(/<p>/g)).toHaveLength(1);
  });

  it('does not leave a dangling <br> where it split a line break', () => {
    // A single newline becomes <br>; splitting there must not keep it.
    const html = renderStoryHtml('He nodded.\n"Come in," he said.', book);
    expect(html.match(/<p>/g)).toHaveLength(2);
    expect(html).toContain('<p>He nodded.</p>');
    expect(html).not.toContain('<br>');
  });

  it('keeps line breaks inside a line it did not split', () => {
    expect(renderStoryHtml('One line.\nAnother line.', book)).toContain('<br>');
  });

  it('never reformats code, and strips anything not on the allowlist', () => {
    const html = renderStoryHtml('```\nconst a = "x";\n```', book);
    expect(html).not.toContain('class="speech"');
    const unsafe = renderStoryHtml('<img src=x onerror=alert(1)>text', plain);
    expect(unsafe).not.toContain('onerror');
    expect(unsafe).not.toContain('<img');
  });

  it('sends a link in an answer to a new tab, so the story stays on screen', () => {
    // Following a link in place would navigate the app off the page, taking a
    // turn still streaming and the composer's draft with it.
    const html = renderStoryHtml('Read [the notice](https://example.com/notice).', plain);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  it('does not let raw HTML in a message borrow the classes the app styles', () => {
    const html = renderStoryHtml('<span class="speech">not speech</span> he said.', plain);
    expect(html).not.toContain('class="speech">not speech');
    expect(html).toContain('not speech');
  });

  it('keeps the classes the highlighter put inside a code block', () => {
    const html = renderStoryHtml(['```json', '{"a": 1}', '```'].join('\n'), plain);
    expect(html).toContain('class="hljs language-json"');
    expect(html).toContain('class="hljs-');
  });

  it('renders nothing for nothing', () => {
    expect(renderStoryHtml('', plain)).toBe('');
  });

  it('shows prose it cannot parse as prose, rather than throwing into the view', () => {
    // A thousand levels of nesting is a RangeError out of marked's recursion,
    // and this is read during change detection: a throw here is a blank page.
    const runaway = `${'> - '.repeat(2000)}the lantern room`;
    let html = '';
    expect(() => (html = renderStoryHtml(runaway, plain))).not.toThrow();
    expect(html).toContain('the lantern room');
    expect(renderMarkdown(runaway)).toContain('the lantern room');
  });
});

/**
 * A message is parsed and set a block at a time, and every block but the last
 * is remembered, so that a streaming answer costs the words that just arrived
 * rather than the whole of what has arrived so far.
 *
 * Two halves: that cutting a message into blocks does not change what the
 * message says, and that the cutting is what makes the worst message a model
 * can write affordable at all.
 */
describe('the last mark that fits', () => {
  it('lands past the whole mark, not past its first character', () => {
    // Both cutters ask this, and one of them cuts at ', '. Past the comma
    // alone leaves the next piece starting with the space.
    expect(after('one, two, three', ', ')).toBe(10);
    expect('one, two, three'.slice(10)).toBe('three');
  });

  it('is 0 when the mark is not there, so the caller can fall through', () => {
    expect(after('one two three', ', ')).toBe(0);
  });

  it('counts a single-character mark the same way', () => {
    expect(after('one two three', ' ')).toBe(8);
  });
});

describe('renderStoryHtml, block by block', () => {
  const plain = { bookStyleDialogue: false };
  const book = { bookStyleDialogue: true };

  /** What marked is slowest on, and what a model repeating itself writes. */
  const looping = (length: number, separator: string, salt: string) =>
    `${salt}\n\n${`**a **b**${separator}`.repeat(Math.ceil(length / 10)).slice(0, length)}`;

  it('keeps a paragraph too long to parse at once as one paragraph', () => {
    // Cut into pieces and put back together: one <p>, the line endings still
    // the <br>s `breaks: true` makes of them, the words still in order.
    const line = 'She crossed the lantern room and said nothing at all about it.';
    const html = renderStoryHtml(Array.from({ length: 60 }, () => line).join('\n'), plain);
    expect(html.match(/<p>/g)).toHaveLength(1);
    expect(html.match(/<br>/g)).toHaveLength(59);
    expect(html.match(/lantern room/g)).toHaveLength(60);
  });

  it('does not restart a list whose items are set apart by blank lines', () => {
    // A blank line between two items is inside one list, not between two of
    // them, and cutting there would start the second list at 1 again.
    const html = renderStoryHtml('1. first\n\n2. second\n\n3. third', plain);
    expect(html.match(/<ol/g)).toHaveLength(1);
    expect(html).toContain('third');
  });

  it('keeps a quotation of two paragraphs as one quotation', () => {
    const html = renderStoryHtml('> the first part\n>\n> and the second', plain);
    expect(html.match(/<blockquote>/g)).toHaveLength(1);
    expect(html).toContain('and the second');
  });

  it('keeps a blank line inside a fenced block inside the block', () => {
    const html = renderStoryHtml('```\nconst a = 1;\n\nconst b = 2;\n```', plain);
    expect(html.match(/<pre>/g)).toHaveLength(1);
    // Both statements and the empty line between them, inside the one block.
    expect(html).toContain('a = ');
    expect(html).toContain('b = ');
  });

  it('still resolves a link written as a reference somewhere else', () => {
    // The definition and the use are read by one parse, or by neither.
    const html = renderStoryHtml('Read [the notice][n].\n\n[n]: https://example.com/n', plain);
    expect(html).toContain('href="https://example.com/n"');
    expect(html).not.toContain('[n]');
  });

  it('marks speech and actions in every block, not only the first', () => {
    const html = renderStoryHtml('*He turned.*\n\n"After you," she said.\n\n*She went.*', plain);
    expect(html.match(/class="action"/g)).toHaveLength(2);
    expect(html).toContain('<span class="speech">"After you,"</span>');
  });

  it('gives the same answer whether it is asked once or twice', () => {
    // The second render is mostly cache; it must not be a different message.
    const source = 'He grinned. "Hello." "And you?"\n\n*She went.*\n\n```\nfour()\n```';
    expect(renderStoryHtml(source, book)).toBe(renderStoryHtml(source, book));
    // The setting is part of what was remembered, not something it forgot.
    expect(renderStoryHtml(source, book).match(/<p>/g)).toHaveLength(4);
    expect(renderStoryHtml(source, plain).match(/<p>/g)).toHaveLength(2);
  });

  /**
   * Budgets, not stopwatches. One parse of thirty thousand characters of
   * unbalanced emphasis was about four and a half seconds on the machine this
   * was written on, and it happened again on every animation frame of a
   * streaming answer. The numbers below are three times what that machine now
   * takes, so a slower one still passes and only losing the blocks fails.
   */
  it('renders the worst message a model can write inside a budget', () => {
    // One paragraph with no line ending anywhere in it to cut at: the shape
    // that costs the most, rendered cold, with none of it remembered.
    const worst = looping(30_000, ' ', 'the worst of it');
    const started = performance.now();
    const html = renderStoryHtml(worst, plain);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(html).toContain('<strong>');
  });

  it('streams one without reading again everything that already arrived', () => {
    // Sixty frames of the same answer growing, the way a turn arrives.
    const answer = looping(30_000, '\n\n', 'streamed');
    const started = performance.now();
    for (let frame = 1; frame <= 60; frame++) {
      renderStoryHtml(answer.slice(0, (answer.length * frame) / 60), plain);
    }
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe('renderMarkdown', () => {
  it('leaves a wrapped line as one paragraph, unlike story prose', () => {
    // Release notes come out of a changelog a formatter has hard-wrapped, so a
    // newline in the middle of a sentence is the formatter's, not the writer's.
    const wrapped = 'A line about what changed,\nwrapped the way a changelog wraps it.';
    expect(renderMarkdown(wrapped)).not.toContain('<br>');
    expect(renderStoryHtml(wrapped, { bookStyleDialogue: false })).toContain('<br>');
  });

  it('does none of the book-setting: no speech spans, no action classes', () => {
    const html = renderMarkdown('*Ready?* he said, and then "Now."');
    expect(html).not.toContain('class="speech"');
    expect(html).not.toContain('class="action"');
    expect(html).toContain('<em>Ready?</em>');
  });

  it('sanitises what it is given, the same as everything else does', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>**bold**');
    expect(html).not.toContain('onerror');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('sends release-note links to a new tab too', () => {
    const html = renderMarkdown('See [the release](https://example.com/release).');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  it('renders nothing for nothing', () => {
    expect(renderMarkdown('')).toBe('');
  });
});
