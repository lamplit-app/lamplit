import {
  AUTHOR_DIRECTIONS_PROMPT,
  DEFAULT_NARRATOR_PROMPT,
  DEFAULT_ROLEPLAY_PROMPT,
  DEFAULT_SUMMARY_INSTRUCTION,
  REPLY_LENGTH_HINTS,
} from './defaults';
import {
  BlockId,
  Chapter,
  ChapterMessage,
  Character,
  GenerationParams,
  Instruction,
  LoreEntry,
  OutboundMessage,
  Story,
} from './models';
import { TokenEstimator } from './tokens';

export type { BlockId };

// ---------------------------------------------------------------------------
// The order of the system prompt
// ---------------------------------------------------------------------------

/**
 * Three blocks are fixed and four are not.
 *
 * The mode preamble opens because it says what the model *is*, and everything
 * after it is read as instructions to that. The style rules close because the
 * instruction nearest the conversation is the one a model holds onto, and the
 * author's directions close after even those, because they outrank them. What
 * sits between them all describes the story, and which of those a given model
 * weighs most is a matter of taste — so it is the writer's, per story.
 */
export const PINNED_FIRST: readonly BlockId[] = ['mode'];
export const MOVABLE_BLOCKS: readonly BlockId[] = ['persona', 'story-so-far', 'lore', 'scene'];
export const PINNED_LAST: readonly BlockId[] = ['style', 'author'];

/** Why a block has no handle, in the preview's own words. */
export const PIN_REASONS: Record<string, string> = {
  mode: 'Always first: it says what the model is, and the rest is read as instructions to that.',
  style: 'Always last: the instruction closest to the conversation is the one that sticks.',
  author:
    'Only when the chapter carries a direction, and never anywhere but here: a direction ' +
    'outranks every instruction above it, and no instruction is put after it.',
  'lore-fired':
    'After your message, on its own: an entry a keyword fired comes and goes as the story ' +
    'moves, and a block that changes must not sit in front of everything that does not. ' +
    'World facts are not instructions, so nothing here competes with a direction.',
};

/**
 * The movable blocks in this story's order.
 *
 * A stored list is used only when it names every movable block exactly once.
 * Anything else — a block a later version added, one this build has dropped, a
 * name from nowhere, a duplicate — means the document and this build disagree
 * about what the prompt is made of, and there is no safe way to guess which
 * half is right. The shipped order is the answer that is always a valid one.
 */
export function movableOrder(story: Pick<Story, 'promptOrder'>): BlockId[] {
  const stored = story.promptOrder;
  if (!Array.isArray(stored) || stored.length !== MOVABLE_BLOCKS.length) {
    return [...MOVABLE_BLOCKS];
  }
  const named = new Set(stored);
  if (named.size !== stored.length) return [...MOVABLE_BLOCKS];
  if (!MOVABLE_BLOCKS.every((id) => named.has(id))) return [...MOVABLE_BLOCKS];
  return [...stored];
}

/** The whole order, pinned ends included, as the builder assembles it. */
export function blockOrder(story: Pick<Story, 'promptOrder'>): BlockId[] {
  return [...PINNED_FIRST, ...movableOrder(story), ...PINNED_LAST];
}

/** True when this story sends the blocks in the order the app ships with. */
export function isDefaultOrder(story: Pick<Story, 'promptOrder'>): boolean {
  const order = movableOrder(story);
  return MOVABLE_BLOCKS.every((id, i) => order[i] === id);
}

/**
 * The order to store when the preview's own rows have been dragged into
 * `shown`.
 *
 * A block with nothing in it is not drawn, so what is on screen is only part
 * of the story's order: the shown blocks are written back into the slots they
 * occupied, which leaves the invisible ones exactly where they were. An empty
 * persona should not jump about because the world moved.
 *
 * Here rather than in the sheet that drags them because it is an invariant of
 * `promptOrder` — the same one `movableOrder` above enforces from the other
 * side — and because it is the only part of that sheet a spec can hold.
 */
