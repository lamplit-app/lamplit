import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GENERATION,
  DEFAULT_NARRATOR_PROMPT,
  DEFAULT_ROLEPLAY_PROMPT,
  DEFAULT_SUMMARY_INSTRUCTION,
} from './defaults';
import { BlockId, Chapter, ChapterMessage, LoreEntry, Story } from './models';
import {
  buildPrompt,
  buildSummaryPrompt,
  chapterHeading,
  chapterName,
  chapterTitle,
  firstLine,
  isDefaultInstruction,
  isDefaultOrder,
  movableOrder,
  movableOrderFrom,
  narratorInstruction,
  overriding,
  roleplayInstruction,
  sceneBlock,
  summaryInstruction,
  writtenIn,
} from './prompt-builder';
import { heuristicEstimator } from './tokens';
import { newChapter, newStory } from './fixtures';

function story(patch: Partial<Story> = {}): Story {
  return { ...newStory('The Lighthouse'), ...patch };
}

function chapter(patch: Partial<Chapter> = {}): Chapter {
  return { ...newChapter('story', 1, 'The keeper’s cottage, late afternoon, low tide.'), ...patch };
}

function said(role: 'user' | 'assistant', content: string): ChapterMessage {
  return { id: `${role}-${content.length}-${Math.random()}`, role, content, createdAt: '' };
}

function lore(patch: Partial<LoreEntry> = {}): LoreEntry {
  return {
    id: `lore-${patch.title ?? 'x'}`,
    title: 'Old Tomas',
    category: 'person',
    keys: ['tomas', 'keeper'],
    content: 'The lighthouse keeper, missing since spring.',
    enabled: true,
    alwaysOn: false,
    ...patch,
  };
}

function build(input: { story?: Story; chapter?: Chapter; draft?: string }) {
  return buildPrompt({
    story: input.story ?? story(),
    chapter: input.chapter ?? chapter(),
    draft: input.draft,
    params: DEFAULT_GENERATION,
    estimator: heuristicEstimator,
  });
}

describe('buildPrompt: the system message', () => {
  it('puts the blocks in order and ends with the scene and the style rules', () => {
    const built = build({});
    expect(built.blocks.map((b) => b.id)).toEqual(['mode', 'scene', 'style']);
    expect(built.messages[0].role).toBe('system');
    expect(built.messages[0].content).toContain(DEFAULT_NARRATOR_PROMPT);
  });

  it('injects the scene verbatim, under its chapter heading', () => {
    const scene = 'The lantern room, an hour later.\n\nThe lamp is out and the door is open.';
    const built = build({ chapter: chapter({ number: 3, title: 'Aloft', scene }) });
    const block = built.blocks.find((b) => b.id === 'scene');
    expect(block?.content).toBe(`Chapter 3, Aloft. The scene:\n${scene}`);
    expect(built.messages[0].content).toContain(scene);
  });

  it('leaves the scene block out while the scene is empty', () => {
    const built = build({ chapter: chapter({ scene: '   ' }) });
    expect(built.blocks.some((b) => b.id === 'scene')).toBe(false);
  });

  it('carries the persona and the story so far when they are set', () => {
    const base = story();
    const built = build({
      story: {
        ...base,
        persona: { name: 'Mara', description: 'a marine biologist' },
        world: { ...base.world, storySoFar: 'Mara has just arrived on the island.' },
      },
    });
    expect(built.blocks.map((b) => b.id)).toEqual([
      'mode',
      'persona',
      'story-so-far',
      'scene',
      'style',
    ]);
    expect(built.messages[0].content).toContain('The user plays Mara: a marine biologist');
    expect(built.messages[0].content).toContain('Mara has just arrived on the island.');
  });

  it('switches the preamble with the mode, and names the cast', () => {
    const base = story();
    const built = build({
      story: {
        ...base,
        mode: 'roleplay',
        persona: { name: 'Mara', description: '' },
        characters: [
          {
            id: 'a',
            name: 'Tomas',
            description: 'The keeper, seventy, deaf on one side.',
            enabled: true,
          },
          { id: 'b', name: 'Ghost', description: 'Not in this chapter.', enabled: false },
        ],
      },
    });
    const system = built.messages[0].content;
    // The instruction first, then who it is playing, with a blank line between.
    expect(system.startsWith(DEFAULT_ROLEPLAY_PROMPT)).toBe(true);
    expect(system).toContain(DEFAULT_ROLEPLAY_PROMPT + '\n\nYou are playing Tomas.');
    expect(system).toContain('deaf on one side');
    expect(system).not.toContain('Ghost');
    expect(system).toContain('never write words, thoughts or actions for Mara');
    expect(system).not.toContain(DEFAULT_NARRATOR_PROMPT);
  });

  it('uses the writer’s own narrator instructions once overridden', () => {
    const built = build({
      story: story({ narrator: { useDefault: false, prompt: 'Write it as a police report.' } }),
    });
    expect(built.messages[0].content).toContain('Write it as a police report.');
    expect(built.messages[0].content).not.toContain(DEFAULT_NARRATOR_PROMPT);
  });
});

