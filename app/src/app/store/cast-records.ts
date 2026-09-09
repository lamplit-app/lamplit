import { CastChange, ChapterMessage, Story } from '../core/models';
import { activeCharacter } from '../core/prompt-builder';
import { newId, now } from './documents';

/**
 * The cast at one moment: who the model plays, and who is in the scene. Named
 * off the record that stores it, so the two can never say different things.
 */
export type CastState = NonNullable<CastChange['was']>;

/** Who is on stage, as a record of a change stores it. */
export function castState(story: Story): CastState {
  return {
    activeCharacterId: activeCharacter(story)?.id ?? '',
    enabled: story.characters.filter((c) => c.enabled).map((c) => c.id),
  };
}

export function sameCast(a: CastState | undefined, b: CastState): boolean {
  return (
    !!a &&
    a.activeCharacterId === b.activeCharacterId &&
    a.enabled.length === b.enabled.length &&
    a.enabled.every((id, i) => id === b.enabled[i])
  );
}

/**
 * The chapter's messages with a record of a change to the cast filed at the
 * end of them, or as they were if there is nothing left to tell anyone.
 *
 * The record carries the cast as it now stands *and* as it stood, so it says
 * what changed without being read next to its neighbours — a message deleted
 * or replayed between two of them must not change what either means. Two
 * changes with nothing written between them are one change, and it is the
 * older record that knows what the cast was before both, so the newer one
 * replaces it and takes its `was`.
 *
 * A function over the messages rather than a method on the store: three rules
 * about what a record means, none of which is about where chapters are kept,
 * and all three of them worth a test that does not need a store to run.
 */
export function withCastRecord(
  messages: readonly ChapterMessage[],
  story: Story,
  was: CastState,
): ChapterMessage[] {
  const kept = [...messages];
  const last = kept[kept.length - 1];
  const from = last?.kind === 'cast' ? (last.cast?.was ?? was) : was;
  if (last?.kind === 'cast') kept.pop();

  const cast = castState(story);
  // Clicked away and back again: there is no change left to tell anyone.
  if (sameCast(from, cast)) return kept;

  kept.push({
    id: newId(),
    kind: 'cast',
    role: 'system',
    content: '',
    createdAt: now(),
    cast: { ...cast, was: from },
  });
  return kept;
}
