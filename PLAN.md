# Lamplit — Implementation Plan

A single-page, text-only storytelling app (Narrator / Role-play) written in chapters, talking
directly from the browser to any OpenAI-compatible endpoint. SillyTavern is the functional
reference (`../SillyTavern`), consulted only for targeted checks. Written 2026-09-02, step 2
reworked around chapters and scenes 2026-09-02, step 4 (desktop and outreach) added and
completed 2026-09-03. **All four steps are done; v0.1.0 is published.**

Guiding principles

- Ease of use over configurability. Few menus, each one obviously useful.
- Visual attractiveness. Reading a story should feel like reading a book.
- The page is never taken away. Everything else opens as a modal over it, and only two sheets are
  allowed to insist on an answer before writing can start: the connection, once, on a fresh
  install, and the scene of the chapter being opened.
- Everything is auto-saved. No "save" anxiety.
- The whole prompt is rebuilt from data on every request. No hidden state.

---

## 0. Prerequisites and environment facts

| Item | Finding | Action |
|---|---|---|
| Node | v24.20.0, npm 11.19.0 | Angular 22's range is `^22.22.3 \|\| ^24.15.0 \|\| >=26`, and the root `engines` says the same; CI installs Node 24. It was v22.14.0 on 2026-09-02, which is why Angular 21 was chosen then; the machine and the build moved up together on 2026-09-07 (issue #76). The **server's** floor is a separate number and still `>=20.19` — that is what the shipped zip's start scripts check for. |
| npm registry | `~/.npmrc` points at a corporate AWS CodeArtifact registry (proxying npmjs). Token refreshed 2026-09-02, `npm view` works. | Always install through the configured registry. Never add a project `.npmrc` or `--registry` flag to bypass it. If the token expires again (E401), Gaetan refreshes it. **The committed lockfile pins `registry.npmjs.org` URLs** so a clone works anywhere and the proxy's host is not published (added 2026-09-03, before the repo went public); if an install rewrites them back to the proxy, put them back before committing — the integrity hashes are unaffected either way. |
| Electron's binary | Electron 44.1.1 publishes **no `scripts` at all** — no postinstall. `npm ci` installs the JavaScript and no executable, and says nothing. electron-builder does not care (it downloads its own copy through @electron/get), but Playwright's `_electron.launch()` runs the one in `node_modules`, so the desktop spec has nothing to open. Confirmed 2026-09-03 by reading the published tarball, after it failed the first release on both runners. | `postinstall` at the root runs `tools/fetch-electron.mjs`, so `npm ci` is all anyone has to run. It is idempotent and never fails an install. |
| Angular | 22.1.5 (core + Material), CLI and build 22.1.7, on TypeScript 6.0.3. Upgraded from 21.2.22 on 2026-09-07 with `ng update`; nothing 22 removed was in use, and the only migration that touched the source was the one adding `ChangeDetectionStrategy.Eager` everywhere, which was reverted. The two template migrations were declined: the diagnostics opt-out was not needed (no template trips them) and no `?.` needed wrapping. | Use 22. |
| NanoGPT CORS | `https://nano-gpt.com/api/v1` answers preflight with `Access-Control-Allow-Origin: *` and allows `Authorization`. | Direct browser calls work. No proxy needed. |
| NanoGPT model list | `GET /api/v1/models` returns the standard OpenAI `{object:"list", data:[{id, owned_by, created}]}`. `?detailed=true` adds names and capabilities. Works without a key. | Use `?detailed=true` when the URL is NanoGPT, fall back to plain `/models` for hand-typed URLs. |
| NanoGPT extra sampling | Accepts `top_k`, `min_p`, `repetition_penalty`, `top_a` beyond the OpenAI set (ST `public/scripts/openai.js:2958`). | Expose as "advanced" parameters, sent only when set. |
| API keys | I am not allowed to type API keys into any field. | During every live E2E test, Gaetan pastes the key. |

---

## 1. Architecture

### 1.1 Stack (decisions)

| Concern | Choice | Why |
|---|---|---|
| Framework | Angular 22.1.5, standalone components, signals, zoneless change detection, new control flow, `inject()` | Current best practice; fine-grained updates suit token streaming. Every component is OnPush, which is 22's default and which the signal stores already satisfied: the `Eager` opt-outs `ng update` writes were taken back out (see 0). |
| UI kit | Angular Material 22 (M3) for dialogs, menus, sliders, selects, tooltips, snackbar, plus a custom dark "reading" theme. Chat rendering is fully custom. | Solid a11y primitives for the modals without hand-building them; the part that has to look great (the chat) is ours. |
| State | Plain Angular services holding `signal()`/`computed()` state, one service per document type (see 1.3). No NgRx. | The persistence model is "one store slice = one JSON file"; a hand-rolled signal store maps onto that 1:1 with zero ceremony. |
| Model calls | Native `fetch` with `ReadableStream`, hand-written SSE parser (`data:` lines, `[DONE]`), `AbortController` for Stop. | No SDK dependency, full control over streaming and errors. |
| Rendering | `marked` (markdown) + `DOMPurify` (sanitising) + `highlight.js` (code blocks, `lib/core` with eight languages registered rather than `lib/common`) + a custom dialogue-formatting pass. | Standard, small, well-maintained. A story is not a codebase, so the full language set is not worth 350 kB. |
| Token estimate | Heuristic (chars / 3.6) with a pluggable interface; `gpt-tokenizer` can be dropped in later. | Good enough for budgeting; exact counts are provider-specific anyway. |
| Backend (step 3) | Node 22 + Express 5, ES modules, JSON files on disk, serves the Angular build. | Simplest thing that works; single process to launch. |
| Desktop (step 4) | Electron 44 + electron-builder (44.1.1 and 26.15.3 on npm, 2026-09-03), wrapping the same Express server. | Same code, easier launch, and Node travels inside the installer — the one prerequisite the zip still has. See §5. |
| Automated E2E | Playwright against a local fake OpenAI-compatible SSE server. | Deterministic regression tests, no tokens burned. |

### 1.2 Repository layout

```
Lamplit/
  PLAN.md
  package.json              npm workspaces: app, server, e2e, electron
  app/                      Angular 22 workspace
    src/app/
      core/                 model client, SSE parser, prompt builder, tokens, formatting
      store/                signal stores (one per document type) + persistence layer
      features/
        chapters/           the reading surface and everything chapter-shaped: page,
                            message list, message item, composer, chapter toolbar,
                            scene sheet, chapters menu, close-chapter flow
        connection/         connection modal (provider, URL, key, model picker)
        generation/         model parameters modal
        story/              story setup modal (mode, narrator, characters, persona)
        world/              world modal (facts, people, places, story so far, lore)
      shared/               top bar, modal shell, editor field with light save button, ui bits
  server/                   Express persistence server (step 3); also the zip writer
  tools/                    dev.mjs (app + server together), package.mjs (the runnable zip)
  e2e/                      Playwright specs + fake OpenAI SSE server, and LIVE-TEST.md, the
                            script a person follows with a real model
  electron/                 main process, preload, electron-builder config (step 4)
  docs/                     the guide; also the website, served as-is by GitHub Pages (step 4)
  .github/workflows/        release.yml — builds installers on a tag and publishes them (step 4)
```

### 1.3 Data model (TypeScript, all persisted as-is)

