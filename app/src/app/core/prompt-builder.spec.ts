import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GENERATION,
  DEFAULT_NARRATOR_PROMPT,
  DEFAULT_SUMMARY_INSTRUCTION,
} from './defaults';
import { BlockId, Chapter, ChapterMessage, LoreEntry, Story } from './models';
import {
  buildPrompt,
  buildSummaryPrompt,
  chapterTitle,
  firstLine,
  isDefaultOrder,
  movableOrder,
  summaryInstruction,
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
    expect(system).toContain('You are playing Tomas.');
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
    expect(built.messages[0].content).toContain('missing since spring');
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

describe('chapter titles', () => {
  it('falls back to the scene’s first line, trimmed', () => {
    expect(chapterTitle({ title: 'Aloft', scene: 'anything' })).toBe('Aloft');
    expect(chapterTitle({ title: '  ', scene: 'The lantern room.\nAn hour later.' })).toBe(
      'The lantern room.',
    );
    expect(firstLine('x'.repeat(200)).endsWith('…')).toBe(true);
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