export function movableOrderFrom(story: Pick<Story, 'promptOrder'>, shown: BlockId[]): BlockId[] {
  const order = movableOrder(story);
  const slots = order.flatMap((id, i) => (shown.includes(id) ? [i] : []));
  const next = [...order];
  slots.forEach((slot, i) => {
    const id = shown[i];
    if (id) next[slot] = id;
  });
  return next;
}

export interface PromptBlock {
  id: BlockId;
  label: string;
  content: string;
  tokens: number;
}

/**
 * The block that is not one of those: the entries a keyword fired, sent as a
 * `system` message after the new line.
 *
 * Its own shape rather than an eighth `BlockId`, because it is a different
 * kind of thing — it is not part of the system message, it has no slot in
 * `promptOrder`, and nothing can be dragged above or below it. What it shares
 * with a block is that the preview draws it and prices it, which is these four
 * fields and no more.
 */
export interface TailBlock {
  id: 'lore-fired';
  label: string;
  content: string;
  tokens: number;
}

/** Why an entry is in this request, for the "What the model sees" modal. */
export interface LoreHit {
  entry: LoreEntry;
  /** The key that matched, or empty when the entry is always on. */
  key: string;
  where: 'always on' | 'scene' | 'message' | 'draft';
}

export interface PromptInput {
  story: Story;
  chapter: Chapter;
  /** The message about to be sent; counted, and appended as the last turn. */
  draft?: string;
  /** The direction about to be sent with it, if the composer has one open. */
  draftDirection?: string;
  /** History to use instead of the chapter's own, for regenerate and replay. */
  messages?: readonly ChapterMessage[];
  params: GenerationParams;
  estimator: TokenEstimator;
}

export interface BuiltPrompt {
  messages: OutboundMessage[];
  /** The blocks of the leading system message, in this story's order. */
  blocks: PromptBlock[];
  /**
   * The one block that is not in it: the entries a keyword fired, sent as a
   * `system` message after the new line rather than before the chapter. Absent
   * when nothing fired, which is every story whose world is always-on.
   */
  afterTheLine?: TailBlock;
  lore: LoreHit[];
  /**
   * What the model is told, mid-history, about the cast changing. Empty in
   * every casting but one at a time, where a switch has to be understood
   * rather than guessed at from a change of voice.
   */
  castNotes: string[];
  tokens: {
    system: number;
    history: number;
    draft: number;
    total: number;
    budget: number;
    reserve: number;
  };
  /** History messages the budget forced out of this request. */
  dropped: number;
}

/**
 * The whole prompt, rebuilt from data. Pure: same documents in, same request
 * out, which is what makes edit / regenerate / replay a single code path and
 * lets the preview modal show exactly what the next send will carry.
 */