```ts
// settings.json  — one file, global
interface Settings {
  connection: {
    provider: string; // a row in core/providers.ts, or 'custom' (§5.7)
    baseUrl: string; // e.g. https://nano-gpt.com/api/v1
    apiKey: string; // stored locally in plain JSON (single-user, local machine)
    model: string; // selected model id
    modelsCache: ModelInfo[]; // last fetched list, for instant dropdown
  };
  generation: GenerationParams; // see below
  ui: {
    theme: 'dark' | 'light';
    bookStyleDialogue: boolean;
    fontSize: number;
    showTokenCounts: boolean;
  };
  activeStoryId: string | null;
}

interface GenerationParams {
  maxContextTokens: number; // budget used by the prompt builder
  maxResponseTokens: number;
  temperature: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  stop: string[];
  seed?: number;
  // advanced, sent only when defined (NanoGPT & friends accept them)
  topK?: number;
  minP?: number;
  repetitionPenalty?: number;
  topA?: number;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
}

// stories/<storyId>.json — one file per story
interface Story {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  mode: 'narrator' | 'roleplay';
  narrator: { useDefault: boolean; prompt: string }; // narrator mode only
  characters: Character[]; // roleplay mode
  persona: { name: string; description: string }; // always injected
  style: {
    // Prompt instructions, not rendering: Settings.ui holds the reading side.
    dialogueOnOwnLine: boolean;
    replyLength: 'short' | 'medium' | 'long';
  };
  world: {
    storySoFar: string; // compulsory, always injected, rewritten by "close chapter"
    summary: { useDefault: boolean; prompt: string }; // how a chapter is folded in
    entries: LoreEntry[]; // optional, keyword-activated
    scan: { depth: number; caseSensitive: boolean; matchWholeWords: boolean }; // defaults
  };
  activeChapterId: string;
  chapterCounter: number;
}
interface Character {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}
interface LoreEntry {
  id: string;
  title: string;
  category: 'fact' | 'person' | 'place' | 'other';
  keys: string[];
  content: string;
  enabled: boolean;
  alwaysOn: boolean; // bypass keyword scan
  caseSensitive?: boolean;
  matchWholeWords?: boolean;
}

// chapters/<chapterId>.json — one file per chapter. There is no separate
// "chat" document: a chapter *is* the conversation, plus the scene it opens on
// and the summary it closes with.
interface Chapter {
  id: string;
  storyId: string;
  number: number; // 1, 2, 3… never reused, never renumbered
  title: string; // "The Lantern Room"; defaults to the scene's first line
  // The scene, as one piece of prose. Written before the first message and
  // always injected verbatim. Deliberately not a set of fields: a scene
  // heading in a playscript is free text, the model reads prose perfectly
  // well, and any schema we imposed here would be a schema someone has to
  // fight. Required only in the sense that it must not be empty.
  scene: string;
  status: 'writing' | 'closed';
  summary: string; // written by "close chapter", folded into world.storySoFar
  createdAt: string;
  updatedAt: string;
  messages: ChapterMessage[];
}

interface ChapterMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  editedAt?: string;
  meta?: {
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    finishReason?: string;
    aborted?: boolean;
  };
}
```

Every store exposes `signal`s and mutation methods, and writes each changed slice out as JSON.
Step 1 and 2 wrote to `localStorage`; from step 3 they write to the server, and from the revision
below they write *only* there.

### 1.4 Prompt assembly (rebuilt from scratch on every request)

```
[system]  1. Mode preamble
             narrator : default omniscient-narrator instructions (or the user's override)
             roleplay : "You are playing <Character A>, <Character B>…" + each description
          2. Persona: "The user plays <name>: <description>"
          3. Story so far: world.storySoFar
          4. Active lore: entries with alwaysOn OR whose keys match the scan window
             (scan window = the chapter's scene + user's new message + last N messages, N default
             4; case-insensitive substring by default, whole-word optional — same semantics ST
             uses in world-info.js)
          5. This chapter: "Chapter <n>, <title>. The scene:\n<scene>" — the scene text
             verbatim, nothing parsed out of it. The immediate setting, so it sits last,
             closest to the conversation
          6. Style rules: dialogue in "quotes", actions in plain prose, stay in character, never
             write for the persona in roleplay mode
[history] chapter messages, oldest dropped first until (system + history + reserve for the reply)
          fits maxContextTokens
[user]    the new message
```

Only the current chapter's messages are ever sent. Earlier chapters reach the model through
`world.storySoFar`, which is exactly what "close chapter" is for — that is the whole point of
chapters, and the reason context stays affordable however long the story runs.

The composer shows a live "context: 3.2k / 16k tokens" pill, and a "What the model sees" modal
(read-only dump of the assembled messages) is always one click away. That single view replaces
most of SillyTavern's prompt-manager complexity.

---

## 2. Step 1 — Chat box and model connection (no context, no backend)

Goal: a beautiful streaming chat that talks straight to a model.

### 2.1 Tasks

1. Scaffold: root workspaces, `ng new app` (standalone, zoneless, SCSS, routing off),
   Angular Material with a custom M3 dark theme, `marked`, `dompurify`, `highlight.js`.
2. App shell: top bar (title, story/chapter name placeholder, menu buttons: Connection,
   Parameters, later Story / World / Chapters), full-height chat page, composer docked at the bottom.
3. Settings store with `localStorage` persistence (temporary until step 3).
4. Model client (`core/model-client.ts`):
   - `listModels(baseUrl, apiKey)` → `GET {baseUrl}/models` (NanoGPT: `?detailed=true`).
   - `streamChat(request, onDelta, signal)` → `POST {baseUrl}/chat/completions` with `stream: true`,
     parses SSE, yields `delta.content`; ignores/collects `reasoning_content`; surfaces `usage` and
     `finish_reason` from the final chunk; maps HTTP 401/402/429/5xx to readable errors.
5. Connection modal: provider dropdown (NanoGPT → fills URL; Custom → editable URL), API key
   field (password, show/hide), "Fetch models" button, searchable model dropdown (grouped by
   `owned_by`), "Test" button that sends a one-token request. Saves on close.
6. Parameters modal: sliders + numeric inputs for every `GenerationParams` field, "Advanced"
   expander for top-k / min-p / repetition penalty / top-a / reasoning effort, "Reset to defaults".
   Context and response budgets shown together so the relationship is obvious.
7. Chat store: messages, streaming state, `send`, `stop`, `edit`, `delete`, `regenerate(id)`,
   `replayFrom(id)` (truncates everything after the chosen user message and re-sends it), `clear`.
8. Message rendering:
   - Markdown → sanitised HTML, code highlighted.
   - Dialogue pass: text inside "double quotes" (also curly quotes) is styled as speech; when
     "book style" is on, each spoken line starts its own paragraph. `*asterisk actions*` italic.
   - Streaming render throttled to one repaint per animation frame; auto-scroll that pauses when
     the user scrolls up, with a "jump to latest" chip.
   - Hover toolbar on each message: edit (inline textarea), regenerate / replay from here, delete,
     copy. Assistant messages show model name and token counts in a subtle footer.
9. Composer: auto-growing textarea, Enter to send / Shift+Enter newline, Stop button while
   streaming, disabled state with reason when connection is incomplete.
10. Error and empty states: friendly first-run card ("Connect a model to start"), inline error
    bubbles with retry.

### 2.2 E2E test (live, in the in-app browser)

1. Start `ng serve`, open the app.
2. Connection modal: pick NanoGPT, Gaetan pastes the key, fetch models, pick one, test → green.
3. Set temperature 0.9, response budget 400, close modal.
4. Send "Write two lines of dialogue between a knight and a dragon." Verify streaming, quote
   styling, book-style line breaks.
