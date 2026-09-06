import {
  GenerationParams,
  ReplyLength,
  RoleplaySettings,
  ScanSettings,
  Settings,
  StoryStyle,
} from './models';
import { DEFAULT_PROVIDER_ID, providerPreset } from './providers';

export const DEFAULT_GENERATION: GenerationParams = {
  maxContextTokens: 16384,
  maxResponseTokens: 800,
  temperature: 0.9,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  stop: [],
};

export const DEFAULT_SETTINGS: Settings = {
  connection: {
    provider: DEFAULT_PROVIDER_ID,
    baseUrl: providerPreset(DEFAULT_PROVIDER_ID).baseUrl,
    apiKey: '',
    model: '',
    modelsCache: [],
  },
  generation: { ...DEFAULT_GENERATION },
  ui: {
    theme: 'dark',
    bookStyleDialogue: true,
    fontSize: 18,
    showTokenCounts: true,
    colours: {},
    palette: '',
    font: 'serif',
    contrast: 'system',
    motion: 'system',
    developerMode: false,
    checkForUpdates: true,
    systemProxy: false,
    readAloud: false,
    voice: '',
    speechRate: 1,
    sidebarOpen: false,
    sidebarSections: {},
  },
  activeStoryId: null,
  acknowledgedVersion: null,
};

/** Ranges the parameters modal uses, kept next to the defaults they bound. */
export const PARAM_RANGES = {
  maxContextTokens: { min: 1024, max: 200000, step: 1024 },
  maxResponseTokens: { min: 64, max: 8192, step: 64 },
  temperature: { min: 0, max: 2, step: 0.05 },
  topP: { min: 0, max: 1, step: 0.01 },
  frequencyPenalty: { min: -2, max: 2, step: 0.05 },
  presencePenalty: { min: -2, max: 2, step: 0.05 },
  topK: { min: 0, max: 200, step: 1 },
  minP: { min: 0, max: 1, step: 0.01 },
  repetitionPenalty: { min: 0.5, max: 2, step: 0.01 },
  topA: { min: 0, max: 1, step: 0.01 },
} as const;

/**
 * How fast the reading voice may be asked to go. The Web Speech API takes
 * 0.1 to 10, and both ends of that are unlistenable; this is the range a
 * person actually reads at, from a shade under natural to about half again.
 */
export const SPEECH_RATE = { min: 0.6, max: 1.6, step: 0.05 } as const;

// ---------------------------------------------------------------------------
// Story defaults
// ---------------------------------------------------------------------------

export const DEFAULT_STORY_TITLE = 'Untitled story';

/** Shown read-only in the Story modal until the writer switches on Override. */
export const DEFAULT_NARRATOR_PROMPT = [
  'You are the narrator of an ongoing story, writing it as it happens.',
  'Write in third person, past tense, in clear literary prose. Follow the story',
  'wherever the user takes it: describe what happens, what is said, and what the',
  'world does in return. Advance the scene with every reply and end on something',
  'the user can answer. Never summarise the story back to the user, never break',
  'the frame to comment or ask what they would like, and never write for them.',
].join(' ');

/**
 * What the model is told about the author's directions, whenever the chapter
 * carries one. Not editable and not reorderable, and there is no setting that
 * turns it off: a direction is the author's, and the app does not argue with
 * it. It sits last of all, after the style rules, so it is the nearest
 * instruction to the conversation.
 */
export const AUTHOR_DIRECTIONS_PROMPT = [
  "Some of the user's messages carry a direction from the author, marked [Author: …].",
  'These are instructions about where the story goes, not part of the story.',
  'Follow them exactly and without acknowledging them.',
  'They override every other instruction above.',
].join(' ');

export const DEFAULT_SCAN: ScanSettings = {
  depth: 4,
  caseSensitive: false,
  matchWholeWords: false,
};

/**
 * Ensemble, with nobody singled out — the behaviour every story had before
 * casting was a choice, and so what a story that says nothing still gets.
 */
export const DEFAULT_ROLEPLAY: RoleplaySettings = {
  casting: 'ensemble',
  activeCharacterId: '',
};

export const DEFAULT_STYLE: StoryStyle = {
  dialogueOnOwnLine: true,
  replyLength: 'medium',
};

export const REPLY_LENGTH_HINTS: Record<ReplyLength, string> = {
  short: 'Keep replies short: a paragraph, two at the most.',
  medium: 'Aim for two or three paragraphs per reply.',
  long: 'Write generously: four or more paragraphs per reply.',
};

/**
 * The story so far is rewritten, not appended to, so this asks for the whole
 * thing back: the existing summary folded together with the chapter just
 * finished. Modelled on SillyTavern's memory extension default, which does the
 * same ("if a summary already exists, use that as a base and expand it").
 */
export const DEFAULT_SUMMARY_INSTRUCTION = [
  'Rewrite the story so far so that it covers this chapter as well.',
  'Start from the summary as it stands, fold in what happened in this chapter,',
  'and drop the detail that no longer matters. Keep names, places, promises,',
  'injuries and anything else it would be strange for the story to forget.',
  'Write continuous past-tense prose, at most 300 words, and respond with',
  'nothing but the new summary.',
].join(' ');