export function buildPrompt(input: PromptInput): BuiltPrompt {
  const { story, chapter, params, estimator } = input;
  const history = input.messages ?? chapter.messages;
  const draft = (input.draft ?? '').trim();
  const draftDirection = (input.draftDirection ?? '').trim();

  // The block is there when the chapter carries a direction, and the moment
  // the composer has one open: the preview has to show the request that is
  // about to go out rather than the one that would have gone a message ago.
  const directions = !!draftDirection || history.some((m) => m.direction?.trim() && !m.meta?.error);

  // Lore is scanned over the story's own words. A direction is about the story
  // rather than in it, so it fires nothing.
  const lore = activeLore(story, chapter, history, draft);

  // Split by what can change mid-chapter. An always-on entry is on for the
  // whole chapter, so it can sit in the leading block without ever rewriting
  // it. A keyed entry fires and stops firing as the scan window slides, and a
  // block that changes at the front of the prompt makes a prompt the provider
  // has never seen before — so those go last instead. See `PIN_REASONS`.
  const standing = lore.filter((hit) => hit.where === 'always on');
  const fired = lore.filter((hit) => hit.where !== 'always on');

  const blocks = systemBlocks(story, chapter, standing, directions, estimator);
  const system = blocks.map((b) => b.content).join('\n\n');
  const systemMessage: OutboundMessage[] = system ? [{ role: 'system', content: system }] : [];

  const firedContent = loreBlock(fired);
  const afterTheLine: TailBlock | undefined = firedContent
    ? {
        id: 'lore-fired',
        label: 'World, as it came up',
        content: firedContent,
        tokens: estimator.count(firedContent),
      }
    : undefined;
  const tailMessage: OutboundMessage[] = afterTheLine
    ? [{ role: 'system', content: afterTheLine.content }]
    : [];

  // Counted with the system message rather than beside it: `system` is what
  // the request costs before a word of the chapter is in it, and the budget
  // below has to subtract every part of that or it overruns by the size of
  // the world.
  const systemTokens = estimator.countMessages([...systemMessage, ...tailMessage]);
  const draftContent = withDirection(draft, draftDirection);
  const draftMessage: OutboundMessage[] = draftContent
    ? [{ role: 'user', content: draftContent }]
    : [];
  const draftTokens = estimator.countMessages(draftMessage);

  const reserve = params.maxResponseTokens;
  const budget = Math.max(0, params.maxContextTokens - reserve - systemTokens - draftTokens);

  const usable = outboundHistory(story, history);
  const start = historyStart(usable, budget, !!draftContent, estimator);
  const kept = usable.slice(start).map((entry) => entry.message);
  const historyTokens = estimator.countMessages(kept);
  const sent = usable.slice(start).filter((entry) => !entry.note).length;

  return {
    // The keyed world goes after the new line rather than between the history
    // and it: injected before the line it would sit exactly where the
    // *previous* turn's message sits next time, so the match would stop a turn
    // early and that message would be paid for twice. Last keeps everything
    // but genuinely new content identical from one request to the next.
    messages: [...systemMessage, ...kept, ...draftMessage, ...tailMessage],
    blocks,
    afterTheLine,
    lore,
    castNotes: usable.filter((entry) => entry.note).map((entry) => entry.message.content),
    tokens: {
      system: systemTokens,
      history: historyTokens,
      draft: draftTokens,
      total: systemTokens + historyTokens + draftTokens,
      budget: params.maxContextTokens,
      reserve,
    },
    // Only the turns count as dropped: a note is not something the writer
    // wrote, and a chapter that lost one has not lost a word of itself.
    dropped: usable.filter((entry) => !entry.note).length - sent,
  };
}

/**
 * How many messages the window gives up when the budget forces it to give up
 * any: eight, or four turns, rather than the one it used to.
 *
 * One at a time is the obvious rule and the expensive one. Once a chapter
 * passes the budget, every subsequent turn drops exactly one more message off
 * the front, so no two consecutive requests open with the same bytes and the
 * provider's prefix cache goes to zero precisely when the prompt is at its
 * largest. Dropping a block instead, and keeping that window until it stops
 * fitting, breaks the prefix occasionally rather than always.
 *
 * The window opens on a multiple of this, counted from the chapter's first
 * message — a grid, not an offset. That is what makes it stable: appending a
 * turn never moves an earlier message's index, so the same grid line stays the
 * same message for as long as it is chosen. A boundary computed as a fraction
 * of the window would be recomputed from a list that grew, and would move
 * every turn, which is the thing being fixed.
 */
const TRIM_BLOCK = 8;

/**
 * Where the sent history opens: the index into `usable` of the oldest message
 * this request carries.
 *
 * Two rules, in order. The budget's: walking back from the newest, the oldest
 * message that still fits. And then the grid's: round that forward to a block
 * boundary, and on to the start of a turn, so the same window is chosen again
 * next time and the time after.
 *
 * The grid is only used when a block is a small part of what fits — a quarter
 * or less. Under that, rounding forward would throw away most of a short
 * window to save a cache that a prompt this size was never going to fill, so a
 * tight budget trims exactly as it always did.
 */
