/**
 * Persisted document shapes. Everything in here is written to storage as-is,
 * so treat these as a file format: add fields, never repurpose them.
 */

/**
 * The id of a row in `providers.ts`, or `custom` for a hand-typed URL. A plain
 * string on purpose: a settings file may name a provider a later version added
 * or an earlier one has dropped, and neither should stop it loading.
 */
export type Provider = string;

export interface ModelInfo {
  id: string;
  /** Friendly name when the endpoint offers one (NanoGPT's `?detailed=true`). */
  name?: string;
  ownedBy?: string;
  created?: number;
  contextLength?: number;
}

export interface ConnectionSettings {
  provider: Provider;
  baseUrl: string;
  /** Plain text on purpose: single user, local machine. See README. */
  apiKey: string;
  model: string;
  modelsCache: ModelInfo[];
  modelsFetchedAt?: string;
}

export interface GenerationParams {
  maxContextTokens: number;
  maxResponseTokens: number;
  temperature: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  stop: string[];
  seed?: number;
  // Advanced. Sent only when defined; NanoGPT and friends accept them.
  topK?: number;
  minP?: number;
  repetitionPenalty?: number;
  topA?: number;
  reasoningEffort?: ReasoningEffort;
}

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';

export type ThemeName = 'dark' | 'light';

/**
 * The names in the reading palette, mirroring `$palette` in `styles.scss`.
 * These are persisted as object keys, so they are part of the file format: a
 * name that goes away is simply ignored on load, and one that stays keeps its
 * meaning.
 */
export type ColourKey =
  | 'page'
  | 'surface'
  | 'surface-raised'
  | 'border'
  | 'ink'
  | 'ink-soft'
  | 'action'
  | 'muted'
  | 'accent'
  | 'speech'
  | 'danger';

/** Overrides only. An absent name keeps the colour the stylesheet ships. */
export type ThemeColours = Partial<Record<ColourKey, string>>;

/** The face the story is set in. All three come out of the system stack. */
export type ReadingFont = 'serif' | 'sans' | 'mono';

/**
 * How the app answers `prefers-contrast: more`, which `styles.scss` holds a
 * second palette for.
 *
 * Three states rather than two, because a machine's answer has to be
 * overridable in both directions: `system` is the reader's own setting, which
 * for almost everybody is right; `high` is somebody whose OS has no such
 * switch, or who wants it here and not everywhere; `normal` is somebody who
 * turned contrast up for the rest of their desktop and does not want this app
 * repainted, which is a fair thing to want — the shipped theme clears WCAG AA
 * on every pair of colours the story is read in, and the stronger set only
 * moves the rules.
 */
export type ContrastMode = 'system' | 'high' | 'normal';

/**
 * And the same for `prefers-reduced-motion`, which has two states and not
 * three. `system` and `reduced`; there is no "always animate".
 *
 * The asymmetry is the point. Declining the stronger contrast costs a reader
 * nothing they need — see `ContrastMode`. Overriding a reduced-motion
 * preference the other way would be the app putting back movement somebody's
 * machine was told to take away, which for a reader with a vestibular disorder
 * is the harm the preference exists to prevent. Nothing in Lamplit moves in
 * order to say something (see the rule at the foot of `styles.scss`), so there
 * is nothing on the other side of that trade to weigh against it.
 */
export type MotionMode = 'system' | 'reduced';

/**
 * The panel's sections, top to bottom. Persisted as object keys, so a name is
 * part of the file format: one this build does not know is ignored on load.
 */
export type PanelSection = 'scene' | 'narrator' | 'persona' | 'cast';

