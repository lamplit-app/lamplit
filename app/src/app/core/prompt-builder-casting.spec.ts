import { describe, expect, it } from 'vitest';
import { DEFAULT_GENERATION } from './defaults';
import { CastChange, Chapter, ChapterMessage, Character, Story } from './models';
import { activeCharacter, buildPrompt, buildSummaryPrompt, isOneAtATime } from './prompt-builder';
import { heuristicEstimator } from './tokens';
import { newChapter, newStory } from './fixtures';

/**
 * Role-play with a cast, as `prompt-builder.ts` sends it: the ensemble the app
 * has always sent, and the one character at a time it can send instead.
 */

const NELL: Character = {
  id: 'nell',
  name: 'Nell',
  description: 'Kept the light with Tomas, and keeps it still.',
  enabled: true,
};
const TOMAS: Character = {
  id: 'tomas',
  name: 'Tomas',
  description: 'The keeper before her father, seventy, deaf on one side.',
  enabled: true,
};
const ISA: Character = {
  id: 'isa',
  name: 'Isa',
  description: 'The harbourmaster’s daughter, and nobody’s friend.',
  enabled: true,
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

function chapter(messages: ChapterMessage[] = []): Chapter {
  return {
    ...newChapter('story', 1, 'The keeper’s cottage, late afternoon, low tide.'),
    messages,
  };
}

function said(role: 'user' | 'assistant', content: string, speakerId?: string): ChapterMessage {
  return { id: `${role}-${content}`, role, content, createdAt: '', speakerId };
}

function switched(cast: CastChange): ChapterMessage {
  return {
    id: `cast-${cast.activeCharacterId}`,
    kind: 'cast',
    role: 'system',
    content: '',
    createdAt: '',
    cast,
  };
}

function build(story: Story, chapter: Chapter) {
  return buildPrompt({ story, chapter, params: DEFAULT_GENERATION, estimator: heuristicEstimator });
}

function system(story: Story, chapter: Chapter): string {
  return build(story, chapter).messages[0].content;
}

describe('ensemble casting', () => {
  /**
   * The prompt as it stood before casting was a choice, written out in full.
   * A story that never answered the question is an ensemble, and an ensemble
   * has to be byte for byte what it always was — an existing story cannot
   * start getting different answers because the app learned a new trick.
   */
  const ALWAYS =
    'You are playing Nell and Tomas. Answer in character, in the first person, as they would speak and act.\n' +
    'Nell: Kept the light with Tomas, and keeps it still.\n' +
    'Tomas: The keeper before her father, seventy, deaf on one side.\n' +
    '\n' +
    'The user plays Mara: a marine biologist\n' +
    '\n' +
    'Chapter 1. The scene:\nThe keeper’s cottage, late afternoon, low tide.\n' +
    '\n' +
    'Write dialogue in "double quotes" and everything else as plain prose. ' +
    'Give each spoken line a paragraph of its own. ' +
    'Aim for two or three paragraphs per reply. ' +
    'Stay in character, and never write words, thoughts or actions for Mara.';

  it('sends the prompt it has always sent', () => {
    expect(system(troupe(), chapter())).toBe(ALWAYS);
  });

  it('is what a story that has never heard of casting gets', () => {
    const old = troupe();
    // Exactly what `normaliseStory` puts on a document from before this
    // version: the field, at its default, and nothing else disturbed.
    expect(old.roleplay).toEqual({ casting: 'ensemble', activeCharacterId: '' });
    expect(isOneAtATime(old)).toBe(false);
  });

  it('ignores the records of a cast that changed, and answers for nobody', () => {
    const story = troupe();
    const built = build(
      story,
      chapter([
        said('user', 'I knock.'),
        switched({ activeCharacterId: 'tomas', enabled: ['nell', 'tomas'] }),
        said('assistant', 'No answer.'),
      ]),
    );
    expect(built.castNotes).toEqual([]);
    expect(built.messages.filter((m) => m.role === 'system')).toHaveLength(1);
    expect(built.dropped).toBe(0);
    expect(system(story, chapter())).toBe(ALWAYS);
  });
});

describe('one character at a time', () => {
  const solo = (patch: Partial<Story> = {}) =>
    troupe({
      roleplay: { casting: 'one-at-a-time', activeCharacterId: 'nell' },
      characters: [NELL, TOMAS, ISA],
      ...patch,
    });

  it('names the one it plays, and the ones it may only describe', () => {
    const text = system(solo(), chapter());
    expect(text).toContain('You are playing Nell, and nobody else.');
    expect(text).toContain('Nell: Kept the light with Tomas');
    expect(text).toContain('Also in the scene: Tomas and Isa.');
    expect(text).toContain('never speak or act for them');
    // The others are described, so the model knows what it is describing.
    expect(text).toContain('Tomas: The keeper before her father');
  });

  it('extends the rule about the user to everybody else on stage', () => {
    expect(system(solo(), chapter())).toContain(
      'never write words, thoughts or actions for Mara, Tomas or Isa',
    );
  });

  it('falls back to the first character in the scene when nobody is named', () => {
    const nobody = solo({ roleplay: { casting: 'one-at-a-time', activeCharacterId: '' } });
    expect(activeCharacter(nobody)?.id).toBe('nell');

    // And when the named one has left it, rather than leaving no voice at all.
    const gone = solo({
      characters: [{ ...NELL, enabled: false }, TOMAS],
      roleplay: { casting: 'one-at-a-time', activeCharacterId: 'nell' },
    });
    expect(activeCharacter(gone)?.id).toBe('tomas');
    expect(system(gone, chapter())).toContain('You are playing Tomas, and nobody else.');
  });

  it('says nothing special when there is one character and nobody else', () => {
    const alone = solo({ characters: [NELL] });
    const text = system(alone, chapter());
    expect(text).toContain('You are playing Nell, and nobody else.');
    expect(text).not.toContain('Also in the scene');
    expect(text).toContain('never write words, thoughts or actions for Mara.');
  });
});

describe('the cast changing mid-chapter', () => {
  const solo = troupe({
    characters: [NELL, TOMAS, ISA],
    roleplay: { casting: 'one-at-a-time', activeCharacterId: 'tomas' },
  });
  const everyone = ['nell', 'tomas', 'isa'];

  it('tells the model at the point it happened, and disowns the voice above', () => {
    const built = build(
      solo,
      chapter([
        said('user', 'I knock.'),
        said('assistant', 'Nobody answers.', 'nell'),
        switched({
          activeCharacterId: 'tomas',
          enabled: everyone,
          was: { activeCharacterId: 'nell', enabled: everyone },
        }),
        said('user', 'I try the latch.'),
      ]),
    );

    expect(built.castNotes).toEqual([
      'From here you play Tomas. Nell is no longer the character you play; ' +
        "everything above in Nell's voice was Nell, not you.",
    ]);
    // Third of the four sent, which is where it happened — the history above
    // it is left exactly as it was written.
    expect(built.messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'system',
      'user',
    ]);
    expect(built.messages[3].content).toContain('From here you play Tomas.');
    // A note is not a turn, so nothing counts as having been dropped.
    expect(built.dropped).toBe(0);
  });

  it('says who has left and who has joined', () => {
    const left = build(
      solo,
      chapter([
        said('user', 'I knock.'),
        switched({
          activeCharacterId: 'tomas',
          enabled: ['nell', 'tomas'],
          was: { activeCharacterId: 'tomas', enabled: everyone },
        }),
      ]),
    );
    expect(left.castNotes).toEqual(['Isa has left the scene.']);

    const back = build(
      solo,
      chapter([
        said('user', 'I knock.'),
        switched({
          activeCharacterId: 'tomas',
          enabled: everyone,
          was: { activeCharacterId: 'tomas', enabled: ['nell', 'tomas'] },
        }),
      ]),
    );
    expect(back.castNotes).toEqual(['Isa joins the scene.']);
  });

  it('says the switch first and the coming and going after it', () => {
    const built = build(
      solo,
      chapter([
        said('user', 'I knock.'),
        switched({
          activeCharacterId: 'tomas',
          enabled: ['tomas', 'isa'],
          was: { activeCharacterId: 'nell', enabled: ['nell', 'tomas'] },
        }),
      ]),
    );
    const note = built.castNotes[0];
    expect(note).toContain('From here you play Tomas.');
    expect(note).toContain('Nell has left the scene.');
    expect(note).toContain('Isa joins the scene.');
    expect(note.indexOf('From here')).toBeLessThan(note.indexOf('has left'));
  });

  it('stays quiet about a change it cannot see the other side of', () => {
    // No `was`: the opening state of the chapter was never written down, so
    // the switch is announced and nothing is invented about who moved.
    const built = build(
      solo,
      chapter([
        said('user', 'I knock.'),
        switched({ activeCharacterId: 'tomas', enabled: everyone }),
      ]),
    );
    expect(built.castNotes).toEqual(['From here you play Tomas.']);
  });
});

