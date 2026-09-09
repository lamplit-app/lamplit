import { describe, expect, it } from 'vitest';
import { Story } from '../core/models';
import { normaliseChapter, normaliseStory } from './documents';

/**
 * What a document read off the disk is turned into before anything sees it.
 *
 * Everything here is about a file this build did not write: one from an older
 * version, or one written mid-stream and reloaded. The prompt the messages go
 * on to make is the prompt builder's spec; this is the reading of the file.
 */

describe('normaliseChapter', () => {
  /**
   * A reload mid-stream would otherwise restore a message stuck at "typing",
   * so a message with nothing in it is dropped — and a direction counts as
   * something in it. The author's voice is stored apart from the prose, and a
   * message that is nothing but a direction is a message all the same.
   */
  it('keeps a message whose only content is a direction', () => {
    const stored = {
      id: 'c1',
      storyId: 's1',
      number: 1,
      messages: [
        {
          id: 'm1',
          role: 'user' as const,
          content: '',
          direction: 'The storm arrives tonight.',
          createdAt: '',
        },
        { id: 'm2', role: 'user' as const, content: '', createdAt: '' },
      ],
    };

    // A document as it comes off disk, which is what the signature says it
    // takes: everything the chapter has not got yet is filled in from
    // `newChapter`, so the fixture is only the fields the case is about.
    const messages = normaliseChapter(stored).messages;
    expect(messages.map((m) => m.id)).toEqual(['m1']);
  });
});

/**
 * `roleplay` is the one field merged a level deeper than the rest, because the
 * instruction above the cast arrived after the casting did: a story written
 * between the two has a `roleplay` with a casting in it and no instruction, and
 * a shallow spread would leave it without one.
 */
describe('normaliseStory', () => {
  it('gives a story cast before there was an instruction the default one', () => {
    const story = normaliseStory({
      id: 's1',
      mode: 'roleplay',
      roleplay: { casting: 'one-at-a-time', activeCharacterId: 'nell' },
    } as Partial<Story>);

    expect(story.roleplay.instruction).toEqual({ useDefault: true, prompt: '' });
    // And the casting it did answer is untouched.
    expect(story.roleplay.casting).toBe('one-at-a-time');
    expect(story.roleplay.activeCharacterId).toBe('nell');
  });

  it('does the same for a story with no roleplay block at all', () => {
    const story = normaliseStory({ id: 's2', mode: 'roleplay' });
    expect(story.roleplay).toEqual({
      casting: 'ensemble',
      activeCharacterId: '',
      instruction: { useDefault: true, prompt: '' },
    });
  });

  it('keeps the writer’s own instruction when the document carries one', () => {
    const story = normaliseStory({
      id: 's3',
      roleplay: {
        casting: 'ensemble',
        activeCharacterId: '',
        instruction: { useDefault: false, prompt: 'Play them as three ghosts.' },
      },
    });
    expect(story.roleplay.instruction).toEqual({
      useDefault: false,
      prompt: 'Play them as three ghosts.',
    });
  });
});