function historyStart(
  usable: readonly { message: OutboundMessage; note: boolean }[],
  budget: number,
  hasDraft: boolean,
  estimator: TokenEstimator,
): number {
  const costs = usable.map((entry) => estimator.countMessages([entry.message]));

  let fits = usable.length;
  let running = 0;
  for (let i = usable.length - 1; i >= 0; i--) {
    if (running + costs[i]! > budget) break;
    running += costs[i]!;
    fits = i;
  }

  let start = fits;
  if (start > 0 && usable.length - fits >= TRIM_BLOCK * 4) {
    const grid = Math.min(usable.length, Math.ceil(start / TRIM_BLOCK) * TRIM_BLOCK);
    // And on to a whole turn: a window that opens on a reply reads as an
    // answer to a question nobody asked.
    let turn = grid;
    while (turn < usable.length && usable[turn]!.message.role !== 'user') turn++;
    start = turn < usable.length ? turn : grid;
  }

  // The message being sent is never dropped for the budget's sake, and neither
  // is the newest message when there is no draft to send instead of it: a
  // request with nothing in it is not a smaller request, it is a different one.
  if (start >= usable.length && !hasDraft && usable.length) return usable.length - 1;
  return start;
}

/**
 * The chapter's own list as the request will carry it: the turns worth
 * sending, with a system note at each point the cast changed.
 *
 * In every casting but one at a time this is exactly the filter it has always
 * been — a cast record has no words in it, so it falls out of the same test
 * that drops an empty placeholder, and the request is unchanged.
 */
function outboundHistory(
  story: Story,
  history: readonly ChapterMessage[],
): { message: OutboundMessage; note: boolean }[] {
  const telling = isOneAtATime(story);
  const out: { message: OutboundMessage; note: boolean }[] = [];
  for (const message of history) {
    if (message.kind === 'cast') {
      const note = telling && message.cast ? castNote(message.cast, story.characters) : '';
      if (note) out.push({ message: { role: 'system', content: note }, note: true });
      continue;
    }
    const content = withDirection(message.content, message.direction);
    if (!content || message.meta?.error) continue;
    out.push({ message: { role: message.role, content }, note: false });
  }
  return out;
}

/**
 * How a direction reaches the model: the prose, a blank line, and the
 * direction in brackets — or the bracketed line alone, when the author said
 * nothing as their persona. One outbound message either way, so the budget
 * drops a turn and its direction together or keeps them together.
 */
export function withDirection(content: string, direction: string | undefined): string {
  const prose = content.trim();
  const said = direction?.trim();
  if (!said) return prose;
  return prose ? `${prose}\n\n[Author: ${said}]` : `[Author: ${said}]`;
}

/**
 * The other half of that grammar: `[AUTHOR]` at the start of a line takes that
 * line and everything after it out of the prose.
 *
 * `null` when there is no tag, which is the common case and the one the caller
 * has nothing to do about. The tag is a shorthand for the button beside Send
 * rather than a syntax of the story's — the composer splits as it is typed and
 * shows both halves, so what leaves the box is always what the writer can see
 * in it — and it lives here beside the function that puts the two halves back
 * together, because one half of a grammar in core and the other in a component
 * is how the two come to disagree.
 *
 * Case-insensitive and multiline: the tag can open the draft or begin any line
 * of it, with leading spaces or tabs, and it takes the rest of the draft with
 * it. Whatever was typed before it is the prose, with the whitespace that ran
 * up to the tag dropped.
 */
export function splitDirection(typed: string): { prose: string; direction: string } | null {
  const match = /^[ \t]*\[author\][ \t]*/im.exec(typed);
  if (!match) return null;
  return {
    prose: typed.slice(0, match.index).replace(/\s+$/, ''),
    direction: typed.slice(match.index + match[0].length).trim(),
  };
}

/**
 * What the model is told at the point the cast changed. Short and firm: it is
 * read as an instruction, and the history above it is left exactly as it was
 * written — the model is told what it was, not handed a rewritten past.
 */
