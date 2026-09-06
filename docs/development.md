# Development

[← Documentation](README.md) · Previous: [Upgrading](upgrading.md)

---

## Layout

```
app/        Angular 21 workspace — standalone components, signals, zoneless
  core/       model client, SSE reader, error mapping, token estimates,
              story formatting, the prompt builder
  store/      signal stores (one per document type), and the persistence layer
              they write through: the session's documents, and the server
  features/   chapters (page, message list, composer, scene sheet, chapters
              list, close chapter, prompt preview), connection, generation,
              story, world
  shared/     top bar, save indicator, dialog openers, editor field, controls
server/     Express 5 — JSON documents on disk, the built app in front of them,
            a dependency-free zip writer, and the build stamp (version.js: which
            build this is, and which one wrote this data folder last).
            share.js is the second listener and the pairing lock in front of
            it, which is how a phone on the same network reads the story
electron/   the desktop shell: main process, preload, electron-builder config.
            It starts the same server in-process and opens one window at it,
            and knows nothing else about the app
tools/      dev.mjs (both halves at once), package.mjs (the runnable zip),
            desktop.mjs (the window, and the installers), smoke.mjs (a fresh
            install to walk by hand, and --check to prove one in CI),
            screenshots.mjs (every picture in docs/),
            icons.mjs (the raster icons), probe-providers.mjs (the CORS table),
            check-docs.mjs (the links in docs/ survive becoming a website),
            release-notes.mjs (docs/releases.md from CHANGELOG.md),
            fetch-electron.mjs (Electron's binary, which npm ci does not fetch)
e2e/        Playwright specs + a fake OpenAI endpoint
docs/       these pages, and — served by GitHub Pages — the website
.github/    ci.yml: every check, on every push to main; release.yml: the same
            checks and then the installers, on a tag; actions/verify: the
            checks themselves, so the two workflows share one list
```

`eslint.config.mjs` at the root is the one lint configuration for all of it, and
`.prettierrc` the one formatting configuration.

`PLAN.md` at the root is the plan of record: four steps, what each one had to do, and — more
usefully — why each decision went the way it did.

## Scripts

| | |
|---|---|
| `npm start` | Both halves: persistence server on 4177, dev server on 4200 proxying `/api` to it. The proxy is why the API authorises no cross-origin request: nothing calls across. `LAMPLIT_DEV_CORS=1` puts the localhost allowance back for a dev server run without it |
| `npm run server` | Just the server (and the built app, if there is one). The front end has no standalone mode: it reads its documents from the server or does not start |
| `npm run build` | Angular production build into `app/dist` |
| `npm run package` | The runnable zip — see [Running it anywhere](running-anywhere.md) |
| `npm test` | Unit tests, both workspaces; `npm run test:app` and `npm run test:server` run one of them |
| `npm run lint` | ESLint over the whole tree: the type-aware rule sets on `app/`, the recommended ones on everything else. `npm run lint:fix` applies what can be applied |
| `npm run e2e` | Builds the app, then the full Playwright suite |
| `npm run e2e:quick` | Playwright without the build (skips the specs that need it) |
| `npm run smoke` | Packages, unzips the archive into an empty folder, and starts it — a genuinely fresh install to walk by hand. `--check` stops as soon as it answers `/api/health` and exits, which is how CI runs it |
| `npm run screenshots` | Regenerates every picture in `docs/images` |
| `npm run icons` | Regenerates favicon.ico and apple-touch-icon.png from `app/public/favicon.svg` |
| `npm run providers` | Asks every provider in the list whether it still lets a browser call it, and prints the table for [Models and parameters](models-and-parameters.md). Not in CI: it talks to twenty companies |
| `npm run electron` | Downloads Electron's binary. Runs on `postinstall`, so normally you never call it — Electron 44 ships no install script of its own, and `npm ci` alone leaves you with the JavaScript and no executable |
| `npm run desktop` | Opens the Electron window against the repository — no packaging, so a change to the app needs `npm run build` and a reload |
| `npm run desktop:stage` | Stages the folder the installers wrap (`build/desktop-stage`), and stops |
| `npm run desktop:dist` | Stages, then builds installers for the OS you are on, into `build/desktop` |
| `npm run check:docs` | Every link in `docs/` resolves, and will survive being turned into a website. Offline, and in CI |
| `npm run notes` | Regenerates `docs/releases.md` from `CHANGELOG.md`, the release notes page of the website. `npm run check:notes` fails if the two have drifted apart, and is in CI |
| `npm run format` | Prettier over everything. `npm run format:check` changes nothing and fails if it would have; that is the form CI runs |

