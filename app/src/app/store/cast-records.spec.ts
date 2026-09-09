import { describe, expect, it } from 'vitest';
import { ChapterMessage, Story } from '../core/models';
import { newStory } from '../core/fixtures';
import { castState, sameCast, withCastRecord } from './cast-records';

/**
 * What a record of the cast changing means, held directly.
 *
 * These rules used to be inside `ChapterStore.recordCast`, where the only way
 * to reach them was to build a store over a fake backend and then change a
 * character — and so nothing tested them. They are rules a *reader* depends
 * on: a record says what changed without being read next to its neighbours,
 * so a message deleted or replayed between two of them must not change what
 * either one says.
 */
function cast(characters: { id: string; enabled: boolean }[], playing = ''): Story {
  const story = newStory();
  return {
    ...story,
    characters: characters.map((c) => ({
      id: c.id,
      name: c.id.toUpperCase(),
      description: '',
      enabled: c.enabled,
    })),
    roleplay: { ...story.roleplay, activeCharacterId: playing },
  };
}

const said = (id: string): ChapterMessage => ({
  id,
  role: 'user',
  content: 'The bell rings.',
  createdAt: '',
});

describe('castState', () => {
  it('is who the model plays and who is in the scene, and nothing else', () => {
    const state = castState(
      cast(
        [
          { id: 'a', enabled: true },
          { id: 'b', enabled: false },
        ],
        'a',
      ),
    );

    expect(state).toEqual({ activeCharacterId: 'a', enabled: ['a'] });
  });

  it('names the first character in the scene when the named one is not in it', () => {
    const state = castState(
      cast(
        [
          { id: 'a', enabled: false },
          { id: 'b', enabled: true },
        ],
        'a',
      ),
    );

    // A story is never left with a voice it cannot use, so the record says the
    // voice that will actually answer rather than the one the setting names.
    expect(state).toEqual({ activeCharacterId: 'b', enabled: ['b'] });
  });
});

describe('sameCast', () => {
  const state = { activeCharacterId: 'a', enabled: ['a', 'b'] };

  it('is the same cast when both halves match, in order', () => {
    expect(sameCast(state, { activeCharacterId: 'a', enabled: ['a', 'b'] })).toBe(true);
    expect(sameCast(state, { activeCharacterId: 'b', enabled: ['a', 'b'] })).toBe(false);
    expect(sameCast(state, { activeCharacterId: 'a', enabled: ['a'] })).toBe(false);
  });

  it('is never the same as a cast nobody recorded', () => {
    expect(sameCast(undefined, state)).toBe(false);
  });
});

describe('withCastRecord', () => {
  /** A cast of one, playing A, which is where each of these starts. */
  const was = { activeCharacterId: 'a', enabled: ['a'] };
  const bJoins = cast(
    [
      { id: 'a', enabled: true },
      { id: 'b', enabled: true },
    ],
    'b',
  );

  it('files the change at the end, with what the cast was as well as what it is', () => {
    const messages = withCastRecord([said('m1')], bJoins, was);

    expect(messages.map((m) => m.kind)).toEqual([undefined, 'cast']);
    expect(messages[1].cast).toEqual({ activeCharacterId: 'b', enabled: ['a', 'b'], was });
  });

  it('folds two changes with nothing written between them into one', () => {
    const first = withCastRecord([said('m1')], bJoins, was);
    const cJoins = cast(
      [
        { id: 'a', enabled: true },
        { id: 'b', enabled: true },
        { id: 'c', enabled: true },
      ],
      'c',
    );

    const second = withCastRecord(first, cJoins, { activeCharacterId: 'b', enabled: ['a', 'b'] });

    // One record still, and it remembers the cast before *both* changes: the
    // reader is told what happened, not that somebody clicked twice.
    expect(second.filter((m) => m.kind === 'cast')).toHaveLength(1);
    expect(second[1].cast).toEqual({
      activeCharacterId: 'c',
      enabled: ['a', 'b', 'c'],
      was,
    });
  });

  it('files nothing at all when a second change puts the cast back as it was', () => {
    const first = withCastRecord([said('m1')], bJoins, was);

    const back = withCastRecord(first, cast([{ id: 'a', enabled: true }], 'a'), {
      activeCharacterId: 'b',
      enabled: ['a', 'b'],
    });

    // Clicked away and back again, and the page says nothing happened.
    expect(back.map((m) => m.id)).toEqual(['m1']);
  });
});