function castNote(change: NonNullable<ChapterMessage['cast']>, cast: readonly Character[]): string {
  const nameOf = (id: string) => cast.find((c) => c.id === id)?.name.trim() ?? '';
  const parts: string[] = [];

  const now = nameOf(change.activeCharacterId);
  const before = change.was ? nameOf(change.was.activeCharacterId) : '';
  if (now && now !== before) {
    parts.push(
      before
        ? `From here you play ${now}. ${before} is no longer the character you play; everything above in ${before}'s voice was ${before}, not you.`
        : `From here you play ${now}.`,
    );
  }

  // A change with no `was` is one this build cannot see the other side of, so
  // it reports the switch and stays quiet about who came and went.
  const was = new Set(change.was?.enabled ?? change.enabled);
  const is = new Set(change.enabled);
  for (const id of was) {
    if (!is.has(id) && nameOf(id)) parts.push(`${nameOf(id)} has left the scene.`);
  }
  for (const id of is) {
    if (!was.has(id) && nameOf(id)) parts.push(`${nameOf(id)} joins the scene.`);
  }

  return parts.join(' ');
}

/** True when the model is playing one character rather than the whole room. */
export function isOneAtATime(story: Pick<Story, 'mode' | 'roleplay'>): boolean {
  return story.mode === 'roleplay' && story.roleplay.casting === 'one-at-a-time';
}

/**
 * Who the model is playing. Naming nobody, or naming somebody who is not in
 * the scene, falls back to the first character who is — a story is never left
 * with a voice it cannot use.
 */
export function activeCharacter(story: Pick<Story, 'characters' | 'roleplay'>): Character | null {
  const cast = story.characters.filter((c) => c.enabled && c.name.trim());
  const named = cast.find((c) => c.id === story.roleplay.activeCharacterId);
  return named ?? cast[0] ?? null;
}

/**
 * The summarisation request behind "Close chapter". It carries the story so far
 * as it stands, because the answer replaces it rather than being appended to
 * it — which is what keeps the summary one readable page however long the story
 * runs.
 */
export function buildSummaryPrompt(story: Story, chapter: Chapter): OutboundMessage[] {
  const existing = story.world.storySoFar.trim();
  const title = chapter.title.trim();
  const parts: string[] = [
    existing
      ? `The story so far, as it stands:\n${existing}`
      : 'There is no summary of the story yet: this is the first chapter to fold in.',
    `${chapterName(chapter)}${title ? `, ${title}` : ''} has just finished.`,
  ];
  if (chapter.scene.trim()) parts.push(`The scene it opened on:\n${chapter.scene.trim()}`);
  const transcript = chapterTranscript(story, chapter);
  parts.push(`What happened in it:\n${transcript || '(nothing was written in this chapter)'}`);

  return [
    {
      role: 'system',
      content: 'You keep the running summary of an ongoing story, accurately and plainly.',
    },
    { role: 'user', content: `${parts.join('\n\n')}\n\n${summaryInstruction(story)}` },
  ];
}

/**
 * The chapter as prose, for the requests that read it back rather than
 * continue it — the summary, and the lore proposals.
 *
 * A cast record has nothing to read; who was speaking does, so a line written
 * by one character is attributed to them and not to the story. A direction is
 * left out entirely — it shaped what happened, it is not part of what
 * happened — which also drops a message that was nothing but one.
 */
export function chapterTranscript(story: Story, chapter: Chapter): string {
  return chapter.messages
    .filter((m) => m.kind !== 'cast' && m.content.trim() && !m.meta?.error)
    .map((m) => `${speakerLabel(story, m)}: ${m.content.trim()}`)
    .join('\n\n');
}

/** Whose line this is: the reader, a named character, or the story itself. */
function speakerLabel(story: Story, message: ChapterMessage): string {
  if (message.role === 'user') return 'Reader';
  const speaker = story.characters.find((c) => c.id === message.speakerId);
  return speaker?.name.trim() || 'Story';
}

