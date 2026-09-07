import { describe, expect, it } from 'vitest';
import { CHARACTER_COLOURS, characterColour } from './character-colours';
import { CastChange, ChapterMessage, Character, Story } from './models';
import { speakerLabels } from './speakers';
import { newStory } from './fixtures';

/**
 * Who the page says is speaking: the name as it was stored, once per run of
 * turns, and nothing at all where there is no name to show.
 */

const NELL: Character = {
  id: 'nell',
  name: 'Nell',
  description: 'Kept the light with Tomas, and keeps it still.',
  enabled: true,
  colour: 'ember',
};
const TOMAS: Character = {
  id: 'tomas',
  name: 'Tomas',
  description: 'The keeper before her father.',
  enabled: true,
  colour: 'jade',
};

function troupe(patch: Partial<Story> = {}): Story {
  return {
    ...newStory('The Lighthouse'),
    mode: 'roleplay',
    persona: { name: 'Mara', description: 'a marine biologist' },
    characters: [NELL, TOMAS],
    ...patch,
  };
}

let counter = 0;

function said(role: 'user' | 'assistant', speaker?: Character, name?: string): ChapterMessage {
  return {
    id: `m${++counter}`,
    role,
    content: 'Words on the page.',
    createdAt: '',
    speakerId: speaker?.id,
    speakerName: name ?? speaker?.name,
  };
}

function switched(cast: CastChange): ChapterMessage {
  return { id: `c${++counter}`, kind: 'cast', role: 'system', content: '', createdAt: '', cast };
}

/** The label of each message in order; `null` where there is none. */
function labels(story: Story, messages: ChapterMessage[]): (string | null)[] {
  const found = speakerLabels(story, messages, 'dark');
  return messages.filter((m) => m.kind !== 'cast').map((m) => found.get(m.id)?.name ?? null);
}

describe('who is speaking', () => {
  it('names the character who answered, in their colour', () => {
    const story = troupe();
    const message = said('assistant', NELL);
    const label = speakerLabels(story, [message], 'dark').get(message.id);

    expect(label?.name).toBe('Nell');
    expect(label?.colour).toBe(characterColour(NELL, 'dark'));
    // And the other paper says the same name in the other ink.
    expect(speakerLabels(story, [message], 'light').get(message.id)?.colour).toBe(
      CHARACTER_COLOURS.find((c) => c.name === 'ember')!.light,
    );
  });

  it('labels a run of turns by the same speaker once', () => {
    const story = troupe();
    const messages = [
      said('assistant', NELL),
      said('assistant', NELL),
      said('assistant', TOMAS),
      said('assistant', TOMAS),
      said('assistant', NELL),
    ];

    expect(labels(story, messages)).toEqual(['Nell', null, 'Tomas', null, 'Nell']);
  });

  it('labels the reader with their persona, and nothing without one', () => {
    const messages = [said('user'), said('user'), said('assistant', NELL)];

    expect(labels(troupe(), messages)).toEqual(['Mara', null, 'Nell']);
    expect(labels(troupe({ persona: { name: '', description: '' } }), messages)).toEqual([
      null,
      null,
      'Nell',
    ]);
  });

  it('starts the run again after a cast record, even though the page has none', () => {
    const story = troupe();
    const first = said('assistant', NELL);
    const second = said('assistant', NELL);
    const between = switched({ activeCharacterId: 'nell', enabled: ['nell', 'tomas'] });

    expect(labels(story, [first, second])).toEqual(['Nell', null]);
    expect(labels(story, [first, between, second])).toEqual(['Nell', 'Nell']);
  });

  it('says the name that was stored, not the one the character has now', () => {
    const renamed = { ...NELL, name: 'Anna' };
    const story = troupe({ characters: [renamed, TOMAS] });
    const messages = [said('assistant', NELL), said('assistant', undefined, 'Anna')];
    messages[1].speakerId = renamed.id;

    // Old turns keep the old name — and both are still hers, so both are
    // labelled: they no longer read as the same speaker.
    expect(labels(story, messages)).toEqual(['Nell', 'Anna']);
    expect(speakerLabels(story, messages, 'dark').get(messages[0].id)?.colour).toBe(
      characterColour(renamed, 'dark'),
    );
  });

  it('mutes a speaker who has been deleted, and still names them', () => {
    const story = troupe({ characters: [TOMAS] });
    const message = said('assistant', NELL);
    const label = speakerLabels(story, [message], 'dark').get(message.id);

    expect(label?.name).toBe('Nell');
    expect(label?.colour).toBe('');
  });

  it('falls back to the cast for an answer written before names were stored', () => {
    const story = troupe();
    const message: ChapterMessage = {
      id: 'old',
      role: 'assistant',
      content: 'Words on the page.',
      createdAt: '',
      speakerId: 'nell',
    };

    expect(speakerLabels(story, [message], 'dark').get('old')?.name).toBe('Nell');
  });

  it('labels nothing in narrator mode, and nothing an ensemble wrote', () => {
    const messages = [said('user'), said('assistant')];

    expect(labels(troupe({ mode: 'narrator' }), messages)).toEqual([null, null]);
    // Role-play, but nobody in particular answered.
    expect(labels(troupe(), messages)).toEqual(['Mara', null]);
  });

  it('leaves a failed turn alone without breaking the run around it', () => {
    const story = troupe();
    const failed = said('assistant', NELL);
    failed.content = '';
    failed.meta = { error: 'The provider rejected the key.' };

    expect(labels(story, [said('assistant', NELL), failed, said('assistant', NELL)])).toEqual([
      'Nell',
      null,
      null,
    ]);
  });
});