5. Edit the user message, replay from it → old answer gone, new answer streams.
6. Regenerate the last answer. Stop mid-stream → partial text kept, marked as stopped.
7. Reload the page → connection, parameters and chat survive (localStorage).
8. Break the key on purpose → readable 401 error, no crash.

Also: first Playwright spec against a fake SSE server covering send / stream / edit / replay,
so later steps have a regression net.

---

## 3. Step 2 — Chapters and context (scene, Narrator / Role-play, persona, world)

Goal: SillyTavern's power with one-tenth of the UI, arranged as a book rather than as a chat
client.

### 3.0 The chapter is the unit of the app

There is no "chat" and no "new chat". A story is a sequence of **chapters**, and every chapter
opens the way a scene opens in a playscript: a few lines saying where we are, when, who is on
stage, what is happening as the lights come up. Only then can anyone speak.

The scene is one plain-text field. Whether it reads like a stage direction, a paragraph of
narration or a single word is the writer's business — the model interprets prose, so the app
does not need a schema and the writer does not need to learn one.

That gives three hard rules the rest of step 2 follows:

- **A chapter cannot be written into until its scene is written.** Creating a chapter opens the
  scene sheet, and the composer stays disabled behind it. This is the one compulsory step in the
  app, and it earns that status: it is also the cheapest possible fix for the usual failure mode
  of these tools, a model with no idea where it is. Compulsory is not the same as onerous — any
  non-empty text passes.
- **A closed chapter is kept, always.** Closing summarises it into `world.storySoFar` and marks
  it `closed`; the chapter itself stays in the Chapters list, readable forever. Nothing asks
  whether to keep it and nothing deletes it. Deleting a chapter is a deliberate act from the
  Chapters list, with a confirm.
- **Chapter numbers are permanent.** `Story.chapterCounter` only ever increases. Chapter 3 stays
  Chapter 3 even if Chapter 2 is deleted, because a reader referring to "chapter 3" means a
  particular piece of text.

Migration from step 1: the single step-1 conversation becomes Chapter 1 of a story called
"Untitled story", with an empty scene and `status: 'writing'`. The scene sheet opens once over
it on first load so it can be filled in; the existing messages are left alone.

### 3.1 Tasks

1. **Story store** (`stories/*.json`) and **chapter store** (`chapters/*.json`) keyed by story —
   step 1's `ChatStore` becomes `ChapterStore`, and `features/chat/` becomes
   `features/chapters/`, so the word "chat" leaves the codebase with the concept. Top bar shows
   "Story title · Chapter N — Chapter title" and gains a Stories menu (new, switch, rename,
   duplicate, delete) and a Chapters menu (task 8).
2. **Scene sheet** (`features/chapters/scene-dialog`), the modal that opens a chapter. It is
   one field, not a form:
   - **The scene** — a single large autofocused textarea, set in the reading serif at reading
     size, because what goes in it is prose and should look like prose while it is written. No
     place / time / who fields: the model reads a paragraph as well as it reads a schema, and a
     schema is something the writer would have to fight the first time a scene does not fit it.
   - Placeholder text carries the playscript idea without imposing it: _"A lighthouse gallery.
     Dusk, the first night of autumn. Mara is alone, and the lamp is already lit."_ Guidance,
     not structure — write a word or three pages.
   - **Chapter title** — optional, one line; when blank it defaults to the scene's first line,
     trimmed.
   - Footer: word count and the token cost of the scene block, so the price of three pages is
     visible while it is being written.
   - Confirm is disabled while the scene is empty or only whitespace — that is the whole of the
     validation. Escape and backdrop save a draft but do not open the chapter; an empty scene is
     the one state that blocks the composer, and the composer says so, with a button back to the
     sheet.
   - Opening chapter N+1 pre-fills the sheet with chapter N's scene text, since continuing where
     you were is the common case and editing a paragraph beats retyping one.
3. **Scene in the prompt**: a `scene` block per 1.4 item 5, sitting last among the system blocks,
   injected verbatim — nothing in the app parses the scene, ever. The scene text also joins the
   lore scan window, so an entry named in the scene fires on the first message of the chapter
   rather than only once someone mentions it.
4. **Story modal**, three tabs:
   - **Mode**: big two-way toggle Narrator / Role-play with a one-line explanation of each.
     Narrator tab shows the default narrator prompt (read-only) with an "Override" switch that
     turns it into an editor. Role-play tab shows a character list (name, description, enabled).
   - **Persona**: name + description.
   - **Style** (small): dialogue-on-its-own-line toggle, reply length hint
     (short / medium / long), maps to a sentence in the style rules.
5. **World modal**:
   - **Story so far**: one large editor, marked "always included", word count. Shows which
     chapters have been folded into it, newest first.
   - **Lore**: card list grouped by category (facts, people, places). Each card: title, keys as
     chips, content, enabled, always-on. Add / duplicate / delete. Search box filters by title or
     key.
   - Scan settings in a footer: scan depth, case sensitive, whole words (global defaults).
   - Each entry collapses to one line (title, keys, state) and opens on click; a world holds
     dozens, and all of them open at once is unreadable. Added 2026-09-03 after review.
   - **"What is true" is required** (2026-09-03, after review): an entry is the sentence it
     contributes, so an empty one can never fire. The card says so and is marked unfinished
     rather than the entry being silently dropped from the prompt.
6. **Prompt builder** (`core/prompt-builder.ts`) implementing 1.4: a pure function of
   (settings, story, chapter, draft) → messages + token report + which lore fired and why.
   Unit-tested, and it replaces the history-only `assemble()` that step 1 left in `ChatStore`.
7. **"What the model sees"** modal, reachable from the composer pill, showing each block with its
   token cost, the scene block among them, and which lore entries fired and on which matched key.
8. **Chapters menu** — the table of contents. One row per chapter: number, title, the scene's
   first line as a subtitle, message count, word count, and state (writing / closed). Actions:
   open (the closed ones open read-only with a "Continue this chapter" button that flips it back
   to `writing`), edit scene, rename, delete (confirm), and **New chapter** at the bottom.
9. **Chapter toolbar** (inside the chat area, above the composer, small pill buttons). Note
   (2026-09-03, after review): **"New chapter" is the same act as "Close chapter"** — starting the
   next chapter summarises the one being written, shows the summary for review, and folds it into
   the story so far before the new scene is asked for. Only a chapter with nothing written in it,
   or one already closed, goes straight to the scene sheet. And a chapter that cannot be written
   into shows no composer at all: the dock carries the reason and the way out of it instead of a
   box that refuses what is typed into it.
   - **Close chapter**: builds a summarisation request (the story so far as it stands + this
     chapter's scene and messages + an instruction modelled on ST's memory extension default
     prompt), streams the result into a review modal (editable). On confirm: writes `summary`,
     **replaces** `world.storySoFar` with it, sets `status: 'closed'`, then opens the scene sheet
     for Chapter N+1 pre-filled per task 2. Nothing is discarded and nothing is asked.
     Revised 2026-09-03 after review: the summary **replaces** the story so far rather than being
     appended to it, which is what keeps it one readable page however long the story runs — so
     the request hands the model the existing summary and asks for the whole thing back. The
     instruction itself is a prompt like any other and is editable per story
     (`world.summary: { useDefault, prompt }`), from the World modal and from the review sheet.
   - **Edit scene** (opens the sheet for the current chapter), **What the model sees**.