// ---------------------------------------------------------------------------
// The three instructions the writer may take over
// ---------------------------------------------------------------------------
//
// The narrator's preamble, the one above a role-play's cast and the instruction
// a chapter is closed with are the same object three times: ours until the
// writer says otherwise, theirs after that. Each is asked about in three or
// four places — the block builder below, the chapter panel, the sheet that
// edits it, the sheet that uses it — and every one of those has to give the
// same answer the request does, because the guide promises that what "What the
// model sees" shows is what goes on the wire.
//
// It did not. The panel showed `useDefault ? ours : theirs` while the request
// sent `useDefault || nothing-written ? ours : theirs`, so a story with the
// override on and the box emptied showed an empty narrator and was sent the
// default. These three are what everything asks now.

/**
 * Whether that instruction is the one Lamplit ships.
 *
 * An override with an empty box is not an instruction, it is a box somebody
 * emptied — and the alternative to falling back is a request with no preamble
 * at all, which nobody asked for. So this is the honest answer to what is
 * *being sent*, and it is what a box dims for.
 */
export function isDefaultInstruction(chosen: Instruction): boolean {
  return chosen.useDefault || !chosen.prompt.trim();
}

/** Ours, or the writer's own once they have overridden it and written one. */
export function narratorInstruction(story: Pick<Story, 'narrator'>): string {
  return instructionOf(story.narrator, DEFAULT_NARRATOR_PROMPT);
}

/** And the same for how a role-play's characters are played. */
export function roleplayInstruction(story: Pick<Story, 'roleplay'>): string {
  return instructionOf(story.roleplay.instruction, DEFAULT_ROLEPLAY_PROMPT);
}

/** And the same for the instruction a chapter is closed with. */
export function summaryInstruction(story: Pick<Story, 'world'>): string {
  return instructionOf(story.world.summary, DEFAULT_SUMMARY_INSTRUCTION);
}

function instructionOf(chosen: Instruction, ours: string): string {
  return isDefaultInstruction(chosen) ? ours : chosen.prompt.trim();
}

/**
 * And what to store when the "write my own" switch is thrown, which was the
 * same six lines under Story and under World.
 *
 * Turning it on starts from ours rather than from an empty box: somebody who
 * wants their own words almost always wants to edit ours, and a blank page is
 * not an offer. Turning it off keeps what was written, so the switch is a way
 * back rather than a delete — which is what makes it safe to throw twice.
 */
export function overriding(chosen: Instruction, own: boolean, ours: string): Instruction {
  return { useDefault: !own, prompt: chosen.prompt || (own ? ours : '') };
}

// ---------------------------------------------------------------------------
// What a chapter is called, and what was written in it
// ---------------------------------------------------------------------------
//
// Here because the builder names a chapter twice itself — the scene block and
// the instruction a chapter is closed with both open with it — and because the
// app was composing the heading by hand in four components at two different
// fallback rules. The em dash is the app's own and never goes to the model: the
// two prompt sites use a comma, and say so where they are written.

/** A chapter with no title of its own is known by its scene's first line. */
export function chapterTitle(chapter: Pick<Chapter, 'title' | 'scene'>): string {
  return chapter.title.trim() || firstLine(chapter.scene);
}

/** What a chapter is called with nothing but its place in the story to go by. */
export function chapterName(chapter: Pick<Chapter, 'number'>): string {
  return `Chapter ${chapter.number}`;
}

/** Its place and its name: the heading the app puts over a chapter. */
export function chapterHeading(chapter: Pick<Chapter, 'number' | 'title' | 'scene'>): string {
  const title = chapterTitle(chapter);
  return title ? `${chapterName(chapter)} — ${title}` : chapterName(chapter);
}

/**
 * What was written in a chapter. The records of the cast changing are in the
 * list but are not of it: they carry no words, they are nobody's turn, and a
 * chapter's size is what was written in it.
 */
export function writtenIn(chapter: Pick<Chapter, 'messages'>): ChapterMessage[] {
  return chapter.messages.filter((m) => m.kind !== 'cast');
}