export interface UiSettings {
  theme: ThemeName;
  bookStyleDialogue: boolean;
  fontSize: number;
  showTokenCounts: boolean;
  /** Per theme, so the dark palette and the light one are edited separately. */
  colours: Partial<Record<ThemeName, ThemeColours>>;
  /**
   * A name from the page palettes, under the colours you set by hand. Empty is
   * the page as the stylesheet ships it, which is what every settings file
   * written before there were palettes says.
   */
  palette: string;
  font: ReadingFont;
  /** The stronger palette: the reader's machine, or this saying so. */
  contrast: ContrastMode;
  /** Motion turned down: the reader's machine, or this saying so. */
  motion: MotionMode;
  /**
   * Shows what the app is doing rather than what the story says: the context
   * pill and the prompt behind it, and the folder the documents are in. It
   * changes nothing about the request — see the preferences dialog.
   */
  developerMode: boolean;
  /**
   * Whether the server asks GitHub, once per start, whether a newer Lamplit
   * has been published. Off means it is not asked at all.
   */
  checkForUpdates: boolean;
  /**
   * Whether the desktop window reaches the model through the proxy this machine
   * is configured with. Off, and it connects directly, which is what every
   * other way of running Lamplit does. Only the desktop app can honour it; in a
   * browser tab the proxy is the browser's business and this is not shown.
   */
  systemProxy: boolean;
  /**
   * Whether each reply is read aloud as it finishes. A message can always be
   * read on request from its own menu; this is the one that needs no asking,
   * which is what a phone propped up across the room is for.
   */
  readAloud: boolean;
  /**
   * The voice to read in, by the name the device gives it. A name rather than
   * an index, because `settings.json` is shared with every device that has
   * scanned the code and none of them has the same list — an unknown name is
   * simply the device's own default.
   */
  voice: string;
  /** How fast it reads. 1 is the voice's own pace; see `SPEECH_RATE`. */
  speechRate: number;
  /** The chapter panel down the right-hand side; a thin edge when it is off. */
  sidebarOpen: boolean;
  /**
   * Folded-away sections only. An absent name is open, so the panel a fresh
   * install opens shows everything it has.
   */
  sidebarSections: Partial<Record<PanelSection, boolean>>;
}

