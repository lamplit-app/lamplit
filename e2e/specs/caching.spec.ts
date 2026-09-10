import { expect, test } from './fixtures';
import { CHAPTER_ID, assistantMessages, captureRequests, send, waitForTurn } from './helpers';
import type { PersistenceServer } from './persistence-server';

/**
 * What two consecutive requests have in common, which is the only thing about
 * a request that no single one of them shows.
 *
 * Every provider worth naming keeps a prefix cache and charges a fraction for
 * the leading bytes of a prompt it has already read. The prompt is resent
 * whole because `/chat/completions` is stateless; whether it is *re-priced*
 * whole depends on whether the front of it stopped changing. `prompt-builder`
 * holds that invariant on its own; these are the same claims about what
 * actually left the browser.
 */

let clock = 0;

function said(role: 'user' | 'assistant', content: string) {
  const at = String(++clock).padStart(3, '0');
  return { id: `m${clock}`, role, content, createdAt: `2026-01-01T00:00:00.${at}Z` };
}

/** A chapter long enough that the budget cannot carry all of it. */
async function seedLongChapter(server: PersistenceServer): Promise<void> {
  const chapter = (await server.document('chapters', CHAPTER_ID))!;
  const messages = Array.from({ length: 83 }, (_, i) =>
    said(i % 2 ? 'assistant' : 'user', `Paragraph ${i}. ${'The tide turned again. '.repeat(5)}`),
  );
  await server.seed({ [`chapter:${CHAPTER_ID}`]: { ...chapter, messages } });
}

type Body = Record<string, any>;

/** The messages of a request, as JSON, for comparing one request to the next. */
function lines(body: Body): string[] {
  return ((body['messages'] ?? []) as unknown[]).map((m) => JSON.stringify(m));
}

test('a second turn over budget resends the first turn’s request, unchanged, plus what is new', async ({
  page,
  server,
  app,
}) => {
  await app.seed({ generation: { maxContextTokens: 2400, maxResponseTokens: 200 } });
  await seedLongChapter(server);
  const bodies = await captureRequests(page);
  await app.visit();

  await send(page, 'And then?');
  await waitForTurn(page);
  await send(page, 'And after that?');
  await waitForTurn(page);

  expect(bodies).toHaveLength(2);
  const [first, second] = bodies.map(lines);

  // The premise: this chapter really does not fit, so the window had to choose
  // where to open — and it chose the same place twice.
  expect(first.length).toBeLessThan(84);
  expect(second.length).toBeGreaterThan(first.length);
  expect(second.slice(0, first.length)).toEqual(first);
});

test('a keyed entry goes last, and the leading message does not move when it stops firing', async ({
  page,
  app,
}) => {
  await app.seed({
    entries: [
      {
        id: 'lore-tomas',
        title: 'Old Tomas',
        keys: ['ferry'],
        content: 'Kept the light before Mara’s father.',
      },
      {
        id: 'lore-tide',
        title: 'The tide',
        alwaysOn: true,
        keys: [],
        content: 'The bar is walkable two hours either side of low water.',
      },
    ],
  });
  const bodies = await captureRequests(page);
  await app.visit();

  await send(page, 'I ask about the ferry.');
  await waitForTurn(page);

  const fired = bodies[0]!['messages'] as { role: string; content: string }[];
  // The always-on entry is in the first message; the keyed one is not, and is
  // the last message of the request instead.
  expect(fired[0].content).toContain('two hours either side of low water');
  expect(fired[0].content).not.toContain('before Mara’s father');
  expect(fired[fired.length - 1]).toMatchObject({ role: 'system' });
  expect(fired[fired.length - 1].content).toContain('before Mara’s father');

  // Four more messages and the word is out of the scan window. The entry stops
  // firing — and byte 0 of the prompt is exactly what it was.
  for (const line of ['I wait.', 'I look out.', 'I say nothing.']) {
    await send(page, line);
    await waitForTurn(page);
  }

  const later = bodies[bodies.length - 1]!['messages'] as { role: string; content: string }[];
  expect(later[later.length - 1].content).not.toContain('before Mara’s father');
  expect(later[0]).toEqual(fired[0]);
});

test('a Claude model through an aggregator marks the prefix, and says what it saved', async ({
  page,
  app,
}) => {
  await app.seed({
    connection: { provider: 'nanogpt', model: 'fake/claude-storyteller' },
  });
  const bodies = await captureRequests(page);
  await app.visit();

  await send(page, 'I knock.');
  await waitForTurn(page);

  const sent = bodies[0]!['messages'] as { role: string; content: unknown }[];
  expect(sent[0]).toMatchObject({
    role: 'system',
    content: [{ type: 'text', cache_control: { type: 'ephemeral' } }],
  });
  // The new line is what the request is for, and is not marked.
  expect(sent[sent.length - 1].content).toBe('I knock.');

  // And the endpoint's answer to that is read back and written under the reply.
  await expect(assistantMessages(page).first()).toContainText('cached');
});

test('a model that caches without being asked is sent the plain strings it expects', async ({
  page,
  app,
}) => {
  await app.seed({ connection: { provider: 'nanogpt', model: 'fake/gpt-storyteller' } });
  const bodies = await captureRequests(page);
  await app.visit();

  await send(page, 'I knock.');
  await waitForTurn(page);

  for (const message of bodies[0]!['messages'] as { content: unknown }[]) {
    expect(typeof message.content).toBe('string');
  }
});

test('an endpoint that refuses the marks is sent the same turn without them', async ({
  page,
  app,
}) => {
  await app.seed({
    connection: { provider: 'nanogpt', model: 'fake/claude-no-cache-control' },
  });
  const bodies = await captureRequests(page);
  await app.visit();

  await send(page, 'I knock.');
  await waitForTurn(page);

  // Two requests, the second without a mark on it — and the reply arrived.
  expect(bodies).toHaveLength(2);
  expect(Array.isArray((bodies[0]!['messages'] as { content: unknown }[])[0]!.content)).toBe(true);
  for (const message of bodies[1]!['messages'] as { content: unknown }[]) {
    expect(typeof message.content).toBe('string');
  }
  await expect(assistantMessages(page)).toHaveCount(1);
});