10. **Save mechanics**: every editor field has a light save icon (appears when dirty, click to
    commit); the modal commits everything on close as well. Escape / backdrop close = save,
    never discard. The scene sheet is the single exception, and only for the "does this chapter
    open yet" decision — the text itself is still saved as a draft.
    Writing surface (fixed 2026-09-03, after review; redone 2026-09-04, issue #18): every
    multi-line field sizes itself to its text with the CSS `field-sizing: content`, bounded by
    `--rows-min` / `--rows-max` on the element, in one global rule. It replaced the CDK's
    autosize, which measured a frame late, needed a content box and a `flex: none` fix in every
    flex dialog, and still had to be re-measured by hand whenever text arrived from code. A spec
    types into the composer and fails if the box ever scrolls its own text.
    Text is written into a box only through `[liText]`, which never rewrites a field that is
    being typed into — a plain `[value]` binding moves the caret to the end and throws away the
    browser's undo stack whenever the document changes underneath.
11. **Lore scanning** runs on every send over (scene + draft + last N messages), and again on
    regenerate / replay, since the context is always rebuilt.
12. **The story sheet comes before the first scene** (added 2026-09-03, after the first review of
    step 2). "New story" asks title / mode / persona and only then opens the scene sheet, because
    those three shape every request the chapter will make and are awkward to discover afterwards.
    All three are optional and all three stay editable in Story; backing out creates nothing. A
    first run that has never been written in gets the same sheet over the story the app made for
    itself, where backing out simply keeps the defaults.
13. **The connection comes before the story sheet** (added 2026-09-03, after the review of step
    3). A fresh install opens on Connection and nothing else: there is no point writing a scene
    for a model the app cannot reach, and every other question is downstream of this one. That
    sheet insists — no Escape, no backdrop, and Done stays dark until there is an endpoint and a
    model — but it keeps one "Not now", because a modal with no way out would be worse than the
    block it is enforcing. The block itself is already downstream: the composer stays shut and
    says why. The whole thing is skipped once a connection is stored, which is every run but the
    first. Order on a fresh install: connection → story → scene.

### 3.2 E2E test (live)

1. Create story "The Lighthouse", Narrator mode, persona "Mara, a marine biologist".
2. The scene sheet opens by itself and the composer is disabled. Confirm is greyed out; type a
   space and it stays greyed out. Write the scene as one piece of prose: _"The keeper's cottage,
   late afternoon, low tide. Mara arrives to find the door unlatched and nobody answering."_
   Title left blank. Confirm → the chapter opens, titled from the first line, composer alive.
3. World: story so far "Mara has just arrived on the island."; lore "Old Tomas" (keys: tomas,
   keeper), "The Lantern Room" (keys: lantern, lamp room).
4. Open "What the model sees" before typing anything: the scene block is there word for word,
   and Old Tomas has already fired on "keeper" in the scene — the Lantern Room has not.
5. Send "I walk up to the door." → output is narration in third person, and it picks up the
   cottage, the hour and the unlatched door from the scene rather than inventing its own.
6. Switch to Role-play, add character "Tomas" with a description, send a line → model answers as
   Tomas, in first person, does not speak for Mara.
7. **Close chapter** → summary streams into the review modal, edit one word, confirm. Chapter 1
   goes `closed`, story-so-far gains the summary, and the Chapter 2 scene sheet opens pre-filled
   with chapter 1's scene text. Rewrite it as _"The lantern room, an hour later."_ — a single
   short line, to prove nothing more is ever required — confirm → Chapter 2 opens empty, and
   "What the model sees" now shows the Lantern Room lore firing.
8. Chapters menu shows two rows: "1 — The keeper's cottage… (closed)" and "2 — The lantern
   room… (writing)". Open Chapter 1 → read-only, its messages intact, with "Continue this
   chapter".
9. Reload → story, both chapters, both scenes and the story-so-far all intact.
10. Playwright specs extended: the composer stays disabled until a scene is written, whitespace
    alone does not count, a one-word scene is accepted, the scene reaches the prompt verbatim,
    scene text activates lore, the chapter title falls back to the scene's first line, mode
    switch changes the system prompt, close-chapter keeps the chapter and pre-fills the next
    scene, and chapter numbers survive a deletion — all against the fake server.

---

## 4. Step 3 — Backend persistence (and optional Electron)

Goal: the store is mirrored to disk, as-is, always.

### 4.1 Server (`server/`)

- Express 5, ES modules, `data/` folder with `settings.json`, `stories/`, `chapters/`.
- API, deliberately tiny:
  - `GET  /api/docs/:collection` → list of `{id, updatedAt}` (or full docs for small collections)
  - `GET  /api/docs/:collection/:id` → the JSON as stored
  - `PUT  /api/docs/:collection/:id` → overwrite; body is the document; returns `{ok, seq}`
  - `DELETE /api/docs/:collection/:id`
  - `GET  /api/health`
- Write ordering ("whoever comes first gets written first"): one FIFO promise chain per file
  path; each write goes to `file.tmp` then `rename` (atomic on Windows and POSIX). Requests are
  processed in arrival order; a client-supplied monotonic `seq` header lets the server drop a
  write that is older than the last one it applied for that file (guards against reordering on
  the wire).
- Serves `app/dist` statically so `npm start` in the root runs everything on one port.
- Optional daily zip of `data/` into `backups/` on startup (cheap insurance).

### 4.2 Client persistence layer

- `PersistenceService` replaces the `localStorage` adapter from step 1 behind the same interface.
- For each document: `effect()` on the store slice → debounce 300 ms → serialise → PUT.
  Per-document in-flight guard: if a PUT is running, the latest state is queued and sent once,
  after it completes (coalescing). `beforeunload` flushes with `fetch(..., {keepalive: true})`.
- Bootstrap: `GET settings`, `GET stories`, `GET chapters` for the active story, then render.
  A small status dot in the top bar: saved / saving / offline (with retry).
- `localStorage` stays as a write-through cache so the UI paints instantly on reload.
  **Reversed 2026-09-03 — see 4.6.**

### 4.3 Packaging (`npm run package`)

Added to step 3 on 2026-09-03, ahead of Electron and as the thing Electron will wrap.

- `tools/package.mjs` builds the app, stages `server/src`, the Angular output as `public/`, and
  the server's production dependency closure as `node_modules/`, then writes
  `build/lamplit-<version>.zip` (~1 MB).
- The dependency closure is resolved the way Node resolves it, from the installed tree, rather
  than by asking npm to install again: it works offline and copies the versions that were tested.
- Zipping is done by `server/src/zip.js`, a hundred-line deflate writer, so neither the package
  script nor the daily backup pulls in a dependency for it.
- Unzip anywhere, run `start.bat` (Windows) or `start.sh` (Linux, macOS): one call starts the
  server, opens the browser, and creates `data/` next to the script. Node 20.19+ is the only
  prerequisite; nothing is installed or built at the far end.
- The start scripts pass `--open`; `--port`, `--data`, `LAMPLIT_OPEN=0` and `LAMPLIT_BACKUP=0` all work.

### 4.4 Electron (not built here — became step 4, §5)

- `electron/main.ts` starts the Express server in-process on a free port and opens a
  `BrowserWindow` at it; `data/` lives in `app.getPath('userData')`.
- electron-builder for a Windows installer / portable exe. Not on the critical path, and
  deliberately left out of the package above. The server already takes its data and public
  folders as options, which is all Electron needs from it. Promoted on 2026-09-03 from "optional"
  to a step of its own, with the website and the release process it needs to be worth anything.

### 4.6 One source of truth (revision, 2026-09-03)

`localStorage` is gone. The server holds the documents; the app reads them once at startup into a
map that lasts the session, writes go to that map and to the server, and a reload starts again
from disk.

**Why the cache was wrong.** It was there because step 1 had no backend, and it stayed on when
step 3 gave it one — with too little argument. Two copies of the same document is two sources of
truth, and the price showed up as a merge on every startup, a persisted write queue, a rule for
which side wins, and a class of bug where a browser holding an old story met an empty server and
helpfully uploaded it. All of that bought one thing: a reload that painted before the first
network round trip — on a local app whose database is a handful of JSON files on the same machine,
read in a few milliseconds.

**What follows from it.**

- No server, no app. The startup read retries a few times and then shows a screen saying so, with
  a Try again. An app that opened anyway would be an empty one, indistinguishable from a fresh
  install, and the next keystroke would be written over a story that was fine. `App` renders
  either that screen or the workspace, and the stores are only constructed for the second, because
  they read at construction.
- Offline is now a session-only state: writes queue in memory and retry, the app keeps working,
  but a reload while offline loses what has not been sent. The indicator says so, and closing the
  tab with a failing queue prompts.
- The step-1 `chat:` migration is gone with the storage it read from.
- Every Playwright spec now runs against a real server with its own data folder, seeded by writing
  JSON into it, because there is nowhere else for a document to be. The dev server left the suite.
- `npm run smoke` lost the port-rotation trick it had grown to dodge exactly this problem.

### 4.5 Final acceptance test

Two halves. The automated half proves the machinery; the live half proves the thing is worth
using, which no fake model can tell you.

#### The automated half — `npm run e2e`

`e2e/specs/journey.spec.ts` walks one narrator story from nothing: empty data folder, browser that
has never seen the app, production build served by the real persistence server, no seeding
anywhere. Eleven stages, in order, each checked against the JSON on disk rather than the screen —
connection insists → endpoint and model → narrator, title, persona → the scene refuses whitespace
→ the first turn carries narrator + persona + scene in that order → story so far always sent →
lore stays out until the story mentions it → close chapter folds it in and replaces the summary →
chapter 2 opens on the previous scene and carries none of chapter 1's transcript → an empty
browser reads it all back off disk → the data folder holds that and nothing else.

Plus `persistence.spec.ts` for the backend's own behaviour (offline and catch-up, two tabs, delete
takes its files with it), and the rest of the suite for everything else. All of it must be green.