describe('buildPrompt: the order of the blocks', () => {
  /** Every block filled, so that all six of them are in the system message. */
  function full(promptOrder?: BlockId[]): Story {
    const base = story();
    return {
      ...base,
      persona: { name: 'Mara', description: 'a marine biologist' },
      world: {
        ...base.world,
        storySoFar: 'Mara has just arrived on the island.',
        entries: [lore({ alwaysOn: true })],
      },
      ...(promptOrder ? { promptOrder } : {}),
    };
  }

  const ids = (s: Story) => build({ story: s }).blocks.map((b) => b.id);

  /**
   * The shipped order without the author's block, which is the one block whose
   * presence a chapter decides rather than a story: nothing here carries a
   * direction, so it is not in any of these. The directions spec holds that
   * end.
   *
   * Written out rather than assembled from the three constants in
   * `prompt-builder.ts`, so that this says what the order *is* instead of
   * agreeing with however the file happens to compose it.
   */
  const SHIPPED: BlockId[] = ['mode', 'persona', 'story-so-far', 'lore', 'scene', 'style'];

  it('ships in the order the app was built with', () => {
    expect(ids(full())).toEqual(SHIPPED);
    expect(isDefaultOrder(full())).toBe(true);
  });

  it('follows a stored order, and the system message follows the blocks', () => {
    const reordered = full(['scene', 'story-so-far', 'persona', 'lore']);
    expect(ids(reordered)).toEqual(['mode', 'scene', 'story-so-far', 'persona', 'lore', 'style']);
    expect(isDefaultOrder(reordered)).toBe(false);

    // Not just the report: the text sent is assembled in the same order.
    const system = build({ story: reordered }).messages[0].content;
    expect(system.indexOf('The scene:')).toBeLessThan(system.indexOf('The story so far:'));
    expect(system.indexOf('The story so far:')).toBeLessThan(system.indexOf('The user plays'));
  });

  it('keeps the pinned ends where they are, whatever a document says', () => {
    // A list naming a pinned block is a list this build cannot honour, so it
    // is not honoured at all — and the ends could not have moved anyway.
    const meddling = full(['style', 'scene', 'persona', 'mode'] as BlockId[]);
    expect(ids(meddling)).toEqual(SHIPPED);
    expect(ids(meddling)[0]).toBe('mode');
    expect(ids(meddling).at(-1)).toBe('style');
  });

  it('falls back to the default when the stored order and this build disagree', () => {
    // Short, and naming something from nowhere: the acceptance case.
    expect(movableOrder({ promptOrder: ['lore', 'bogus'] as BlockId[] })).toEqual([
      'persona',
      'story-so-far',
      'lore',
      'scene',
    ]);
    // A duplicate, which would silently drop a block.
    expect(movableOrder({ promptOrder: ['lore', 'lore', 'persona', 'scene'] })).toEqual([
      'persona',
      'story-so-far',
      'lore',
      'scene',
    ]);
    // The full set plus one a later version might add.
    expect(
      movableOrder({
        promptOrder: ['persona', 'story-so-far', 'lore', 'scene', 'author'] as BlockId[],
      }),
    ).toEqual(['persona', 'story-so-far', 'lore', 'scene']);
    // Absent, which is every story written before this version.
    expect(movableOrder({})).toEqual(['persona', 'story-so-far', 'lore', 'scene']);
    expect(isDefaultOrder({})).toBe(true);
  });

  /**
   * What the preview's rows mean for the document, which is the other side of
   * the rule above: only the blocks with something in them are drawn, so the
   * ones that were dragged go back into the slots they occupied and the
   * invisible ones stay where they are. It lived in the sheet that drags them,
   * where no spec could reach it.
   */
  it('writes the shown blocks back into their own slots', () => {
    const order: BlockId[] = ['persona', 'story-so-far', 'lore', 'scene'];
    // Persona is empty and not on screen; the other three, dragged.
    expect(movableOrderFrom({ promptOrder: order }, ['scene', 'lore', 'story-so-far'])).toEqual([
      'persona',
      'scene',
      'lore',
      'story-so-far',
    ]);
    // Nothing dragged is nothing changed, whatever is on screen.
    expect(movableOrderFrom({ promptOrder: order }, ['story-so-far', 'lore', 'scene'])).toEqual(
      order,
    );
    // A story with no order of its own gets one, from the shipped order.
    expect(movableOrderFrom({}, ['scene', 'persona', 'story-so-far', 'lore'])).toEqual([
      'scene',
      'persona',
      'story-so-far',
      'lore',
    ]);
  });

  it('leaves an empty block out without disturbing the order around it', () => {
    // Persona is unset here, so it is not drawn and not sent — but it is still
    // named in the story's order, and the blocks either side of it hold.
    const base = story();
    const sparse: Story = {
      ...base,
      world: { ...base.world, storySoFar: 'Mara has just arrived.' },
      promptOrder: ['scene', 'persona', 'story-so-far', 'lore'],
    };
    expect(ids(sparse)).toEqual(['mode', 'scene', 'story-so-far', 'style']);
  });
});

