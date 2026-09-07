import { describe, expect, it } from 'vitest';
import { AUTHOR_DIRECTIONS_PROMPT, DEFAULT_GENERATION } from './defaults';
import { Chapter, ChapterMessage, Story } from './models';
import { PINNED_LAST, buildPrompt, buildSummaryPrompt, withDirection } from './prompt-builder';
import { heuristicEstimator } from './tokens';
import { newChapter, newStory } from './fixtures';

/**
 * The author's voice, as `prompt-builder.ts` handles it: kept apart from the
 * prose, joined to it only on the wire, and never in the summary. What a
 * direction looks like once it is on disk is `store/documents.spec.ts`.
 */

function story(patch: Partial<Story> = {}): Story {
  return {
    ...newStory('The Lighthouse'),
    persona: { name: 'Mara', description: 'a marine biologist' },
    ...patch,
  };
}

function chapter(messages: ChapterMessage[] = []): Chapter {
  return { ...newChapter('story', 1, 'The lantern room, an hour before dusk.'), messages };
}

let clock = 0;

function said(content: string, direction?: string): ChapterMessage {
  return { id: `m${++clock}`, role: 'user', content, createdAt: '', direction };
}

function answered(content: string): ChapterMessage {
  return { id: `a${++clock}`, role: 'assistant', content, createdAt: '' };
}

function build(chapter: Chapter, patch: Partial<Story> = {}, draft = '', draftDirection = '') {
  return buildPrompt({
    story: story(patch),
    chapter,
    draft,
    draftDirection,
    params: DEFAULT_GENERATION,
    estimator: heuristicEstimator,
  });
}

describe('what goes on the wire', () => {
  it('sends the prose, a blank line, then the direction in brackets', () => {
    expect(withDirection('Mara pushes the door open.', 'The room is empty.')).toBe(
      'Mara pushes the door open.\n\n[Author: The room is empty.]',
    );
  });

  it('sends the bracketed line alone when the author said nothing else', () => {
    expect(withDirection('', 'The storm arrives tonight.')).toBe(
      '[Author: The storm arrives tonight.]',
    );
    expect(withDirection('Just prose.', undefined)).toBe('Just prose.');
    expect(withDirection('Just prose.', '   ')).toBe('Just prose.');
  });

  it('carries the direction into the request as part of that turn', () => {
    const built = build(chapter([said('Mara pushes the door open.', 'The room is empty.')]));
    const turns = built.messages.filter((m) => m.role !== 'system');

    expect(turns).toHaveLength(1);
    expect(turns[0].content).toBe('Mara pushes the door open.\n\n[Author: The room is empty.]');
  });

  it('sends a message that is nothing but a direction', () => {
    const built = build(chapter([said('', 'The storm arrives tonight.')]));

    expect(built.messages.filter((m) => m.role === 'user')).toHaveLength(1);
    expect(built.messages.at(-1)?.content).toBe('[Author: The storm arrives tonight.]');
  });

  it('keeps directions in the history, turns later', () => {
    const built = build(
      chapter([
        said('I try the latch.', 'The storm arrives tonight.'),
        answered('It does not give.'),
        said('I try again.'),
        answered('Rain starts.'),
      ]),
    );

    expect(built.messages[1].content).toContain('[Author: The storm arrives tonight.]');
  });
});

describe('the author block', () => {
  it('is there when the chapter carries a direction, and not before', () => {
    const without = build(chapter([said('I try the latch.')]));
    expect(without.blocks.map((b) => b.id)).not.toContain('author');
    expect(without.messages[0].content).not.toContain('[Author: …]');

    const with_ = build(chapter([said('I try the latch.', 'The storm arrives tonight.')]));
    const author = with_.blocks.find((b) => b.id === 'author');
    expect(author?.content).toBe(AUTHOR_DIRECTIONS_PROMPT);
  });

  it('is there the moment the composer has one open, before it is sent', () => {
    const built = build(chapter([said('I try the latch.')]), {}, 'I try again.', 'She refuses.');

    expect(built.blocks.map((b) => b.id)).toContain('author');
    expect(built.messages.at(-1)?.content).toBe('I try again.\n\n[Author: She refuses.]');
  });

  it('sits last of all, after the style rules, and cannot be moved', () => {
    const built = build(chapter([said('I try the latch.', 'The storm arrives tonight.')]));
    const ids = built.blocks.map((b) => b.id);

    expect(ids.at(-1)).toBe('author');
    expect(ids.at(-2)).toBe('style');
    // Pinned, and the last of the pinned end, which is what puts it last of all.
    expect(PINNED_LAST.at(-1)).toBe('author');

    // A stored order that names it is a list this build cannot honour, so the
    // whole list is refused rather than half-applied.
    const meddling = build(chapter([said('I try the latch.', 'The storm arrives tonight.')]), {
      promptOrder: ['author', 'persona', 'story-so-far', 'lore'],
    });
    expect(meddling.blocks.map((b) => b.id).at(-1)).toBe('author');
    expect(meddling.blocks.filter((b) => b.id === 'author')).toHaveLength(1);
  });

  it('says the same thing every time: the text is not a setting', () => {
    expect(AUTHOR_DIRECTIONS_PROMPT).toContain('[Author: …]');
    expect(AUTHOR_DIRECTIONS_PROMPT).toContain('override every other instruction above');
  });
});

describe('what a direction is left out of', () => {
  it('is not in the summary request, and neither is a message that was only one', () => {
    const messages = [
      said('Mara pushes the door open.', 'The room is empty, and it should not be.'),
      answered('The room is empty.'),
      said('', 'The storm arrives tonight.'),
    ];
    const [, user] = buildSummaryPrompt(story(), chapter(messages));

    expect(user.content).toContain('Mara pushes the door open.');
    expect(user.content).not.toContain('The room is empty, and it should not be.');
    expect(user.content).not.toContain('The storm arrives tonight.');
    expect(user.content).not.toContain('[Author:');
  });

  it('fires no lore of its own', () => {
    const base = story();
    const patch = {
      world: {
        ...base.world,
        entries: [
          {
            id: 'storm',
            title: 'The storm',
            category: 'fact' as const,
            keys: ['storm'],
            content: 'It has been building for three days.',
            enabled: true,
            alwaysOn: false,
          },
        ],
      },
    };

    // The word is in the direction and nowhere else in the chapter.
    const built = build(chapter([said('I try the latch.', 'The storm arrives tonight.')]), patch);
    expect(built.lore).toHaveLength(0);

    const mentioned = build(chapter([said('I watch the storm come in.')]), patch);
    expect(mentioned.lore).toHaveLength(1);
  });
});