export interface Settings {
  connection: ConnectionSettings;
  generation: GenerationParams;
  ui: UiSettings;
  activeStoryId: string | null;
  /**
   * The version whose upgrade notice has been seen. Written when the notice is
   * dismissed, so the same one never appears twice.
   */
  acknowledgedVersion: string | null;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface MessageMeta {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  finishReason?: string;
  aborted?: boolean;
  /**
   * Set when the reply ended early with words already on the page: the
   * provider errored mid-stream, or the connection went. The message is kept
   * and the footer says this, because the reader watched the text arrive.
   */
  interrupted?: string;
  /** Set when the turn failed; the bubble renders as an error with a retry. */
  error?: string;
  /**
   * Set when the turn was refused for being longer than the model's window.
   * The numbers are the endpoint's own and either may be missing; `budget` is
   * what the context setting was at the time, so the bubble says what was true
   * when it failed rather than what is true now. The bubble uses this to offer
   * the setting change — offer, not make: see `contextLimitOf`.
   */
  contextLimit?: { window?: number; requested?: number; budget: number };
}

/**
 * What a row in a chapter's list is. Absent — which is every row written by a
 * version before this one — is a message, so an old chapter reads unchanged.
 */
export type MessageKind = 'cast';

/**
 * A change to who is on stage, kept in the chapter's list at the point it
 * happened. `was` is the same pair as it stood before the change, so each
 * record says what changed on its own rather than by reading the one before
 * it — which a deleted or replayed message would otherwise take away.
 */
export interface CastChange {
  /** Who the model plays from here. Empty in ensemble casting. */
  activeCharacterId: string;
  /** Every character in the scene from here, by id. */
  enabled: string[];
  was?: { activeCharacterId: string; enabled: string[] };
}

export interface ChapterMessage {
  id: string;
  /** Absent on a message; see `MessageKind` for what else a row can be. */
  kind?: MessageKind;
  /** `system` belongs to cast records, which are never drawn in the chapter. */
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Chain-of-thought text some endpoints stream separately. Never sent back. */
  reasoning?: string;
  createdAt: string;
  editedAt?: string;
  meta?: MessageMeta;
  /**
   * Who wrote this answer, when the story was playing one character at a time.
   * Ensemble answers have none: nobody in particular wrote them.
   */
  speakerId?: string;
  /**
   * What that character was called when the answer was written. Stored beside
   * the id rather than looked up from it, so a rename or a deletion later
   * leaves the page saying what it said at the time.
   */
  speakerName?: string;
  /**
   * The author's words about this turn rather than the persona's words in it —
   * "the storm arrives tonight", "she should refuse". Kept apart from
   * `content` because that is what lets it be drawn as a note, left out of the
   * summary and sent to the model as an instruction. A message may have prose,
   * a direction, or both.
   */
  direction?: string;
  /** Cast records only. */
  cast?: CastChange;
}

// ---------------------------------------------------------------------------
// A story and its world
// ---------------------------------------------------------------------------

/**
 * The system prompt's blocks, in the order `prompt-builder.ts` assembles them.
 * Persisted in `Story.promptOrder`, so a name is part of the file format: a
 * stored order naming something this build does not know is simply not used.
 */
export type BlockId = 'mode' | 'persona' | 'story-so-far' | 'lore' | 'scene' | 'style' | 'author';

export type StoryMode = 'narrator' | 'roleplay';

/**
 * How role-play is cast. `ensemble` is what the app has always done: the model
 * plays every enabled character and answers as whoever the moment calls for.
 * `one-at-a-time` gives it one character to be, and the rest are in the scene
 * without a voice.
 */
export type RoleplayCasting = 'ensemble' | 'one-at-a-time';

export interface RoleplaySettings {
  casting: RoleplayCasting;
  /** One-at-a-time only. Unset, or naming nobody, means the first enabled. */
  activeCharacterId: string;
}

export type ReplyLength = 'short' | 'medium' | 'long';
export type LoreCategory = 'fact' | 'person' | 'place' | 'other';

export interface Character {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  /**
   * A name from the character palette. Absent on a document written before
   * there was one, and filled in on load from the character's place in the
   * cast, so an old story opens coloured and opens the same way every time.
   */
  colour?: string;
  /** A colour of their own, from Preferences. Beats the palette name. */
  colourOverride?: string;
}

export interface LoreEntry {
  id: string;
  title: string;
  category: LoreCategory;
  keys: string[];
  content: string;
  enabled: boolean;
  /** Skips the keyword scan: this entry is in every request. */
  alwaysOn: boolean;
  /** Both fall back to the story's scan settings when left undefined. */
  caseSensitive?: boolean;
  matchWholeWords?: boolean;
}

/** Global defaults for the keyword scan, overridable per entry. */
export interface ScanSettings {
  /** How many of the most recent messages join the scan window. */
  depth: number;
  caseSensitive: boolean;
  matchWholeWords: boolean;
}

export interface StoryWorld {
  /**
   * Compulsory, always injected. Closing a chapter rewrites it rather than
   * appending to it, so it stays the same size however long the story runs.
   */
  storySoFar: string;
  /** How "close chapter" is asked to rewrite it; `useDefault` keeps ours. */
  summary: { useDefault: boolean; prompt: string };
  entries: LoreEntry[];
  scan: ScanSettings;
  /**
   * Whether closing a chapter also asks the model what in it is worth
   * remembering. Off unless the writer says otherwise: it is a second request,
   * and a second bill, on a step that used to make one.
   */
  extractLore: boolean;
}

export interface StoryStyle {
  /** A prompt instruction, not a rendering choice: see UiSettings for that. */
  dialogueOnOwnLine: boolean;
  replyLength: ReplyLength;
}

export interface Story {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  mode: StoryMode;
  /** Narrator mode only; `useDefault` keeps the built-in preamble. */
  narrator: { useDefault: boolean; prompt: string };
  characters: Character[];
  /** Role-play only; ensemble, which is what every story before it did. */
  roleplay: RoleplaySettings;
  persona: { name: string; description: string };
  style: StoryStyle;
  world: StoryWorld;
  activeChapterId: string;
  /** Only ever increases: chapter 3 stays chapter 3 after a deletion. */
  chapterCounter: number;
  /**
   * The order this story puts its *movable* blocks in. Absent is the shipped
   * order, which is also what a list this build cannot make sense of falls back
   * to — see `blockOrder` in `prompt-builder.ts`.
   */
  promptOrder?: BlockId[];
  /**
   * Whether opening a chapter asks the model which page palette its scene wants.
   * Off unless the writer says otherwise: it is a request of its own, however
   * small, on a step that used to make none.
   */
  autoTheme: boolean;
}

/**
 * One file per chapter. There is no separate "chat" document: a chapter *is*
 * the conversation, plus the scene it opens on and the summary it closes with.
 */
export interface Chapter {
  id: string;
  storyId: string;
  number: number;
  title: string;
  /** Written before the first message, injected verbatim, never parsed. */
  scene: string;
  status: 'writing' | 'closed';
  summary: string;
  createdAt: string;
  updatedAt: string;
  messages: ChapterMessage[];
  /**
   * A name from the page palettes: the page this chapter is read on, whoever
   * chose it. Absent is the story's own page, which is every chapter written
   * before there were palettes.
   */
  palette?: string;
  /** What the request that chose it cost, for the scene sheet's footer. */
  paletteTokens?: number;
}

/** What actually goes over the wire to the endpoint. */
export interface OutboundMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