describe('buildPrompt: lore', () => {
  const withEntries = (entries: LoreEntry[], depth?: number) => {
    const base = story();
    const scan = depth === undefined ? base.world.scan : { ...base.world.scan, depth };
    return { ...base, world: { ...base.world, entries, scan } };
  };

  it('fires on a key found in the scene, before anything has been written', () => {
    const built = build({ story: withEntries([lore()]) });
    expect(built.lore).toHaveLength(1);
    expect(built.lore[0]).toMatchObject({ key: 'keeper', where: 'scene' });
    // Keyed, so it is the block after the line rather than part of the first
    // message — see the prefix cases below.
    expect(built.afterTheLine?.content).toContain('missing since spring');
  });

  it('keeps a keyed entry out of the leading message and an always-on one in', () => {
    const built = build({
      story: withEntries([
        lore({ title: 'Old Tomas' }),
        lore({
          id: 'lore-tide',
          title: 'The tide',
          content: 'The bar is walkable for two hours either side of low water.',
          keys: ['nothing-matches'],
          alwaysOn: true,
        }),
      ]),
      draft: 'I knock.',
    });

    const leading = built.messages[0];
    expect(leading.role).toBe('system');
    expect(leading.content).toContain('two hours either side of low water');
    expect(leading.content).not.toContain('missing since spring');

    // Last of all, after the new line: a block that comes and goes must not
    // sit in front of everything that does not.
    const last = built.messages[built.messages.length - 1];
    expect(last.role).toBe('system');
    expect(last.content).toContain('missing since spring');
    expect(built.messages[built.messages.length - 2]).toEqual({
      role: 'user',
      content: 'I knock.',
    });
  });

  it('leaves the leading message alone when a keyword falls out of the window', () => {
    const entries = [lore({ keys: ['ferry'] })];
    const heard = build({
      story: withEntries(entries, 1),
      chapter: chapter({ messages: [said('user', 'I ask about the ferry.')] }),
    });
    const forgotten = build({
      story: withEntries(entries, 1),
      chapter: chapter({
        messages: [said('user', 'I ask about the ferry.'), said('assistant', 'She shrugs.')],
      }),
    });

    expect(heard.afterTheLine?.content).toContain('missing since spring');
    expect(forgotten.afterTheLine).toBeUndefined();
    // Which is the whole point: byte 0 of the prompt did not move.
    expect(forgotten.messages[0]).toEqual(heard.messages[0]);
  });

  it('leaves an entry out when nothing mentions it', () => {
    const built = build({
      story: withEntries([lore({ title: 'The Lantern Room', keys: ['lantern', 'lamp room'] })]),
    });
    expect(built.lore).toHaveLength(0);
  });

  it('fires on the draft, and on the last messages within the scan depth', () => {
    const entries = [lore({ title: 'The Lantern Room', keys: ['lantern'] })];
    const draft = build({ story: withEntries(entries), draft: 'I climb to the lantern.' });
    expect(draft.lore[0]).toMatchObject({ where: 'draft', key: 'lantern' });

    const recent = build({
      story: withEntries(entries),
      chapter: chapter({ messages: [said('assistant', 'The lantern turned.')] }),
    });
    expect(recent.lore[0]?.where).toBe('message');

    const old = build({
      story: withEntries(entries, 1),
      chapter: chapter({
        messages: [said('assistant', 'The lantern turned.'), said('user', 'I go back down.')],
      }),
    });
    expect(old.lore).toHaveLength(0);
  });

  it('never fires an entry with nothing written in it', () => {
    // "What is true" is required in the World modal for exactly this reason:
    // an entry is the sentence it contributes, and this one has none.
    expect(build({ story: withEntries([lore({ content: '   ' })]) }).lore).toHaveLength(0);
    expect(
      build({ story: withEntries([lore({ content: '', alwaysOn: true })]) }).lore,
    ).toHaveLength(0);
  });

  it('honours always-on, disabled, whole words and case sensitivity', () => {
    const always = build({
      story: withEntries([lore({ keys: ['nothing-matches'], alwaysOn: true })]),
    });
    expect(always.lore[0]).toMatchObject({ where: 'always on', key: '' });

    const off = build({ story: withEntries([lore({ enabled: false })]) });
    expect(off.lore).toHaveLength(0);

    const partial = build({
      story: withEntries([lore({ keys: ['keep'], matchWholeWords: true })]),
    });
    expect(partial.lore).toHaveLength(0);

    const cased = build({
      story: withEntries([lore({ keys: ['Keeper'], caseSensitive: true })]),
    });
    expect(cased.lore).toHaveLength(0);
  });
});