#### The live half — `npm run smoke`, then this script

`npm run smoke` builds the package, unzips the **archive** into an empty folder, and starts it
through `start.bat` / `start.sh` — on a port this machine has never served the app from, which is
the part that makes it genuinely fresh. An empty `data/` folder is not enough on its own: browser
storage is keyed by origin, and a browser holding documents that meets a server holding none
uploads them, which is the deliberate "first run after this app grew a backend" path. Reuse the
URL and the second smoke run silently restores the first one's story and calls it new. Used ports
are remembered in `build/.smoke-ports.json`; delete that file and you are back to guessing.

First thing to check, because nothing automated can: the story behind the connection sheet should
be **Untitled story**. Anything else means the browser brought one with it.

**The script itself is `e2e/LIVE-TEST.md`** (2026-09-03). The ten points below are its outline;
the file has every prompt written out, a table per stage with the expected result and a column
for the outcome, the paths of the JSON files to open at each step, two rubrics for judging the
prose and the summary, and a worksheet that turns the token footers into a verdict on point 10.
Follow the file, not this list.

Narrator mode, a real key, a real model.

1. **It runs at all.** One call, browser opens, no console errors, `data/` appears beside the
   script.
2. **Connection.** It opens on the connection sheet and refuses Escape. Paste the key, fetch the
   models, pick one, **Test** answers. `data/settings.json` now holds the key and model.
3. **Story.** Narrator, a title, a persona. Check `data/stories/<id>.json`.
4. **Scene.** Whitespace will not open the chapter; real text will. Check the chapter file.
5. **Six or eight turns.** This is the part that matters and the part only a person can judge:
   does it stay in the scene, keep the persona out of its own mouth, and end on something you can
   answer? Try **Stop** mid-answer, **Edit** a line of your own, **Regenerate** an answer you did
   not like, **Replay from here**.
6. **World.** Write the story so far. Add two lore entries, one with a key the story has already
   used and one it has not. Open **What the model sees** from the composer pill and confirm the
   right one fired, on the right key. Check the token counts against the provider's real usage
   under the last answer.
7. **Close the chapter.** Read the summary it writes: does it keep the names, the promises, the
   injuries? Edit it, confirm, and check that `world.storySoFar` was *replaced* and the chapter
   kept its own copy.
8. **Chapter 2.** The sheet opens pre-filled. Write two turns and confirm from the preview that
   chapter 1's transcript is gone and only the summary carries it.
9. **It survives.** Ctrl+C, start it again, everything is there. Then copy the whole folder
   somewhere else, start it there, and confirm the story came with it.
10. **Money.** Note what the whole session cost against the provider's dashboard. If a chaptered
    story is not materially cheaper per reply than one long chat, the central premise is wrong and
    that is worth knowing.

---

## 5. Step 4 — A desktop app, and a way for people to find it

Added 2026-09-03, once step 3 was done and the live test was written up. Steps 1–3 made an app
worth using; nobody who is not comfortable with a terminal can reach it. That is the whole of what
this step is for.

Goal: **someone with no Node, no git and no command line downloads one file from a web page,
installs it, and is writing within five minutes.** Nothing built in steps 1–3 changes. This step
wraps it (Electron), puts it somewhere (a website with downloads), keeps it there (a release
process), and widens the front door (more providers) — all of it on GitHub's free tier, with a
named fallback wherever that tier might not stretch.

Guiding principles, in addition to the ones at the top:

- The zip stays. Electron is a second way to run the same folder, not a replacement for the first.
- Nothing in the desktop build knows it is in Electron except the twenty lines that start it.
- Everything a non-technical user reads — the page, the download buttons, the first-run
  instructions — is written for them, not for us. The docs already are; the landing page must be.

### 5.1 What Electron adds, and what it must not touch

| | The zip (step 3) | The desktop app (step 4) |
|---|---|---|
| Prerequisite | Node 20.19+ on the machine | none — Node ships inside |
| Starts | `start.bat` / `start.sh`, then a browser tab | one icon, one window |
| Documents | `data/` beside the script | `data/` in the user's profile (`app.getPath('userData')`), same layout, same files |
| Server | the same `server/src/app.js`, listening on `127.0.0.1` | the same, started in-process on a free port |
| Model calls | browser → provider, directly | the same — the window is Chromium, CORS rules and all |
| Updates | download a new zip | in-app, from GitHub Releases (see 5.4) |
| Size | ~1 MB | ~90–110 MB per platform, most of it Chromium |

The thing to protect: **the server and the app are unchanged**. `createApp({ dataDir, publicDir })`
already takes everything Electron needs to hand it. If a change to `server/` or `app/` turns out
to be needed "for Electron", that is a sign the shell is doing too much.

### 5.2 Tasks — the shell (`electron/`)

1. A fourth workspace, `electron/`, with its own `package.json` (electron, electron-builder,
   electron-updater as devDependencies; `express` is reached through the root workspace).