/** The scene's opening line, trimmed to something a list row can hold. */
export function firstLine(scene: string, max = 80): string {
  const line = scene.trim().split('\n')[0]?.trim() ?? '';
  if (line.length <= max) return line;
  return `${line.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

function systemBlocks(
  story: Story,
  chapter: Chapter,
  lore: readonly LoreHit[],
  directions: boolean,
  estimator: TokenEstimator,
): PromptBlock[] {
  const made: Record<BlockId, { label: string; content: string }> = {
    mode: {
      label: story.mode === 'narrator' ? 'Narrator' : 'Role-play',
      content: modeBlock(story),
    },
    persona: { label: 'Persona', content: personaBlock(story) },
    'story-so-far': { label: 'The story so far', content: storySoFarBlock(story) },
    lore: { label: 'World', content: loreBlock(lore) },
    scene: { label: 'This chapter', content: sceneBlock(chapter) },
    style: { label: 'Style', content: styleBlock(story) },
    // Fixed words, and the only block whose presence is decided by the
    // chapter rather than by the story: a chapter with no direction in it
    // sends nothing about directions.
    author: { label: 'Author', content: directions ? AUTHOR_DIRECTIONS_PROMPT : '' },
  };
  // A block with nothing in it is not a block: an empty persona should not
  // cost a blank line in the system message, nor a row in the preview.
  return blockOrder(story)
    .map((id) => ({ id, ...made[id] }))
    .filter((block) => block.content.trim())
    .map((block) => ({ ...block, tokens: estimator.count(block.content) }));
}

function modeBlock(story: Story): string {
  if (story.mode === 'narrator') return narratorInstruction(story);
  return [roleplayInstruction(story), castingLines(story)].join('\n\n');
}

/**
 * Who the model is playing, under the instruction that says how. Nothing here
 * says to answer in character or in the first person: the instruction above
 * says it once, for every casting, including the casting of nobody.
 *
 * That last one is why the no-cast line lost its own version of the sentence
 * as well. A story with nothing cast has no description under it to be in
 * character *as*, so "answer in character" was the emptiest place it was said
 * — and it is now said above, where it is said to every role-play story.
 */
function castingLines(story: Story): string {
  const cast = story.characters.filter((c) => c.enabled && c.name.trim());
  if (!cast.length) {
    return 'You play every character the story needs except the one the user plays.';
  }

  // One at a time: the model is one of them, and the rest are furniture it
  // can describe. Saying who else is there matters as much as saying who it
  // is — without it the scene empties out the moment the others stop speaking.
  const only = isOneAtATime(story) ? activeCharacter(story) : null;
  if (only) {
    const others = cast.filter((c) => c.id !== only.id);
    const lines = [
      `You are playing ${only.name.trim()}, and nobody else.`,
      `${only.name.trim()}: ${only.description.trim() || '(no description)'}`,
    ];
    if (others.length) {
      lines.push(
        `Also in the scene: ${joinNames(others.map((c) => c.name.trim()))}. Describe what they do as ${only.name.trim()} sees it, and never speak or act for them.`,
      );
      for (const character of others) {
        lines.push(
          `${character.name.trim()}: ${character.description.trim() || '(no description)'}`,
        );
      }
    }
    return lines.join('\n');
  }

  const lines = [`You are playing ${joinNames(cast.map((c) => c.name.trim()))}.`];
  for (const character of cast) {
    lines.push(`${character.name.trim()}: ${character.description.trim() || '(no description)'}`);
  }
  return lines.join('\n');
}

function personaBlock(story: Story): string {
  const name = story.persona.name.trim();
  const description = story.persona.description.trim();
  if (!name && !description) return '';
  if (!description) return `The user plays ${name}.`;
  return `The user plays ${name || 'the reader'}: ${description}`;
}

function storySoFarBlock(story: Story): string {
  const text = story.world.storySoFar.trim();
  return text ? `The story so far:\n${text}` : '';
}

function loreBlock(lore: readonly LoreHit[]): string {
  if (!lore.length) return '';
  const lines = lore.map((hit) => `- ${hit.entry.title.trim()}: ${hit.entry.content.trim()}`);
  return `What is true in this world:\n${lines.join('\n')}`;
}

/**
 * The chapter, as the model is told about it. Exported and over a `Pick`
 * because the scene sheet costs this exact string as it is typed — it used to
 * cost a copy of it, which wrote the comma whether or not there was a title for
 * it to follow.
 */
export function sceneBlock(chapter: Pick<Chapter, 'number' | 'title' | 'scene'>): string {
  const scene = chapter.scene.trim();
  if (!scene) return '';
  const title = chapter.title.trim();
  return `${chapterName(chapter)}${title ? `, ${title}` : ''}. The scene:\n${scene}`;
}

function styleBlock(story: Story): string {
  return [
    'Write dialogue in "double quotes" and everything else as plain prose.',
    story.style.dialogueOnOwnLine ? 'Give each spoken line a paragraph of its own.' : '',
    REPLY_LENGTH_HINTS[story.style.replyLength],
    story.mode === 'roleplay'
      ? `Stay in character, and never write words, thoughts or actions for ${joinNames(offLimits(story), 'or')}.`
      : 'Stay inside the story: no notes to the reader, no asking what they would like next.',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Keyword scan over the scene, the draft and the last N messages. The scene is
 * in the window on purpose: an entry named there fires on the first message of
 * the chapter rather than only once someone mentions it again.
 */
function activeLore(
  story: Story,
  chapter: Chapter,
  history: readonly ChapterMessage[],
  draft: string,
): LoreHit[] {
  const scan = story.world.scan;
  const recent = scan.depth > 0 ? history.slice(-scan.depth) : [];
  const windows: { where: LoreHit['where']; text: string }[] = [
    { where: 'scene', text: chapter.scene },
    { where: 'message', text: recent.map((m) => m.content).join('\n') },
    { where: 'draft', text: draft },
  ];

  const hits: LoreHit[] = [];
  for (const entry of story.world.entries) {
    // An entry is the sentence it contributes, so one with no text cannot
    // fire. The World modal marks those as unfinished rather than hiding it.
    if (!entry.enabled || !entry.content.trim()) continue;
    if (entry.alwaysOn) {
      hits.push({ entry, key: '', where: 'always on' });
      continue;
    }
    const caseSensitive = entry.caseSensitive ?? scan.caseSensitive;
    const wholeWords = entry.matchWholeWords ?? scan.matchWholeWords;
    for (const window of windows) {
      const key = matchingKey(entry.keys, window.text, caseSensitive, wholeWords);
      if (key) {
        hits.push({ entry, key, where: window.where });
        break;
      }
    }
  }
  return hits;
}

function matchingKey(
  keys: readonly string[],
  text: string,
  caseSensitive: boolean,
  wholeWords: boolean,
): string {
  if (!text.trim()) return '';
  const haystack = caseSensitive ? text : text.toLowerCase();
  for (const raw of keys) {
    const key = raw.trim();
    if (!key) continue;
    const needle = caseSensitive ? key : key.toLowerCase();
    if (wholeWords ? wordPattern(needle).test(haystack) : haystack.includes(needle)) return key;
  }
  return '';
}

/** `\b` misbehaves next to punctuation, so guard both edges by hand. */
function wordPattern(needle: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(needle)}(?![\\p{L}\\p{N}_])`, 'u');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Who the model must not write for: the user always, and — when it is playing
 * one character — everybody else in the scene as well.
 */
function offLimits(story: Story): string[] {
  const user = story.persona.name.trim() || 'the user';
  const only = isOneAtATime(story) ? activeCharacter(story) : null;
  if (!only) return [user];
  const others = story.characters
    .filter((c) => c.enabled && c.name.trim() && c.id !== only.id)
    .map((c) => c.name.trim());
  return [user, ...others];
}

function joinNames(names: readonly string[], conjunction = 'and'): string {
  if (names.length === 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} ${conjunction} ${names[names.length - 1] ?? ''}`;
}