/**
 * What the dearest of cl100k and o200k was measured to charge (#30): a token
 * for every 0.83 characters of Han, Kana or Hangul, and one for every 3.6 of
 * anything else. Written out here rather than taken from the estimator, so
 * that this asks the question the endpoint asks — does it fit? — instead of
 * asking the estimator whether it agrees with itself.
 */
function dearestCount(messages: readonly { content: string }[]): number {
  return messages.reduce((total, message) => {
    let cjk = 0;
    for (const character of message.content) {
      const code = character.codePointAt(0)!;
      if ((code >= 0x2e80 && code < 0xa000) || (code >= 0xac00 && code < 0xd800)) cjk++;
    }
    return total + 4 + Math.ceil(cjk / 0.83 + (message.content.length - cjk) / 3.6);
  }, 0);
}

describe('buildPrompt: the budget', () => {
  const params = { ...DEFAULT_GENERATION, maxContextTokens: 1200, maxResponseTokens: 800 };

  it('drops the oldest messages first and reports how many went', () => {
    const messages = Array.from({ length: 12 }, (_, i) =>
      said('user', `Message ${i}. `.repeat(20)),
    );
    const built = buildPrompt({
      story: story(),
      chapter: chapter({ messages }),
      params,
      estimator: heuristicEstimator,
    });
    const sent = built.messages.filter((m) => m.role !== 'system');
    expect(sent.length).toBeLessThan(messages.length);
    expect(built.dropped).toBe(messages.length - sent.length);
    // What survives is the end of the conversation, not the start.
    expect(sent[sent.length - 1].content).toContain('Message 11');
  });

  it('always keeps the message being sent, however tight the budget', () => {
    const built = buildPrompt({
      story: story(),
      chapter: chapter({ messages: [said('user', 'x'.repeat(4000))] }),
      draft: 'And now this.',
      params: { ...params, maxContextTokens: 1024 },
      estimator: heuristicEstimator,
    });
    const last = built.messages[built.messages.length - 1];
    expect(last).toEqual({ role: 'user', content: 'And now this.' });
    expect(built.dropped).toBe(1);
  });

  it('trims a story in Chinese to something the endpoint will take', () => {
    // Under one rate for every script this was the bug in #30: the budget
    // counted a Chinese chapter at a quarter of its price, sent three or four
    // times the window, and got back a 400 it had nothing smaller to answer.
    const scene = '港口墙上的灯已经连续三个晚上没有亮了，村里没有人愿意说出原因。';
    const built = buildPrompt({
      story: story(),
      chapter: chapter({ messages: Array.from({ length: 60 }, () => said('user', scene)) }),
      params: { ...DEFAULT_GENERATION, maxContextTokens: 4096, maxResponseTokens: 1024 },
      estimator: heuristicEstimator,
    });

    expect(built.dropped).toBeGreaterThan(0);
    expect(dearestCount(built.messages)).toBeLessThanOrEqual(4096 - 1024);
  });

  it('skips failed turns and empty placeholders', () => {
    const built = build({
      chapter: chapter({
        messages: [
          said('user', 'Hello.'),
          { ...said('assistant', ''), meta: { error: 'Rate limited' } },
        ],
      }),
    });
    expect(built.messages.filter((m) => m.role === 'assistant')).toHaveLength(0);
    expect(built.dropped).toBe(0);
  });
});