2. `electron/main.mjs`:
   - `app.requestSingleInstanceLock()` — a second launch focuses the window rather than starting
     a second server over the same files.
   - `createApp({ dataDir: join(app.getPath('userData'), 'data'), publicDir: <bundled public/> })`,
     `listen(0)` on `127.0.0.1` for a free port. The backup-on-startup runs too, into
     `userData/backups`.
   - One `BrowserWindow` at that URL; size and position remembered in `userData/window.json`.
   - Links to other origins open in the system browser (`setWindowOpenHandler`), so "get a key"
     links in the connection modal leave the app rather than navigating it away.
   - Minimal menu: File (Open data folder, Quit), Edit (the standard six, or copy/paste do not
     work on macOS), View (zoom, reload, dev tools), Help (the website, the version).
   - Quit closes the server cleanly so the last debounced write lands — the app already flushes on
     `beforeunload`, and the window's `close` event fires it.
3. `electron/preload.mjs`: nothing, or as near as possible. Context isolation on, node integration
   off; the app is a web page and stays one. The one thing worth exposing is `openDataFolder()`,
   so **Your data** in the docs can say "Help → Open data folder" and mean it.
4. Where the data lives is the only user-visible difference, so it is documented in a new
   `docs/desktop.md`: the path per OS, that it is the same layout as the zip's `data/`, that
   copying that folder is a backup, that uninstalling leaves it alone (installers do; say so).
5. `npm run desktop` at the root starts it against the dev build for working on it;
   `npm run dist -w electron` builds installers for the current OS into `build/desktop/`.
6. One Playwright spec through `_electron.launch()`: the app starts, `/api/health` answers on the
   port it chose, the window shows the connection sheet, `userData/data/settings.json` exists. It
   is the smoke test in code and it runs in the release workflow before anything is published.

### 5.3 Tasks — the builds

| Platform | Artifacts | Notes |
|---|---|---|
| Windows | NSIS installer (`Lamplit-Setup-<v>.exe`), portable (`Lamplit-<v>.exe`) | x64. The portable keeps `data/` beside itself like the zip does, which is what a USB-stick user wants; the installer uses `userData`. |
| macOS | **none — not built.** Decided 2026-09-03; see 5.5. | The `.dmg` target stays in `electron-builder.yml`, commented out, so a contributor with an Apple Developer licence can produce it without redesigning anything. |
| Linux | `.AppImage`, `.deb` | x64. AppImage needs no install at all. |