## Tests

**Unit — `npm test`.** Vitest for the app: the SSE reader, the request builder, error mapping,
token estimates, the story formatter, the prompt builder (block order, the scene verbatim, lore
scanning, budget trimming, chapter titles, the summary request), and the persistence layer (the
startup load, coalescing, sequence numbers, offline queueing, and refusing to start without a
server). `node --test` for the server: the document store's write ordering and atomic writes, the
API, the zip writer, the daily backup, and the build stamp (reading it, the dev fallback, and how
an upgrade is noticed).

**End to end — `npm run e2e`.** Playwright drives the real app against
`e2e/fake-openai-server.mjs`, a deterministic stand-in for an OpenAI-compatible endpoint. Both
servers start automatically; no tokens are spent and no key is needed. The fake endpoint takes
instructions from the message text: `!slow`, `!long`, `!error`, `!401`, `!prose`, and `!nolore`,
which fails the lore request alone and streams the reply as usual. The model id a spec seeds into
the settings decides how well the endpoint speaks JSON: `fake/no-json-schema` refuses
`response_format` with a 400 and answers inside a ```json fence, the way an endpoint that has
never heard of schemas does; any other id takes the schema and answers with a bare object.

Two projects, because there are two layouts. `chromium` is a desktop window and everything under
`e2e/specs/`; `phone` is a Pixel 7 profile and `e2e/specs/phone/`, which is where the phone layout
is tested — a coarse pointer, no hover, and a 412px viewport. It is that pointer rather than the
width that decides whether Enter sends and whether a message's actions are a rail or a menu, and
it cannot be had by making a desktop window narrow. See [On your phone](on-your-phone.md) for what
the layout is.

**Every** spec runs against the real server serving the real production build, on its own port
with its own empty data folder — the `server` fixture in `specs/fixtures.ts`. There is no dev
server in the suite and no browser-storage mode to fall back on, so a spec seeds by writing JSON
into that folder, which is exactly what a person does when they copy a story onto a new machine.
Each test is isolated by construction: nothing carries over, because there is nowhere for it to
carry over in. That is why `npm run e2e` builds first; `npm run e2e:quick` skips the build, and
skips everything if there is nothing built.

The seeding itself is the `app` fixture beside it, written once: `app.open()` is a connected app
with one story, its opening chapter already on a scene, and `app.seed()` and `app.visit()` are the
two halves of that for the specs that put something else on disk in between. A spec that says
`app.open({ scene: '' })` is asking for the state before anyone has written a scene, and a spec
that names a scene of its own is saying the words in it matter.

- **`persistence.spec.ts`** — the disk as the story: documents written as the UI changes them, a
  reload coming back to what is on disk rather than to what was there before, a second browser
  seeing the same story, the server going away mid-chat and catching up, two tabs, deleting a
  story taking its files with it, and the app refusing to start when the documents cannot be
  read.
- **`journey.spec.ts`** — the whole app, once, in narrator mode, from nothing. Eleven stages in
  order, sharing one page, walked through the interface the way a person would: the connection
  sheet insisting, the story questions, the scene refusing whitespace, the first turn's prompt in
  the right order, the story so far, lore staying out until the story mentions it, closing a
  chapter, chapter 2 carrying the summary and not the transcript, and an empty browser reading the
  lot back. It is the regression net for the shape of the app rather than for any one feature.

The human half of the same walk is `npm run smoke` plus the script in `e2e/LIVE-TEST.md` — every
prompt written out, a table per stage with the expected result beside it, and a worksheet for the
one thing a fake model cannot check: whether a real one tells a decent story, and what it costs.

**On every push — CI.** `.github/workflows/ci.yml` runs on each push to `main` and on each pull
request: `npm ci`, lint, the formatting check, the docs and release-notes checks, the unit tests,
the production build, the packaged folder started for real, and the end-to-end suite, on Ubuntu, in
about three minutes. The steps are
`.github/actions/verify`, and the release workflow runs the same action on both platforms before
it builds an installer, so a tag cannot pass a check that `main` would fail. The badge at the top
of the README is the last run on `main`.

## How the screenshots are made

`npm run screenshots` (`tools/screenshots.mjs`) starts the persistence server on the production
build, drives a real browser through the app, and writes what the app actually draws into
`docs/images`. Nothing in these pages is a mock-up.

The model behind it is a small stand-in inside the script that answers with the demo story's own
prose, so the pictures are identical every run and no tokens are spent taking them. Each phase
gets an empty data folder, because the server is the truth at startup.

Change the UI, re-run it, commit whatever moves.

## The shape of the code

A few things are worth knowing before reading it:

- **The whole prompt is rebuilt from the documents on every request.** There is no conversation
  object and no accumulated state. Edit, regenerate and replay are not special paths — they all go
  through the same builder as a fresh send. See [The prompt](the-prompt.md).
- **One store slice = one JSON file.** The stores are plain Angular services holding
  `signal()`/`computed()` state, one per document type. No NgRx: the persistence model maps onto a
  hand-rolled signal store 1:1 with no ceremony.
- **One place a document lives.** The server. The app reads every document once at startup into a
  map that lasts the session; writes go to that map and to the server. The stores stay synchronous
  and know about neither. It used to keep a `localStorage` copy as well, which bought a merge on
  every startup, a persisted write queue and a rule for which side wins — all of it gone, and
  `Persistence` says why in its header.
- **No SDK, no HTTP client, no state library.** `fetch`, a hand-written SSE parser, and
  `AbortController` for Stop.
- **Angular 21, zoneless.** Signals throughout, the new control flow, `inject()`, standalone
  components. Material is used for dialogs, menus, tabs, sliders, switches and tooltips; everything
  that has to look good — the chat itself, and every field in it — is hand-written. A field is a
  label above a box (`li-field`, or `li-editor-field` where the box holds a paragraph), and the
  frame round the box is one rule in `styles.scss` over `input`, `textarea` and `select` alike.
  How tall a box is, is one of three names — `li-rows-short`, `li-rows-medium`, `li-rows-tall` —
  put on the box or on anything above it; every modal opens through `DialogsService`, at one of
  four widths; and a Material button whose label can be longer than the room there is wears
  `li-truncates`, which is what makes it end in an ellipsis rather than mid-word.
- **Every media query is a mixin in `app/src/breakpoints.scss`.** The five widths and the three
  things the reader's machine answers are declared there, each with the question it asks; a
  component includes one and writes no threshold of its own. The two widths that TypeScript also
  has to know are published as custom properties and read back off `<html>` in `core/layout.ts`, so
  no number is written twice.

## Conventions

- Prettier settings are in `.prettierrc`; `npm run format` before committing.
- `npm run lint` before committing too. Every rule `eslint.config.mjs` turns off says why in a
  comment beside it; a rule that fights a deliberate choice of the codebase is not one the codebase
  wants, and a rule that is merely inconvenient stays on. The `app/` tsconfig has
  `noUnusedLocals`, `noUnusedParameters` and `noUncheckedIndexedAccess` on;
  `exactOptionalPropertyTypes` was tried and is not, and the file says why.
- The repo is LF everywhere (`.gitattributes`), including on Windows.
- Comments explain **why**, not what. If a comment restates the line under it, delete one of them.
- `data/`, `backups/`, `build/` and `dist/` are ignored, and should stay that way.