/**
 * The one thing about the request that is not visible in any single one of
 * them: what two consecutive sends have in common.
 *
 * Every provider worth naming keeps a prefix cache, and charges a fraction —
 * or nothing — for the leading bytes of a prompt it has already read. The
 * prompt is resent whole because `/chat/completions` is stateless and there is
 * no version of this app that sends less; what is negotiable is whether the
 * provider sees a new prompt or a longer version of the last one. `buildPrompt`
 * is pure, so that is testable here, without a network and without a bill.
 *
 * These cases are the standing check the caching work is worth anything at
 * all: a caching failure is silent — the requests still succeed, the replies
 * are still right, the bill is just larger — so nothing but an assertion
 * notices when a change to prompt assembly starts rewriting byte 0 again.
 */
describe('buildPrompt: the prefix a provider caches', () => {
  /** Element for element, `JSON.stringify`-identical, from the first. */
  function isPrefixOf(earlier: readonly unknown[], later: readonly unknown[]): boolean {
    return (
      earlier.length <= later.length &&
      earlier.every((m, i) => JSON.stringify(m) === JSON.stringify(later[i]))
    );
  }

  /** The chapter as it stands after `turns` sends, each answered. */
  function after(turns: number, seeded: ChapterMessage[]): ChapterMessage[] {
    const messages = [...seeded];
    for (let i = 0; i < turns; i++) {
      messages.push(said('user', `I go on. (${i})`), said('assistant', `So does she. (${i})`));
    }
    return messages;
  }

  it('grows the request rather than rewriting it, turn after turn', () => {
    const seeded = [said('user', 'I knock.'), said('assistant', 'The door opens.')];
    const params = DEFAULT_GENERATION;
    const send = (turns: number) =>
      buildPrompt({
        story: story(),
        chapter: chapter({ messages: after(turns, seeded) }),
        draft: 'And then?',
        params,
        estimator: heuristicEstimator,
      });

    for (let turn = 0; turn < 4; turn++) {
      const earlier = send(turn).messages;
      const later = send(turn + 1).messages;
      // The draft is the same words every turn, so the earlier request is the
      // later one with the last line removed: exactly the shape a cache reads.
      expect(isPrefixOf(earlier.slice(0, -1), later)).toBe(true);
    }
  });

  it('keeps the same window for many turns once the chapter is over budget', () => {
    // Long enough that the budget cannot hold it, and made of messages large
    // enough that a turn of ordinary size barely moves the boundary — which is
    // the case one message at a time got wrong, and got wrong every turn.
    const seeded = Array.from({ length: 83 }, (_, i) =>
      said(i % 2 ? 'assistant' : 'user', `Paragraph ${i}. ${'The tide turned again. '.repeat(5)}`),
    );
    const params = { ...DEFAULT_GENERATION, maxContextTokens: 2400, maxResponseTokens: 200 };
    const send = (turns: number) =>
      buildPrompt({
        story: story(),
        chapter: chapter({ messages: after(turns, seeded) }),
        draft: 'And then?',
        params,
        estimator: heuristicEstimator,
      });

    // The premise: this really is over budget, and by a long way.
    expect(send(0).dropped).toBeGreaterThan(8);

    let breaks = 0;
    for (let turn = 0; turn < 6; turn++) {
      const earlier = send(turn).messages;
      const later = send(turn + 1).messages;
      if (!isPrefixOf(earlier.slice(0, -1), later)) breaks++;
    }
    // One message at a time, every one of the six would have broken here. In
    // blocks the window gives way once every four turns at the most, and over
    // six turns of this size it does not give way at all.
    expect(breaks).toBeLessThanOrEqual(1);

    // And two consecutive sends over budget open on the same message, which is
    // what the whole of the above is for.
    expect(send(0).messages[1]).toEqual(send(1).messages[1]);
    expect(isPrefixOf(send(0).messages.slice(0, -1), send(1).messages)).toBe(true);
  });

  it('opens the window on a turn rather than on an answer to nothing', () => {
    const seeded = Array.from({ length: 83 }, (_, i) =>
      said(i % 2 ? 'assistant' : 'user', `Paragraph ${i}. ${'The tide turned again. '.repeat(5)}`),
    );
    const built = buildPrompt({
      story: story(),
      chapter: chapter({ messages: seeded }),
      draft: 'And then?',
      params: { ...DEFAULT_GENERATION, maxContextTokens: 2400, maxResponseTokens: 200 },
      estimator: heuristicEstimator,
    });
    expect(built.messages[1].role).toBe('user');
  });
});