electron-builder does both from one `electron-builder.yml`. The `files` list is the packaged
folder from step 3 (`server/`, `public/`, the server's `node_modules/`) plus `electron/`, which is
why `tools/package.mjs` stays the single place that decides what ships: the desktop build stages
through it and adds a shell on top.

### 5.4 Tasks — releasing (`.github/workflows/release.yml`)

Free for a public repo: GitHub Actions minutes are unlimited on public repositories, GitHub
Releases take assets up to 2 GB each with no stated cap on downloads, and a release's assets are
served from a URL that never changes shape.

1. `npm version <patch|minor>` bumps the root `package.json`, commits and tags `v<x.y.z>`.
   Pushing the tag is the release. Nothing else has to be remembered.
2. The workflow runs on `push: tags: v*`, a two-OS matrix (`windows-latest`, `ubuntu-latest`):
   `npm ci`, `npm test`, `npm run build`, the Electron spec from 5.2.6, then
   `electron-builder --publish always`, which uploads to a **draft** release for that tag.
   `GITHUB_TOKEN` is enough; no secrets to keep. No `macos-latest` runner: there is nothing it
   could produce that we would publish (5.5).
3. The release notes are `CHANGELOG.md`'s top section, and the draft is published by hand after a
   look at the uploads. One click, deliberate, after the machines have done the boring part.
4. `electron-updater` in the app points at the same releases. It works out of the box for Windows
   (NSIS) and Linux (AppImage), the two we ship. (On macOS it would require a signed and notarised
   app, which is one more reason 5.5 went the way it did.)
5. The lockfile keeps `registry.npmjs.org` URLs (§0), which is what lets `npm ci` run on a GitHub
   runner at all.

Fallbacks, if a limit turns up: Cloudflare R2 (10 GB free, no egress fees) or SourceForge (free
mirrors for open-source projects, an old but reliable arrangement) for the installers themselves,
with the workflow uploading there instead of to the release. Neither is expected to be needed.

### 5.5 Signing — the honest part

Unsigned desktop apps are treated as suspicious by every OS, and a non-technical user is exactly
the person who will believe the warning.

| OS | Unsigned experience | Free path | Paid path |
|---|---|---|---|
| Windows | SmartScreen: "Windows protected your PC" → *More info* → *Run anyway*. Reputation accrues per signed certificate, so an unsigned build never gets past it. | **SignPath Foundation** signs open-source projects free of charge, on application, via their GitHub Action. The project qualifies (MIT, public, real releases). Apply once 5.4 has produced a first release. | Azure Trusted Signing (~$10/month, needs a verified identity) or an OV/EV certificate (hundreds a year). |
| macOS | Gatekeeper refuses to open the app at all; the user must right-click → Open, or run `xattr -dr com.apple.quarantine`. Recent versions bury this further. | **None.** Notarisation requires the Apple Developer Program. | $99 a year. The only thing in this whole step that costs money, and the only way to a clean macOS install. |
| Linux | none; AppImage just runs | — | — |

Decision: ship Windows and Linux unsigned in the first release, with the SmartScreen steps shown
on the download page in three sentences and one picture, and apply to SignPath in the same week.

**macOS is not shipped** (decided 2026-09-03). An unsigned macOS app is the worst of both worlds
for the person this step is for: Gatekeeper refuses to open it, and the way round is exactly the
kind of instruction the download page is supposed to spare them. Without the Apple Developer
licence there is no honest macOS build, and the licence is the one thing in this plan that costs
money. So, on the download page:

- The macOS slot is there, **greyed out**, next to the two live buttons — a visible gap rather
  than a silent one, so nobody wonders whether they missed it.
- Its text says, in this order: macOS is not supported because a clean build needs Apple's
  developer licence, which this project does not hold; **if you have that licence and would like
  to contribute the builds, open an issue** — the link goes to the repository's GitHub issues,
  and that is the only contact the page offers (decided 2026-09-03: no email address anywhere on
  the site; contact stays public and on GitHub); otherwise, **macOS users can run it from the
  source**, with a link to the repository and its Quick start, which is `git clone`, `npm install`,
  `npm start` and needs Node.
- The zip from step 3 also runs on a Mac with Node, and `running-anywhere.md` already says so; the
  slot links there as the second fallback.

Should a contributor with the licence turn up, the `.dmg` target and a `macos-latest` job are a
few lines each and are left commented in `electron-builder.yml` and `release.yml` for exactly
that. Signing secrets would then live in the repo's Actions secrets, provided by the contributor,
never in the tree.

### 5.6 Tasks — the website (`docs/` on GitHub Pages)

Decision: **serve `docs/` as-is with GitHub Pages' built-in Jekyll**, no build step, no second
copy of the documentation.

- GitHub Pages is free for public repositories, builds Jekyll on push with no workflow of our own,
  and the `jekyll-relative-links` plugin it enables by default turns the `[Chapters](chapters.md)`
  links these pages already use into working `.html` links. The docs become the website by being
  told to.
- The site is `https://gaetangiraud.github.io/lamplit/`. Repo setting: Pages → Source →
  `main`, folder `/docs`. (`has_pages` is `false` today; the URL answers a 301 to nowhere.)
- `docs/_config.yml`: a clean theme (`minima`, or `just-the-docs` via `remote_theme` for a
  sidebar), `relative_links` on, `title`, `description`, and `exclude: [development.md]` is *not*
  set — the development page belongs on the site too, at the end where it already is.
- **`docs/index.md` is the landing page and the one page written for someone who has never heard
  of a language model endpoint.** It is not the README. It has: one sentence saying what this is
  and one saying what it is not; the reading screenshot; three download slots — **Windows** and
  **Linux** as live buttons pointing at
  `https://github.com/GaetanGiraud/lamplit/releases/latest/download/<asset>`, the *latest*
  URL being stable so the page is never edited for a release, and **macOS greyed out** with the
  three-part text from 5.5 (not supported for want of the licence; contributors with one are
  welcome; run from source or the zip meanwhile, with the repository linked); under each live
  button, the two lines that OS will make the user read (5.5); then the three first-run questions from
  `getting-started.md`, with pictures; then "Where do I get a key?" with the providers from 5.7
  and a link to each one's key page; then a link into the guide. The npm way in stays, one line at
  the bottom, pointing at `development.md`.
- `docs/README.md` is the guide's index for people reading it on GitHub, and Jekyll renders it at
  `README.html`, which is where the pages' "← Documentation" links already point. It stays.
- `getting-started.md` is rewritten to lead with the download and treat `npm install` as the
  developer's route. `running-anywhere.md` keeps the zip and gains a sentence on when to prefer it
  (a machine that already has Node, a USB stick).
- The pictures are already real (`npm run screenshots`); the landing page uses the same ones.

Fallbacks: Cloudflare Pages or Netlify's free tier serve a folder from the repo with the same
zero-configuration; both are a matter of pointing them at `docs/`. The GitHub wiki is the last
resort for the guide alone, and only because it cannot hold the landing page.

### 5.7 Tasks — more providers, riding on SillyTavern

Today `Provider` is `'nanogpt' | 'custom'`, in four places. SillyTavern's
`src/endpoints/backends/chat-completions.js` keeps a base URL for twenty-odd chat-completion
sources, and its client `public/scripts/openai.js` knows each one's quirks. The plan is to lift
the URLs and the quirks, not the code: every one of these speaks OpenAI's chat-completions shape,
which is the only shape Lamplit sends.

**The question that decides the design is CORS**, because the browser calls the provider directly
(§1.4, and *docs/models-and-parameters.md*). Probed on 2026-09-03 with a preflight from
`http://localhost:4177` asking for `POST` with `authorization, content-type`:

| Provider | Base URL | Preflight | Quirks |
|---|---|---|---|
| NanoGPT | `https://nano-gpt.com/api/v1` | `*` | `?detailed=true` on `/models` (already done) |
| OpenRouter | `https://openrouter.ai/api/v1` | `*` | optional `HTTP-Referer` / `X-Title` headers for attribution — send the site URL and "Lamplit" |
| OpenAI | `https://api.openai.com/v1` | `*` | `/models` lists everything incl. non-chat; filter on the client is enough |
| Anthropic | `https://api.anthropic.com/v1` | `*` **only if** the request also carries `anthropic-dangerous-direct-browser-access: true` and `anthropic-version` | OpenAI-compatible `/chat/completions` is a documented compatibility layer; `/models` answers with the native shape (`data[].id` is there, `owned_by` is not) |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | echoes the origin | model ids come back as `models/gemini-…`; verify whether the prefix must be stripped for `/chat/completions` |
| Mistral | `https://api.mistral.ai/v1` | `*` | — |
| DeepSeek | `https://api.deepseek.com/v1` | echoes the origin | — |
| xAI | `https://api.x.ai/v1` | `*` | — |
| Groq | `https://api.groq.com/openai/v1` | `*` | — |
| Together | `https://api.together.xyz/v1` | `*` | not in ST's chat list (it is a text-completion source there); trivially OpenAI-compatible |
| Fireworks | `https://api.fireworks.ai/inference/v1` | `*` | — |
| Cohere | `https://api.cohere.ai/compatibility/v1` | `*` | the compatibility path, not ST's native `/v1` |
| Moonshot | `https://api.moonshot.ai/v1` | echoes the origin | — |
| Z.ai | `https://api.z.ai/api/paas/v4` | echoes the origin | — |
| SiliconFlow | `https://api.siliconflow.com/v1` | `*` | `.cn` variant exists |
| MiniMax | `https://api.minimax.io/v1` | `*` | `.minimaxi.com` for China |
| Chutes | `https://llm.chutes.ai/v1` | `*` | — |
| ElectronHub | `https://api.electronhub.ai/v1` | `*` | — |
| AIMLAPI | `https://api.aimlapi.com/v1` | `*` | attribution headers like OpenRouter |
| CometAPI | `https://api.cometapi.com/v1` | `*` | — |
| Pollinations | `https://gen.pollinations.ai/v1` | `*` | free tier without a key |
| Perplexity | `https://api.perplexity.ai` | `*` | **no `/models`** — the preset carries a typed list; the modal must accept a hand-typed model id when the list is empty |
| Cloudflare Workers AI | `https://api.cloudflare.com/client/v4/accounts/<id>/ai/v1` | not probed | needs an account id in the URL — a preset with a placeholder, second release |
| Azure OpenAI | per-deployment URL, `api-key` header, `api-version` query | not probed | a different shape in three ways; deferred |
| Vertex AI, AI21 | native protocols only | — | out of scope, as ST's own code confirms |

**Every provider on the list answers a browser preflight.** No proxy is needed, Electron changes
nothing here, and the key still goes from the user's machine to the provider and nowhere else.
That is worth knowing before writing a line: the whole task is data plus two small quirk hooks.

1. `core/providers.ts`: one record per row — `id`, `name`, `baseUrl`, `keyUrl` (where to get a
   key), `headers` (extra, fixed), `modelsQuery` (NanoGPT's `?detailed=true`), `modelsFixed`
   (Perplexity), `modelIdTransform` (Gemini, if needed), and a `group`: *Hosted*, *Aggregators*
   (OpenRouter, NanoGPT, AIMLAPI, CometAPI, ElectronHub, Chutes), *Local* (Ollama, LM Studio,
   llama.cpp, vLLM, KoboldCpp, TabbyAPI, text-generation-webui, all at their default ports, all
   already in the docs' known-good table).
2. `Provider` becomes `string`, keyed into that table, with `custom` still meaning "the URL is
   whatever was typed". The four places that check `'nanogpt'` read the record instead.
3. The connection modal's **Provider** select is grouped by `group`, and shows the **Get a key**
   link for the chosen one. The model list is fetched the way it is now; when a preset has
   `modelsFixed`, that list is used and **Fetch models** is hidden.
4. The model client takes `headers` from the record and merges them into every request. Nothing
   else in it changes; `stream_options` already has its retry for servers that reject it.
5. `tools/probe-providers.mjs` re-runs the preflight table above and prints it, so the table in
   `docs/models-and-parameters.md` can be regenerated with a date rather than trusted. Not in CI:
   it talks to twenty third parties and would fail for reasons that are not ours.
6. Unit tests: every preset's URL parses, has no trailing slash, and its `/models` request is
   built as the record says. One Playwright spec: switching provider swaps the URL and the key link.
7. Parameters stay global (§2.1.6) and only the OpenAI set is sent unless an advanced one is
   switched on, so no per-provider allow-list is needed — the thing ST's `OPENROUTER_KEYS` and
   friends exist for is a problem this app does not have.

### 5.8 Order of work

Providers first: it is small, it is pure data, and it improves the browser build the same day.
Then the shell, then the release workflow (a first unsigned release, as a draft, to prove the
pipeline), then the website — which cannot have download buttons until there is something to
download — then the SignPath application. Each is a separate session, as before.

**Built in that order on 2026-09-03**, in one session rather than five. What the writing above
did not know, and the doing found out:

- **Every one of the twenty-two providers answers a browser**, confirmed rather than assumed:
  `npm run providers` drives a real Chromium page on `localhost:4177` and prints the table.
- **Electron ignores `--user-data-dir`**, so a spec cannot get a first run that way. `LAMPLIT_USER_DATA`
  does, and it pays for itself twice: `PORTABLE_EXECUTABLE_DIR` beside it is what gives §5.3's
  portable build its `data/` next to the .exe.
- **`extraResources` will not copy `node_modules`** however the filter is written, so each staged
  piece is named on its own line in `electron-builder.yml`.
- **A prevented `will-quit` cannot be un-prevented.** Electron ignores the `app.quit()` that
  follows one, and the app hung on exit forever. It closes the server, gives the last beacon
  1.5 seconds, and then `app.exit(0)`.
- **§5.3's versioned artifact names cannot coexist with §5.6's stable download URLs.**
  `/releases/latest/download/<name>` is only a link if `<name>` never changes, so the artifacts
  are `Lamplit-Setup.exe`, `Lamplit-portable.exe`, `Lamplit.AppImage`,
  `Lamplit.deb`. The version is on the release, in the installer, and under **Help**.
- **The website needs no front matter and no `baseurl`.** GitHub Pages enables
  `jekyll-optional-front-matter`, `jekyll-relative-links`, `jekyll-titles-from-headings` and
  `jekyll-github-metadata` by default and cannot be told not to, which between them render the
  guide's plain markdown, rewrite its `.md` links, title each page from its own `# `, and fill in
  the project-site base path. The one thing they do **not** do is rewrite `href` attributes in raw
  HTML — so the landing page's HTML blocks link to `.html` directly, and every other page keeps
  the `.md` links that also work when it is read on GitHub.
- **Two things were fixed on the way that belong to earlier steps**, because the website is built
  out of them: `tools/screenshots.mjs` still seeded the demo story into localStorage, which §4.6
  removed, and the model field showed the id beside the name when shut, because a `::ng-deep` rule
  was written against markup `mat-select` does not produce.

### 5.9 Acceptance

A second person, on a machine that has never had Node on it, given only the website's URL:

1. Downloads the installer for their OS, gets through the warning using nothing but what the page
   told them, and installs.
2. Follows `e2e/LIVE-TEST.md` sections 1–4 and 9–10, with **On disk** meaning the `userData`
   folder `docs/desktop.md` names for their OS, and **Help → Open data folder** getting them there.
3. Never opens a terminal.

Plus: the Electron spec (5.2.6) green in the workflow on both runners, the Windows and Linux
installers on the release page, the landing page's two live buttons resolving to them and its
macOS slot greyed out with the source-install link working, and the provider spec green. Then
§7's checkpoint for step 4.

**Done, 2026-09-03.** v0.1.0 is published. The site is live at
<https://gaetangiraud.github.io/lamplit/>, its four download buttons resolve to real assets, and
Gaetan installed the Windows build from that page and ran it.

It took three tagged runs to get there, and each failure was one only a real runner could find:

1. **Electron 44 publishes no `scripts` at all.** No postinstall, so `npm ci` gave the runners the
   JavaScript and no binary, silently. Invisible on this machine because electron-builder
   downloads its own copy through @electron/get — only Playwright's `_electron.launch()` uses the
   one in `node_modules`. Fixed by `tools/fetch-electron.mjs` on `postinstall`; recorded in §0.
2. **The desktop spec raced its own write.** It waited for `settings.json` to exist and then read
   it, but the app writes that file when it creates the first story, before the typed key lands.
   This machine won the race every time; a colder runner did not. It polls for the key now.
3. **The actions were on Node 20**, deprecated by GitHub. checkout, setup-node and upload-artifact
   are on v7, proved by a `workflow_dispatch` run after the release rather than during it.

The thing that made all three findable was the commit before the first tag, which turned CI's
`test.skip` into a thrown error: a green workflow that had quietly skipped the desktop spec would
have published installers nothing had ever opened.

Still open, and neither is code: the **SignPath application** (§5.5), which needed a published
release to point at and now has one; and the **SmartScreen picture** for the download page, which
can only be taken from a file carrying the mark of the web — so from the published release, not
from a local build.

---

## 6. Cross-cutting decisions and assumptions

- Single user, local machine. The API key is stored in `settings.json` in plain text. Acceptable
  for a local tool; noted in the README.
- No images anywhere. No group-chat mechanics, no swipes/variants, no extensions system, no
  text-completion (non-chat) APIs. Only OpenAI-style chat completions, streaming only.
- Token counting is an estimate. The context slider is a budget, not a guarantee; the app shows
  the provider's real `usage` after each reply so the user can calibrate.
- Persona, characters and world belong to the story (one story = one self-contained file).
  Chapters are separate files because they are appended to forever and read one at a time.
  Reuse is via "Duplicate story". A shared library can be added later if it turns out to matter.
- A chapter's scene is fixed once written, but never locked: "Edit scene" is always available,
  and since the prompt is rebuilt from data every time, an edit takes effect on the next reply
  without touching what has already been written.
- Keyboard: Enter send, Shift+Enter newline, Esc closes modals (and saves), Ctrl+Enter
  regenerate last, Ctrl+K opens the model picker.

## 7. Order of work and checkpoints

| Step | Deliverable | Checkpoint |
|---|---|---|
| 1 | Streaming chat + connection + parameters, localStorage only (the conversation becomes Chapter 1 in step 2) | **Done 2026-09-02.** 22 unit tests + 14 Playwright specs green against the fake endpoint; NanoGPT's live model list confirmed from the browser (612 models, no key, CORS fine). The live-key half of E2E 2.2 still needs Gaetan. |
| 2 | Chapters with compulsory scenes, story / persona / world / lore, prompt builder, close chapter | **Done 2026-09-03.** 37 unit tests + 24 Playwright specs green against the fake endpoint. Live E2E 3.2 still needs Gaetan's key. |
| 3 | Express persistence, bootstrap, status indicator, packaging | **Done 2026-09-03.** 53 app unit tests + 30 server unit tests + 39 Playwright specs green, five of them driving the production build served by the real server and asserting against the files on disk. `npm run package` produces a ~1 MB zip that runs from one call. Electron deliberately left for later. **Live test still open:** `e2e/LIVE-TEST.md` with Gaetan's key — the prose verdict and, above all, the cost verdict in its section 11, which decides whether the premise holds before step 4 makes the app easier to reach. |
| 4 | Electron shell and installers for Windows and Linux (macOS deliberately not shipped — greyed out on the page, open to a contributor with the licence, source install as the fallback), a tagged-release workflow publishing to GitHub Releases, `docs/` served as the website with a landing page and download buttons, a provider table lifted from SillyTavern (§5) | **Done 2026-09-03.** 67 app unit tests + 30 server + 59 Playwright specs green, three of the last driving the Electron shell for real. `npm run desktop:dist` produces the Windows installer and portable build; both were run, written to and quit by hand, and the portable one keeps `data/` beside itself. Twenty-two providers, every one confirmed from a browser the same day. v0.1.0 published from the third tagged run, both runners green at 59 specs each. The site is live, its four buttons resolve, and the Windows installer was downloaded from it and run. §5.9 has the three CI-only faults the runs found. |

Each step is a separate session. Nothing from a later step is started before the previous
checkpoint passes — for step 4, that means the live test's verdict comes first.