describe('a chapter written before any of this', () => {
  it('reads exactly as it did: no kind, no speaker, no notes', () => {
    const messages = [said('user', 'I knock.'), said('assistant', 'No answer.')];
    expect(messages.every((m) => m.kind === undefined && m.speakerId === undefined)).toBe(true);

    const built = build(troupe(), chapter(messages));
    expect(built.messages.slice(1).map((m) => m.content)).toEqual(['I knock.', 'No answer.']);
    expect(built.castNotes).toEqual([]);
  });
});

describe('the summariser', () => {
  it('is told who spoke, so it can attribute what was said', () => {
    const solo = troupe({
      roleplay: { casting: 'one-at-a-time', activeCharacterId: 'nell' },
    });
    const user = buildSummaryPrompt(
      solo,
      chapter([
        said('user', 'I knock.'),
        said('assistant', '"Come in," she says.', 'nell'),
        switched({ activeCharacterId: 'tomas', enabled: ['nell', 'tomas'] }),
        said('assistant', 'The old man does not look up.', 'tomas'),
      ]),
    )[1].content;

    expect(user).toContain('Reader: I knock.');
    expect(user).toContain('Nell: "Come in," she says.');
    expect(user).toContain('Tomas: The old man does not look up.');
    // A record of the cast changing has nothing in it to summarise.
    expect(user).not.toContain('\n\n: ');
  });

  it('still says Story for an ensemble, which is who wrote it', () => {
    const user = buildSummaryPrompt(
      troupe(),
      chapter([said('user', 'I knock.'), said('assistant', 'No answer.')]),
    )[1].content;
    expect(user).toContain('Reader: I knock.');
    expect(user).toContain('Story: No answer.');
  });
});