describe('chapter titles', () => {
  it('falls back to the scene’s first line, trimmed', () => {
    expect(chapterTitle({ title: 'Aloft', scene: 'anything' })).toBe('Aloft');
    expect(chapterTitle({ title: '  ', scene: 'The lantern room.\nAn hour later.' })).toBe(
      'The lantern room.',
    );
    expect(firstLine('x'.repeat(200)).endsWith('…')).toBe(true);
  });

  /**
   * The heading was composed by hand in four components at two fallback rules,
   * so this is the rule: the number, and the title after a dash when there is
   * one to put there. The dash is the app's own — the two places the model is
   * told which chapter this is use a comma, and are asserted where they are
   * built.
   */
  it('is the number and the name, with nothing between them when there is no name', () => {
    expect(chapterHeading({ number: 3, title: 'Aloft', scene: 'anything' })).toBe(
      'Chapter 3 — Aloft',
    );
    expect(chapterHeading({ number: 3, title: '', scene: 'The lantern room.' })).toBe(
      'Chapter 3 — The lantern room.',
    );
    // Nothing to fall back to: no dash left hanging off the number.
    expect(chapterHeading({ number: 3, title: '', scene: '   ' })).toBe('Chapter 3');
    expect(chapterName({ number: 12 })).toBe('Chapter 12');
  });

  it('counts what was written in a chapter, and not the cast changing', () => {
    const cast: ChapterMessage = {
      id: 'c1',
      role: 'system',
      content: '',
      createdAt: '',
      kind: 'cast',
    };
    const written = writtenIn({ messages: [said('user', 'I knock.'), cast] });
    expect(written.map((m) => m.content)).toEqual(['I knock.']);
  });
});

