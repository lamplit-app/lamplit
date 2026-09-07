import { describe, expect, it } from 'vitest';
import { Chapter, ChapterMessage, LoreEntry, Story } from './models';
import { LORE_SCHEMA, buildLorePrompt, entryFrom, readProposals } from './lore-extraction';
import { parseJsonObject, readCompletion } from './model-client';
import { newChapter, newStory } from './fixtures';

/**
 * What a chapter established, asked for as JSON: the request, what comes back,
 * and every way a model can answer it that still has to be read.
 */

const TOMAS: LoreEntry = {
  id: 'lore-tomas',
  title: 'Old Tomas',
  category: 'person',
  keys: ['tomas', 'keeper'],
  content: 'Kept the light for nineteen years before Mara’s father.',
  enabled: true,
  alwaysOn: false,
};

function story(entries: LoreEntry[] = []): Story {
  const base = newStory('The Lighthouse');
  return {
    ...base,
    persona: { name: 'Mara', description: 'a marine biologist' },
    world: { ...base.world, entries },
  };
}

function said(role: 'user' | 'assistant', content: string, direction?: string): ChapterMessage {
  return { id: `${role}-${content.slice(0, 8)}`, role, content, createdAt: '', direction };
}

function chapter(messages: ChapterMessage[] = []): Chapter {
  return { ...newChapter('story', 1, 'The lantern room, an hour before dusk.'), messages };
}

describe('what is asked for', () => {
  it('sends the chapter, and the entries the world already holds by name', () => {
    const [, user] = buildLorePrompt(
      story([TOMAS]),
      chapter([said('user', 'I ask about the ferry.'), said('assistant', 'She says nothing.')]),
    );

    expect(user.content).toContain('The lantern room, an hour before dusk.');
    expect(user.content).toContain('I ask about the ferry.');
    expect(user.content).toContain('- Old Tomas (tomas, keeper)');
    // The titles and the keys, and not the text of them: enough to say what is
    // covered, without paying for the world twice on every chapter close.
    expect(user.content).not.toContain('nineteen years');
  });

  it('says so plainly when the world is empty', () => {
    const [, user] = buildLorePrompt(story(), chapter([said('user', 'I knock.')]));
    expect(user.content).toContain('The world holds no entries yet.');
  });

  it('leaves the author out of it', () => {
    const [, user] = buildLorePrompt(
      story(),
      chapter([
        said('user', 'I push the door.', 'The room is empty, and it should not be.'),
        said('user', '', 'The storm arrives tonight.'),
      ]),
    );

    expect(user.content).toContain('I push the door.');
    expect(user.content).not.toContain('The room is empty');
    expect(user.content).not.toContain('The storm arrives tonight.');
  });

  it('asks for the shape in the words as well as in the schema', () => {
    const [system, user] = buildLorePrompt(story(), chapter());
    expect(system.content).toContain('JSON and nothing else');
    expect(user.content).toContain('"entries"');
    // Strict schemas have no optional properties, so `updates` is required and
    // empty rather than missing.
    expect(LORE_SCHEMA.schema.properties.entries.items.required).toContain('updates');
  });
});

