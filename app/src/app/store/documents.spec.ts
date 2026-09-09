import { describe, expect, it } from 'vitest';
import { normaliseChapter } from './documents';

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