/**
 * The chapter block, exported because the scene sheet costs it as it is typed.
 * The comma is the point: a copy of this string in that sheet wrote one whether
 * or not there was a title to follow it, and costed `Chapter 0, . The scene:`.
 */
describe('the scene block', () => {
  it('names the chapter, with a comma only when there is a title', () => {
    expect(sceneBlock({ number: 2, title: 'Aloft', scene: 'The lamp is out.' })).toBe(
      'Chapter 2, Aloft. The scene:\nThe lamp is out.',
    );
    expect(sceneBlock({ number: 2, title: '  ', scene: 'The lamp is out.' })).toBe(
      'Chapter 2. The scene:\nThe lamp is out.',
    );
  });

  it('is nothing at all until there is a scene', () => {
    expect(sceneBlock({ number: 2, title: 'Aloft', scene: '   ' })).toBe('');
  });
});

/**
 * The three instructions the writer may take over, and the one rule the request
 * and every box that shows it now share. The rule matters because the two the
 * app started with used to differ: the panel showed the document, the request
 * fell back to ours, and an override with an emptied box showed nothing while
 * sending the default.
 */
describe('the instructions the writer may take over', () => {
  const narrator = (patch: Partial<Story['narrator']>) =>
    narratorInstruction(story({ narrator: { useDefault: false, prompt: '', ...patch } }));

  it('is ours until the writer has both said so and written something', () => {
    expect(narrator({ useDefault: true })).toBe(DEFAULT_NARRATOR_PROMPT);
    expect(narrator({ prompt: 'Write it cold.' })).toBe('Write it cold.');
    // The override is on and the box is empty: ours, because an empty
    // instruction is not one and a request with no preamble is not the ask.
    expect(narrator({ prompt: '   ' })).toBe(DEFAULT_NARRATOR_PROMPT);
    // And ours are kept, so turning the switch off finds the words again.
    expect(narrator({ useDefault: true, prompt: 'Write it cold.' })).toBe(DEFAULT_NARRATOR_PROMPT);
  });

  it('says which of the two is being sent, which is what a box dims for', () => {
    expect(isDefaultInstruction({ useDefault: true, prompt: 'Write it cold.' })).toBe(true);
    expect(isDefaultInstruction({ useDefault: false, prompt: '  ' })).toBe(true);
    expect(isDefaultInstruction({ useDefault: false, prompt: 'Write it cold.' })).toBe(false);
  });

  it('is the same rule for the role-play instruction', () => {
    const roleplay = (patch: Partial<Story['roleplay']['instruction']>) => {
      const base = story();
      return roleplayInstruction({
        roleplay: { ...base.roleplay, instruction: { useDefault: false, prompt: '', ...patch } },
      });
    };
    expect(roleplay({ useDefault: true })).toBe(DEFAULT_ROLEPLAY_PROMPT);
    expect(roleplay({ prompt: 'Play them as three ghosts.' })).toBe('Play them as three ghosts.');
    expect(roleplay({ prompt: '   ' })).toBe(DEFAULT_ROLEPLAY_PROMPT);
    expect(roleplay({ useDefault: true, prompt: 'Play them as three ghosts.' })).toBe(
      DEFAULT_ROLEPLAY_PROMPT,
    );
  });

  it('puts the writer’s own role-play instruction where ours was', () => {
    const base = story();
    const built = build({
      story: {
        ...base,
        mode: 'roleplay',
        characters: [{ id: 'a', name: 'Tomas', description: 'The keeper.', enabled: true }],
        roleplay: {
          ...base.roleplay,
          instruction: { useDefault: false, prompt: 'Play them as three ghosts.' },
        },
      },
    });
    const system = built.messages[0].content;
    expect(system.startsWith('Play them as three ghosts.\n\nYou are playing Tomas.')).toBe(true);
    expect(system).not.toContain(DEFAULT_ROLEPLAY_PROMPT);
  });

  it('is the same rule for the summary instruction', () => {
    const summary = (patch: Partial<Story['world']['summary']>) => {
      const base = story();
      return summaryInstruction({
        world: { ...base.world, summary: { useDefault: false, prompt: '', ...patch } },
      });
    };
    expect(summary({ useDefault: true })).toBe(DEFAULT_SUMMARY_INSTRUCTION);
    expect(summary({ prompt: 'Two paragraphs, no more.' })).toBe('Two paragraphs, no more.');
    expect(summary({ prompt: '' })).toBe(DEFAULT_SUMMARY_INSTRUCTION);
  });

  it('starts from ours when the switch is thrown, and keeps what was written', () => {
    const empty = { useDefault: true, prompt: '' };
    expect(overriding(empty, true, DEFAULT_NARRATOR_PROMPT)).toEqual({
      useDefault: false,
      prompt: DEFAULT_NARRATOR_PROMPT,
    });
    // Thrown back: ours again, and their words are still in the document.
    const own = { useDefault: false, prompt: 'Write it cold.' };
    expect(overriding(own, false, DEFAULT_NARRATOR_PROMPT)).toEqual({
      useDefault: true,
      prompt: 'Write it cold.',
    });
    // And thrown on again, it is their words that come back rather than ours.
    expect(overriding({ useDefault: true, prompt: 'Write it cold.' }, true, 'ours')).toEqual({
      useDefault: false,
      prompt: 'Write it cold.',
    });
  });
});