describe('what comes back', () => {
  const answer = (entries: unknown) => ({ entries });

  it('reads the entries a model returns', () => {
    const [proposal] = readProposals(
      answer([
        {
          title: 'Ashport',
          category: 'place',
          keys: ['ashport', 'the town'],
          content: 'A town of nine hundred at the mouth of the estuary.',
          updates: '',
        },
      ]),
      [],
    );

    expect(proposal.title).toBe('Ashport');
    expect(proposal.category).toBe('place');
    expect(proposal.keys).toEqual(['ashport', 'the town']);
    expect(proposal.updates).toBeUndefined();
  });

  it('matches an update to the entry it would overwrite', () => {
    const [proposal] = readProposals(
      answer([
        {
          title: 'Old Tomas',
          category: 'person',
          keys: ['tomas'],
          content: 'Last seen boarding the ferry.',
          updates: 'old tomas',
        },
      ]),
      [TOMAS],
    );

    expect(proposal.updates).toBe(TOMAS);
  });

  it('treats a title the world already has as an update, said or not', () => {
    const [proposal] = readProposals(
      answer([{ title: 'Old Tomas', category: 'person', keys: ['tomas'], content: 'Again.' }]),
      [TOMAS],
    );

    expect(proposal.updates).toBe(TOMAS);
  });

  it('is not thrown by a model that answered its own way', () => {
    const proposals = readProposals(
      answer([
        // A category nobody offered, and no keys at all.
        { title: 'The ferry', category: 'vehicle', keys: [], content: 'Runs twice a day.' },
        // Nothing worth filing.
        { title: '', category: 'fact', keys: ['x'], content: 'Something.' },
        { title: 'No content', category: 'fact', keys: ['x'], content: '   ' },
        // Keys the same twice, and one that is only spaces.
        { title: 'Keys', category: 'fact', keys: ['A', 'a', '  '], content: 'Kept.' },
        'not an object',
      ]),
      [],
    );

    expect(proposals.map((p) => p.title)).toEqual(['The ferry', 'Keys']);
    expect(proposals[0].category).toBe('fact');
    // An entry with no keys can never fire, so it answers to its own title.
    expect(proposals[0].keys).toEqual(['The ferry']);
    expect(proposals[1].keys).toEqual(['A']);
  });

  it('reads nothing out of an answer with nothing in it', () => {
    expect(readProposals(answer([]), [])).toEqual([]);
    expect(readProposals({}, [])).toEqual([]);
    expect(readProposals(null, [])).toEqual([]);
    expect(readProposals({ entries: 'no' }, [])).toEqual([]);
  });
});

describe('the entry that gets filed', () => {
  it('is a new one, enabled and not always on', () => {
    const entry = entryFrom(
      { title: 'Ashport', category: 'place', keys: ['ashport'], content: 'A town.' },
      'new-id',
    );

    expect(entry).toEqual({
      id: 'new-id',
      title: 'Ashport',
      category: 'place',
      keys: ['ashport'],
      content: 'A town.',
      enabled: true,
      alwaysOn: false,
    });
  });

  it('keeps everything about an update the request never knew', () => {
    const existing: LoreEntry = { ...TOMAS, alwaysOn: true, enabled: false, caseSensitive: true };
    const entry = entryFrom(
      {
        title: 'Old Tomas',
        category: 'person',
        keys: ['tomas'],
        content: 'Last seen boarding the ferry.',
        updates: existing,
      },
      'unused-id',
    );

    expect(entry.id).toBe(TOMAS.id);
    expect(entry.content).toBe('Last seen boarding the ferry.');
    // Switched off, always on, case sensitive: none of that was asked about,
    // so none of it is answered.
    expect(entry.alwaysOn).toBe(true);
    expect(entry.enabled).toBe(false);
    expect(entry.caseSensitive).toBe(true);
  });
});

describe('reading a JSON answer that is not quite JSON', () => {
  it('takes a bare object', () => {
    expect(parseJsonObject('{"entries":[]}')).toEqual({ entries: [] });
  });

  it('takes one in a fence, which is what an endpoint without schemas gives', () => {
    expect(parseJsonObject('```json\n{"entries":[{"title":"Ashport"}]}\n```')).toEqual({
      entries: [{ title: 'Ashport' }],
    });
    expect(parseJsonObject('```\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it('takes one with a sentence in front of it', () => {
    expect(parseJsonObject('Here is what I found:\n{"entries":[]}\nHope that helps.')).toEqual({
      entries: [],
    });
  });

  it('gives up rather than guessing', () => {
    expect(parseJsonObject('There was nothing worth keeping.')).toBeNull();
    expect(parseJsonObject('')).toBeNull();
    // An array is not the object that was asked for.
    expect(parseJsonObject('[1, 2, 3]')).toBeNull();
  });

  it('reads the text and the cost out of a completion', () => {
    const answer = readCompletion({
      choices: [{ message: { role: 'assistant', content: '{"entries":[]}' } }],
      usage: { prompt_tokens: 812, completion_tokens: 96, total_tokens: 908 },
    });

    expect(answer.content).toBe('{"entries":[]}');
    expect(answer.usage).toEqual({ promptTokens: 812, completionTokens: 96, totalTokens: 908 });
    expect(readCompletion(null).content).toBe('');
  });
});