describe('buildSummaryPrompt', () => {
  const written = chapter({
    number: 1,
    messages: [said('user', 'I knock.'), said('assistant', 'No answer.')],
  });

  it('hands over the story so far, the scene and the transcript', () => {
    const messages = buildSummaryPrompt(
      story({ world: { ...story().world, storySoFar: 'She arrived on the island.' } }),
      written,
    );
    const user = messages[1].content;
    // The answer replaces the summary, so the old one has to be in the question.
    expect(user).toContain('The story so far, as it stands:');
    expect(user).toContain('She arrived on the island.');
    expect(user).toContain('The keeper’s cottage');
    expect(user).toContain('Reader: I knock.');
    expect(user).toContain('Story: No answer.');
    expect(user).toContain(DEFAULT_SUMMARY_INSTRUCTION);
  });

  it('says so when there is no summary yet', () => {
    expect(buildSummaryPrompt(story(), written)[1].content).toContain(
      'There is no summary of the story yet',
    );
  });

  it('uses the writer’s own instruction once overridden', () => {
    const base = story();
    const own = story({
      world: { ...base.world, summary: { useDefault: false, prompt: 'Two lines, no more.' } },
    });
    expect(summaryInstruction(own)).toBe('Two lines, no more.');
    expect(buildSummaryPrompt(own, written)[1].content).toContain('Two lines, no more.');

    // The switch decides, not the text: turning it off restores ours.
    const off = {
      ...own,
      world: { ...own.world, summary: { ...own.world.summary, useDefault: true } },
    };
    expect(summaryInstruction(off)).toBe(DEFAULT_SUMMARY_INSTRUCTION);
  });
});
