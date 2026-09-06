import { chromium, devices } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createSocket } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `npm run screenshots` — every picture in docs/, taken from the real app.
 *
 * Nothing here is mocked up: it starts the persistence server on the production
 * build, drives a browser through the app, and writes what the app actually
 * draws. The model behind it is a small stand-in that answers with the demo
 * story's own prose, so the pictures are the same every time and no tokens are
 * spent taking them.
 *
 * Re-run it after a change to the UI and commit whatever moves.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'images');
const BUILT_APP = join(ROOT, 'app', 'dist', 'app', 'browser');

/** Wide enough for the modals, short enough to read at a glance on GitHub. */
const VIEWPORT = { width: 1240, height: 800 };

/**
 * And the other layout. A Pixel 7's own profile — its user agent, its coarse
 * pointer, its touch events — but a 390-wide viewport, which is the narrow end
 * of what people actually hold, and two device pixels per CSS pixel rather
 * than the phone's 2.625, because these are read at a couple of inches wide on
 * a documentation page and not on the phone itself.
 */
const PHONE = {
  ...devices['Pixel 7'],
  viewport: { width: 390, height: 760 },
  deviceScaleFactor: 2,
};

// -- the story the pictures tell ---------------------------------------------

const STORY_ID = 'demo-story';
const CHAPTER_1 = 'demo-chapter-1';
const CHAPTER_2 = 'demo-chapter-2';
const MODEL = 'demo/lamplighter-large';

/**
 * A second story, cast one character at a time, for the one picture that is
 * about who is speaking. The demo story is a narrator's and has no names on it,
 * which is exactly what makes it the wrong story for that shot.
 */
const CAST_STORY_ID = 'demo-cast-story';
const CAST_STORY_TITLE = 'The Keeper’s Stair';
const CAST_CHAPTER = 'demo-cast-chapter';

const SCENE_1 =
  'The lantern room, an hour before dusk, rain on the seaward glass. The lamp is running ' +
  'on its timer and nobody has been up here in weeks. The door at the bottom of the stairs ' +
  'was unlocked from the inside, and Mara did not unlock it.';

const SCENE_2 =
  'The keeper’s cottage the same night, the fire lit for the first time since March. ' +
  'Two mugs on the table. Only one of them is Mara’s.';

const SCENE_3 =
  'The lantern room, the same evening. Nell has not moved from the seaward glass, and the man ' +
  'on the stair below has not come up.';

/** The turns the cast story is seeded with: a run of Nell's, and then Tomas. */
const CAST_PASSAGES = [
  '"Fifty-one years I have been up these stairs," she says.',
  '"Ask him for the rest of it. He is on the stair, and he has been since four."',
  [
    '*Below, the sound of a man getting to his feet.*',
    '"She tells it wrong," he says. "She always has."',
  ].join('\n\n'),
];

const STORY_SO_FAR =
  'Mara Vance came back to Ash Head for a fortnight of survey work and found her father’s ' +
  'lighthouse the way he left it in March: automated, weatherproof, and locked. Nine of her ' +
  'fourteen days are gone. She has not been inside it since she was twenty-two.';

/**
 * What /api/updates would say if 0.2.0 had been published. Only the shot of
 * the What's new sheet uses it; every other picture is the app as it is.
 */
const NEWER_VERSION = {
  ok: true,
  enabled: true,
  checked: true,
  version: '0.1.0',
  latest: null,
  newer: [
    {
      tag: 'v0.2.0',
      version: '0.2.0',
      name: '0.2.0 — preferences, colours and the prompt in your own order',
      publishedAt: '2026-04-02T09:00:00.000Z',
      body: [
        '**The Reading menu is now Preferences.** Three sections — Reading, Colours,',
        'Advanced — with the four reading settings exactly where they were.',
        '',
        '- **Every colour the theme is built from** is a swatch you can change, and the',
        '  page redraws as you drag. Each theme keeps its own set.',
        '- **A reading font** — the serif it ships with, a sans, or a mono.',
        '- **The prompt’s blocks can be reordered** per story, in What the model sees.',
        '- **Developer mode**, for the parts of the app that are about the app.',
      ].join('\n'),
      url: 'https://github.com/lamplit-app/lamplit/releases/tag/v0.2.0',
      assets: [],
    },
  ],
  releases: [],
};

/** What the stand-in model answers a live turn with. */
const REPLY = [
  '*She does not answer at once. She crosses to the seaward glass and rubs a circle in it with ' +
    'her sleeve, as though checking the sea is still where she left it.*',
  '"Nell," she says. "I kept house for Tomas, and then I kept the light with him, and when your ' +
    'father came I kept out of his way."',
  '*She turns round.*',
  '"Fifty-one years I have been up these stairs. You have been up them twice."',
].join('\n\n');

/** The passages the chapter is seeded with, so the page has something on it. */
const PASSAGES = [
  [
    'The steps are colder than she remembers and a good deal wetter, and she loses count ' +
      'somewhere past sixty, because the wind has found a way in above her and is doing ' +
      'something at the top of the stairs that sounds too much like breathing.',
    '*The last turn opens into grey light.*',
    '"You took your time," says a voice from the dark side of the gallery.',
    'Mara does not answer. She is looking at the floor, where nine years of gulls have been ' +
      'swept into one neat pile beside the door, as though somebody meant to come back for it.',
    '"He left it for you," the voice says. "Not for me."',
  ].join('\n\n'),
  [
    '*The figure steps into the light and turns out to be smaller than the voice.*',
    'An old woman, oilskin to the ankles, hair the colour of the rain outside.',
    '"Tomas kept this light before your father did," she says, "and I kept Tomas. So you ' +
      'will forgive me for knowing the way up."',
  ].join('\n\n'),
];

const SUMMARY =
  'Mara Vance came back to Ash Head with nine of her fourteen survey days already gone, and ' +
  'found her father’s lighthouse unlocked from the inside. She climbed to the lantern room ' +
  'and was met there by an old woman in oilskins who had swept the gallery clean and who ' +
  'spoke of Tomas, the keeper before him, as somebody she had known. Whatever her father ' +
  'left behind, the woman says, was left for Mara and not for her. Mara has not asked for ' +
  'the key, and has not been told where it is.';

/** What the stand-in proposes when a chapter is closed: one new, one update. */
const PROPOSED = [
  {
    title: 'Nell',
    category: 'person',
    keys: ['nell', 'the old woman'],
    content:
      'Kept house for Tomas and then kept the light with him. Eighty-one, oilskin to the ankles, ' +
      'and has been up the tower more often than anyone living.',
    updates: '',
  },
  {
    title: 'Old Tomas',
    category: 'person',
    keys: ['tomas', 'keeper'],
    content:
      'Kept the light for nineteen years before Mara’s father, and left the island in 1971. Nell ' +
      'kept house for him, and speaks of him as somebody she knew well.',
    updates: 'Old Tomas',
  },
];

const LORE = [
  {
    id: 'lore-tomas',
    title: 'Old Tomas',
    category: 'person',
    keys: ['tomas', 'keeper'],
    content:
      'Kept the light for nineteen years before Mara’s father. Left the island in 1971 without ' +
      'telling anyone why. His name is scratched into the lantern room floor, twice.',
    enabled: true,
    alwaysOn: false,
  },
  {
    id: 'lore-lantern',
    title: 'The lantern room',
    category: 'place',
    keys: ['lantern room', 'gallery', 'lamp'],
    content:
      'A hundred and nine iron steps above the door. The first-order lens went to a museum in ' +
      '1998; what turns now is an LED on a timer, and a gull’s nest nobody has cleared.',
    enabled: true,
    alwaysOn: false,
  },
  {
    id: 'lore-fortnight',
    title: 'The fortnight',
    category: 'fact',
    keys: ['survey', 'fortnight'],
    content:
      'Mara has fourteen funded days on Ash Head and no reason anyone would accept for staying ' +
      'longer. Nine of them are gone.',
    enabled: true,
    alwaysOn: true,
  },
];

// -- the run ------------------------------------------------------------------

await mkdir(OUT, { recursive: true });
const modelPort = await freePort();
const appPort = await freePort();
const health = `http://127.0.0.1:${appPort}/api/health`;

const model = startModel(modelPort);
const browser = await chromium.launch();
const shots = [];
const dataDirs = [];
let persistence = null;

try {
  // Each phase gets an empty data folder, because the server is the truth at
  // startup: the story the first-run walk creates would otherwise be the story
  // the second walk finds waiting for it.
  await freshServer();
  await firstRun();
  await freshServer({ withStory: true });
  await theApp();
  await freshServer({ withStory: true });
  await onAPhone();
  await socialCard();
} finally {
  await browser.close();
  persistence?.kill();
  model.close();
  for (const dir of dataDirs) await rm(dir, { recursive: true, force: true });
}

console.log(`\n${shots.length} pictures in docs/images:`);
for (const name of shots) console.log(`  ${name}`);

/** A browser that has never seen the app: what a fresh install opens on. */
async function firstRun() {
  const { page, close } = await session();
  await shot(page, 'first-run-connection', 'the connection sheet a fresh install opens on');

  await page.getByLabel('Provider').selectOption('custom');
  await page.getByLabel('Endpoint URL').fill(`http://127.0.0.1:${modelPort}/v1`);
  await page.getByRole('button', { name: 'Fetch models' }).click();
  await page.getByLabel('Model', { exact: true }).selectOption(MODEL);
  await page.getByRole('button', { name: 'Test' }).click();
  await page.getByText(/The model answered/).waitFor();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('heading', { name: 'Your first story' }).waitFor();
  await shot(page, 'first-run-story', 'who tells the story, and who you play');

  await page.getByLabel('Title').fill('The Lantern Room');
  await page.getByLabel('Name').fill('Mara');
  await page
    .getByRole('textbox')
    .last()
    .fill('A marine biologist, thirty-one, back on the island after nine years.');
  await page.getByRole('button', { name: 'Write the first scene' }).click();
  await page.getByRole('heading', { name: /Chapter 1 — the scene/ }).waitFor();
  await page.locator('textarea.scene').fill(SCENE_1);
  await page.waitForTimeout(400);
  await shot(page, 'scene', 'the scene sheet, the one compulsory step in the app');
  await close();
}

/** Everything else, over a story that has already been written in. */
async function theApp() {
  const { page, context, close } = await session();
  const chapter = page.locator('article[data-role]');
  await chapter.first().waitFor();

  await shot(page, 'reading', 'the reading surface: a chapter, book-styled');

  // The website's hero, which is the same page seen from higher up: scrolled to
  // the start of the chapter and cropped above the composer, so the picture is
  // the book rather than the app. Nothing is hidden to take it — the composer
  // is simply not in this part of the scroller.
  const scroller = page.locator('li-chapters-page .page');
  await scroller.evaluate((el) => (el.scrollTop = 0));
  await page.waitForTimeout(500);
  await shot(page, 'hero', 'the chapter from the top, for the website', {
    clip: { x: 0, y: 0, width: VIEWPORT.width, height: 700 },
  });
  await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.waitForTimeout(500);

  // A real turn, streamed by the stand-in model into the real composer: once
  // part-way through, with Stop up, and once finished.
  const stop = page.getByRole('button', { name: 'Stop', exact: true });
  await write(page, '"Who are you?" I say, and I do not move.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await stop.waitFor({ timeout: 20_000 });
  await page.waitForTimeout(500);
  await shot(page, 'streaming', 'an answer arriving, with Stop up');
  await stop.waitFor({ state: 'hidden', timeout: 20_000 });
  await page.waitForTimeout(400);
  await shot(page, 'reading-answered', 'the answer, with the model and its token count under it');

  // What a message offers when the pointer is over it, out in the margin
  // rather than over the first line of what it is about.
  await chapter.last().hover();
  await page.waitForTimeout(400);
  await shot(page, 'message-actions', 'edit, regenerate, copy, delete — out in the margin');

  // The chapter's own fields, beside the page rather than over it. At this
  // width it pushes the reading column aside, which is the whole point of it.
  await page.getByRole('button', { name: 'Open the chapter panel' }).click();
  await page.waitForTimeout(500);
  await shot(page, 'chapter-panel', 'the scene, the narrator and the persona, beside the page');
  await page.getByRole('button', { name: 'Close the chapter panel' }).click();
  // Off the handle again: left under it, its tooltip covers the top bar and
  // the next click lands on the tooltip instead of the button it wanted.
  await page.mouse.move(40, 600);
  await page.waitForTimeout(400);

  // The prompt preview is behind developer mode, so it is switched on for this
  // one picture and off again: every other shot is the app a writer sees, and
  // the context pill is not part of that.
  await setDeveloperMode(page, true);
  await page
    .locator('li-composer')
    .getByRole('button', { name: /^context/ })
    .click();
  await page.getByRole('heading', { name: /model sees/ }).waitFor();
  await page.waitForTimeout(400);
  await shot(page, 'prompt-preview', 'the assembled prompt, block by block');
  await escape(page);
  await setDeveloperMode(page, false);

  await page.getByRole('button', { name: 'World', exact: true }).click();
  await page.waitForTimeout(500);
  await shot(page, 'world', 'the story so far, always sent');
  await page.getByRole('tab', { name: 'Lore' }).click();
  await page.waitForTimeout(400);
  await shot(page, 'lore-collapsed', 'a world of entries, one line each');
  await page.locator('.entry').first().click();
  await page.waitForTimeout(400);
  await shot(page, 'lore-open', 'one entry open: keys, what is true, when it fires');
  await escape(page);

  await page.getByRole('button', { name: 'Story', exact: true }).click();
  await page.waitForTimeout(500);
  await shot(page, 'story-mode', 'narrator or role-play');
  await page.getByRole('tab', { name: 'Persona' }).click();
  await page.waitForTimeout(400);
  await shot(page, 'story-persona', 'who you play');
  await escape(page);

  // The model, and everything about how it is asked: one sheet with two tabs,
  // opened from the model's own name in the bar.
  //
  // The sheet is taller than the window and testing scrolls it to the answer.
  // A taller window for these two pictures shows the whole thing rather than a
  // slice of it; every other shot keeps the standard viewport. Material caps
  // the scrolling part of a sheet at 65vh, so the window is what decides how
  // much of it is drawn, and every field wearing a name of its own made this
  // one about two hundred pixels taller than the window used to allow for.
  await page.getByRole('button', { name: /Lamplighter Large/ }).click();
  await page.getByRole('button', { name: 'Test' }).click();
  await page.getByText(/The model answered/).waitFor();
  await page.setViewportSize({ ...VIEWPORT, height: 1150 });
  await page.locator('mat-dialog-content').evaluate((el) => (el.scrollTop = 0));
  await page.waitForTimeout(400);
  await shot(page, 'connection', 'the Connection tab: provider, endpoint, key, model, tested');
  await page.getByRole('tab', { name: 'Parameters' }).click();
  await page.waitForTimeout(500);
  await shot(page, 'parameters', 'the Parameters tab: the sampling set, and the context budget');
  await page.setViewportSize(VIEWPORT);
  await escape(page);

  await page.getByRole('button', { name: 'Chapters' }).click();
  await page.waitForTimeout(500);
  await shot(page, 'chapters', 'every chapter of the story, and what is in it');
  await escape(page);

  // Preferences: Reading as it opens, then each folded section in the order it
  // is met, then the light theme the first one can switch to.
  await openPreferences(page);
  await page.waitForTimeout(400);
  await shot(page, 'preferences', 'text size, book style, theme');
  // Reading folded away so the whole of each section below is in the frame.
  await page.getByRole('button', { name: 'Reading' }).first().click();
  await page.getByRole('button', { name: 'Accessibility' }).first().click();
  await page.waitForTimeout(500);
  await shot(page, 'preferences-accessibility', 'contrast and motion, and what they follow');
  await page.getByRole('button', { name: 'Accessibility' }).first().click();
  await page.getByRole('button', { name: 'Colours' }).first().click();
  await page.waitForTimeout(600);
  await shot(page, 'preferences-colours', 'the ten pages a story can be read on');
  // The section is taller than the sheet now that the palette row is at the
  // top of it, and the swatches are what the second half of the guide's
  // Colours section is about — so they get a frame of their own.
  await page
    .getByRole('dialog')
    .locator('mat-dialog-content')
    .evaluate((node) => node.scrollTo(0, node.scrollHeight));
  await page.waitForTimeout(400);
  await shot(page, 'preferences-swatches', 'every colour the theme is built from');
  await page.getByRole('button', { name: 'Colours' }).first().click();
  await page.getByRole('button', { name: 'Advanced' }).first().click();
  await page.waitForTimeout(500);
  await shot(page, 'preferences-advanced', 'developer mode, and what it puts back');
  await page.getByRole('button', { name: 'Advanced' }).first().click();
  await page.getByRole('button', { name: 'Reading' }).first().click();
  await page.waitForTimeout(400);
  await page.getByRole('switch', { name: 'Dark theme' }).click();
  await escape(page);
  await page.waitForTimeout(500);
  await shot(page, 'light', 'the same chapter, light');
  await openPreferences(page);
  await page.getByRole('switch', { name: 'Dark theme' }).click();
  await escape(page);
  await page.waitForTimeout(400);

  // A newer version, which there is no way to publish from here: the answer
  // the server would have given is fabricated for this one picture and taken
  // away again after it, so no other shot has the pill in it.
  await page.route('**/api/updates', (route) => route.fulfill({ json: NEWER_VERSION }));
  await page.reload();
  await page.getByRole('button', { name: /available$/ }).click();
  await page.getByRole('heading', { name: /new|Release notes/ }).waitFor();
  await page.waitForTimeout(500);
  await shot(page, 'whats-new', 'a newer version, and what changed in it');
  await escape(page);
  await page.unroute('**/api/updates');
  await page.reload();
  await page.waitForTimeout(800);

  // The author's voice, caught in the composer with the two halves apart: the
  // tag has already been taken out of the prose and what follows it is in the
  // author's own field, so the split is readable before anything is sent.
  await write(page, 'I take the key off the hook.\n[AUTHOR] Nell refuses to follow her up.');
  await page.waitForTimeout(500);
  await shot(page, 'author', 'a line of the story, and a direction the model must follow');

  // And where it stays once it is sent: a note under the prose, never in it.
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await stop.waitFor({ timeout: 20_000 });
  await stop.waitFor({ state: 'hidden', timeout: 20_000 });
  await page.waitForTimeout(500);
  await shot(page, 'author-note', 'the direction as the page keeps it: a note, not a line');

  // The other story: role-play, cast one character at a time, so the page has
  // names on it. The demo story is a narrator's and never has any, which is
  // what makes it the wrong story for this one picture.
  await switchStory(page, CAST_STORY_TITLE);
  await shot(page, 'speakers', 'who is speaking, named once per run of turns');
  await switchStory(page, 'The Lantern Room');

  await page.getByRole('button', { name: 'Close chapter' }).click();
  await page.getByRole('heading', { name: /^Close Chapter/ }).waitFor();
  // Let the summary finish streaming into the review sheet.
  await page.waitForTimeout(3000);
  await shot(page, 'close-chapter', 'the rewritten story so far, before it lands');

  // The same sheet, asked for what the chapter established: a new entry ticked
  // and an update to an existing one waiting to be asked for. Pressed rather
  // than switched on, because off is what a story starts as.
  await page.getByRole('button', { name: 'Propose lore' }).click();
  await page.getByRole('button', { name: 'Propose again' }).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(400);
  await page.locator('mat-dialog-content').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.waitForTimeout(400);
  await shot(page, 'lore-proposals', 'what the chapter established, as entries to tick');
  await escape(page);

  // The one time the backend is visible: when it stops answering.
  await context.setOffline(true);
  await openPreferences(page);
  await page.getByRole('switch', { name: 'Show token counts' }).click();
  await escape(page);
  await page.getByRole('button', { name: 'Offline' }).waitFor({ timeout: 20_000 });
  await shot(page, 'offline', 'the server stopped answering; nothing is lost', {
    clip: { x: 0, y: 0, width: VIEWPORT.width, height: 53 },
  });
  await context.setOffline(false);

  await close();
}

/**
 * The same story, the same server, a phone in front of it.
 *
 * A fresh data folder rather than the one `theApp` has just written a chapter
 * into, so the picture is the demo story as the guide describes it — and the
 * page a reader would actually arrive at from the QR code, which is the story
 * where they left it.
 */
async function onAPhone() {
  const context = await browser.newContext({
    ...PHONE,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${appPort}/`);
  await page.locator('article[data-role]').first().waitFor();
  await page.waitForTimeout(1200);

  await shot(page, 'phone-reading', 'the same chapter on a phone: the story, and the box');

  // The one menu, and the whole of what a phone is offered: the story, the
  // world, the chapters, the panel, and this chapter's own turning points.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menu').waitFor();
  await page.waitForTimeout(400);
  await shot(page, 'phone-menu', 'the one menu the phone layout puts everything behind');

  // And the panel it opens, which is a sheet at this width rather than a
  // column beside the page.
  await page.getByRole('menuitem', { name: 'Chapter panel' }).click();
  await page.getByRole('button', { name: 'Close the chapter panel' }).waitFor();
  await page.waitForTimeout(500);
  await shot(page, 'phone-panel', 'the chapter panel as a full-height sheet');

  await context.close();
}

/**
 * `docs/images/card.png` — the 1200×630 picture a link to the site unfurls as,
 * in a chat window or a search result.
 *
 * Composed here rather than drawn by hand so that it is reproducible, and so
 * the app in it is the picture the landing page is already showing: it is the
 * hero shot taken a moment ago, cropped by the frame it sits in. The palette,
 * the serif and the single warm glow are `docs/_layouts/landing.html`'s, kept
 * in step by eye — the card is the page, small.
 *
 * The serif is the app's stack and resolves to whatever the machine taking the
 * picture has; on a machine with none of them it falls to Georgia, which is
 * close enough that the card does not need a font of its own downloaded.
 */
async function socialCard() {
  const hero = await readFile(join(OUT, 'hero.png'));
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  // `setContent` waits for load, which is the picture decoded; the faces are
  // the machine's own, so there is nothing else to wait for.
  await page.setContent(card(`data:image/png;base64,${hero.toString('base64')}`));
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'card.png'), animations: 'disabled' });
  await page.close();
  shots.push('card.png — the 1200×630 card a link to the site unfurls as');
}

/** The card's one and only document. `shot` is the hero, as a data URI. */
function card(shot) {
  const mark = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
         stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 5v16" />
      <path d="M16 13h2" /><path d="M16 9h2" />
      <path d="M6 9h2" /><path d="M6 13h2" />
      <path d="M20.001 19A2 2 0 0 0 22 17V5a2 2 0 0 0-1.999-2L16 3.002A5 5 0 0 0 12 5a5 5 0 0 0-4-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4.001a5 5 0 0 1 3.999 2 5 5 0 0 1 4-2z" />
    </svg>`;

  return `<!DOCTYPE html>
<html lang="en-GB"><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
  body {
    position: relative;
    background: #14151a;
    color: #e7e4dd;
    font-family: system-ui, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  /* The lamp: the same warm radial the page has, in the same corner. */
  body::before {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(880px 600px at 76% -16%, rgba(255,186,94,.19), transparent 66%);
  }
  .left {
    position: relative;
    width: 600px;
    height: 100%;
    padding: 0 0 0 72px;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .left > * { max-width: 512px; }
  .mark { display: flex; align-items: center; gap: 13px; font-family: var(--serif); font-size: 30px; letter-spacing: .03em; }
  .mark svg { width: 34px; height: 34px; color: #b79cf0; }
  h1 { margin: 30px 0 0; font-family: var(--serif); font-weight: 400; font-size: 50px; line-height: 1.16; }
  .free { margin: 28px 0 0; font-size: 21px; line-height: 1.5; color: #b6b2a9; }
  /* A crop of the page, run off the right edge: the card is a window onto it. */
  .shot {
    position: absolute;
    left: 664px;
    top: 104px;
    width: 720px;
    border-radius: 18px;
    border: 1px solid #2f333e;
    box-shadow:
      0 40px 80px -28px rgba(255,176,82,.20),
      0 50px 100px -40px rgba(0,0,0,.65);
  }
  :root { --serif: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif; }
</style></head><body>
  <div class="left">
    <div class="mark">${mark}<b>Lamplit</b></div>
    <h1>Like reading in bed with the lamp on. Except the book writes back.</h1>
    <p class="free">Free and open source. Your stories are files, on your own machine.</p>
  </div>
  <img class="shot" src="${shot}" alt="">
</body></html>`;
}

// -- plumbing -----------------------------------------------------------------

async function session() {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1.5,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${appPort}/`);
  await page.waitForTimeout(1200);
  return { page, context, close: () => context.close() };
}

async function shot(page, name, caption, options = {}) {
  await page.screenshot({ path: join(OUT, `${name}.png`), animations: 'disabled', ...options });
  shots.push(`${name}.png — ${caption}`);
}

/** Another story, from the menu on the title in the top bar. */
async function switchStory(page, title) {
  await page.locator('li-top-bar .here').click();
  await page.getByRole('menuitem', { name: title }).click();
  await page.locator('article[data-role]').first().waitFor();
  await page.waitForTimeout(600);
}

/** Preferences, which is behind ⋯ now rather than named on the bar. */
async function openPreferences(page) {
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: /^Preferences/ }).click();
}

/** Developer mode, through the interface, because that is where it lives. */
async function setDeveloperMode(page, on) {
  await openPreferences(page);
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Advanced' }).click();
  const toggle = sheet.getByRole('switch', { name: /^Developer mode/ });
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
  await sheet.getByRole('button', { name: 'Advanced' }).click();
  await escape(page);
}

/** Escape closes a modal, and everything in it has already been saved. */
/**
 * Writes into the composer as a writer would: keystroke by keystroke, so the
 * editor colours what is typed, and Shift+Enter for a newline because Enter
 * is Send.
 */
async function write(page, text) {
  const editor = page.locator('li-composer li-prose-editor [contenteditable]');
  await editor.click();
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    if (index) await editor.press('Shift+Enter');
    if (line) await editor.pressSequentially(line);
  }
}

async function escape(page) {
  await page.keyboard.press('Escape');
  await page.locator('mat-dialog-container').waitFor({ state: 'hidden' });
  await page.waitForTimeout(250);
}

/**
 * The demo story, written into the server's data folder before it is started.
 * The browser keeps nothing of its own, so this is the only place a document
 * can come from — and it is what a person does when they copy a story onto a
 * new machine.
 */
async function seed(dataDir) {
  for (const [key, document] of Object.entries(documents())) {
    const path = key.startsWith('story:')
      ? join(dataDir, 'stories', `${key.slice('story:'.length)}.json`)
      : key.startsWith('chapter:')
        ? join(dataDir, 'chapters', `${key.slice('chapter:'.length)}.json`)
        : join(dataDir, 'settings.json');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify(document, null, 2)}
`,
      'utf8',
    );
  }
}

function documents() {
  const at = (day, hour) => `2026-03-${String(day).padStart(2, '0')}T${hour}:00:00.000Z`;
  return {
    settings: {
      connection: {
        provider: 'custom',
        baseUrl: `http://127.0.0.1:${modelPort}/v1`,
        apiKey: 'demo-key',
        model: MODEL,
        modelsCache: [
          { id: MODEL, name: 'Lamplighter Large', ownedBy: 'demo' },
          { id: 'demo/lamplighter-small', name: 'Lamplighter Small', ownedBy: 'demo' },
        ],
      },
      generation: {
        maxContextTokens: 16384,
        maxResponseTokens: 800,
        temperature: 0.9,
        topP: 1,
        frequencyPenalty: 0,
        presencePenalty: 0,
        stop: [],
      },
      ui: { theme: 'dark', bookStyleDialogue: true, fontSize: 18, showTokenCounts: true },
      activeStoryId: STORY_ID,
    },
    [`story:${STORY_ID}`]: {
      id: STORY_ID,
      title: 'The Lantern Room',
      createdAt: at(14, '09'),
      updatedAt: at(21, '18'),
      mode: 'narrator',
      narrator: { useDefault: true, prompt: '' },
      characters: [],
      persona: {
        name: 'Mara',
        description: 'A marine biologist, thirty-one, back on the island after nine years.',
      },
      style: { dialogueOnOwnLine: true, replyLength: 'medium' },
      world: {
        storySoFar: STORY_SO_FAR,
        summary: { useDefault: true, prompt: '' },
        entries: LORE,
        scan: { depth: 4, caseSensitive: false, matchWholeWords: false },
      },
      activeChapterId: CHAPTER_1,
      chapterCounter: 2,
    },
    [`chapter:${CHAPTER_1}`]: {
      id: CHAPTER_1,
      storyId: STORY_ID,
      number: 1,
      title: 'A hundred and nine steps',
      scene: SCENE_1,
      status: 'writing',
      summary: '',
      createdAt: at(21, '18'),
      updatedAt: at(21, '19'),
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'I climb, counting the steps.',
          createdAt: at(21, '18'),
        },
        {
          id: 'm2',
          role: 'assistant',
          content: PASSAGES[0],
          createdAt: at(21, '18'),
          meta: { model: MODEL, promptTokens: 612, completionTokens: 148, finishReason: 'stop' },
        },
        {
          id: 'm3',
          role: 'user',
          content: 'I put the lantern down and look at her properly.',
          createdAt: at(21, '19'),
        },
        {
          id: 'm4',
          role: 'assistant',
          content: PASSAGES[1],
          createdAt: at(21, '19'),
          meta: { model: MODEL, promptTokens: 794, completionTokens: 96, finishReason: 'stop' },
        },
      ],
    },
    [`chapter:${CHAPTER_2}`]: {
      id: CHAPTER_2,
      storyId: STORY_ID,
      number: 2,
      title: 'Two mugs',
      scene: SCENE_2,
      status: 'writing',
      summary: '',
      createdAt: at(21, '20'),
      updatedAt: at(21, '20'),
      messages: [],
    },
    // Cast one character at a time, and written in far enough to show a run of
    // one speaker's turns as well as a switch to another. No colours on the
    // characters: they are handed out on load, from their place in the cast.
    [`story:${CAST_STORY_ID}`]: {
      id: CAST_STORY_ID,
      title: CAST_STORY_TITLE,
      createdAt: at(22, '09'),
      updatedAt: at(22, '10'),
      mode: 'roleplay',
      narrator: { useDefault: true, prompt: '' },
      characters: [
        {
          id: 'nell',
          name: 'Nell',
          description: 'Kept house for Tomas, then kept the light with him. Eighty-one.',
          enabled: true,
        },
        {
          id: 'tomas',
          name: 'Tomas',
          description: 'The keeper before Mara’s father. Seventy-nine, deaf on one side.',
          enabled: true,
        },
      ],
      roleplay: { casting: 'one-at-a-time', activeCharacterId: 'tomas' },
      persona: {
        name: 'Mara',
        description: 'A marine biologist, thirty-one, back on the island after nine years.',
      },
      style: { dialogueOnOwnLine: true, replyLength: 'medium' },
      world: {
        storySoFar: STORY_SO_FAR,
        summary: { useDefault: true, prompt: '' },
        entries: [],
        scan: { depth: 4, caseSensitive: false, matchWholeWords: false },
      },
      activeChapterId: CAST_CHAPTER,
      chapterCounter: 1,
    },
    [`chapter:${CAST_CHAPTER}`]: {
      id: CAST_CHAPTER,
      storyId: CAST_STORY_ID,
      number: 1,
      title: 'The stair',
      scene: SCENE_3,
      status: 'writing',
      summary: '',
      createdAt: at(22, '10'),
      updatedAt: at(22, '11'),
      messages: [
        {
          id: 'c1',
          role: 'user',
          content: 'I put the lantern down and look at her properly.',
          createdAt: at(22, '10'),
        },
        {
          id: 'c2',
          role: 'assistant',
          content: CAST_PASSAGES[0],
          createdAt: at(22, '10'),
          speakerId: 'nell',
          speakerName: 'Nell',
          meta: { model: MODEL, promptTokens: 588, completionTokens: 41, finishReason: 'stop' },
        },
        {
          id: 'c3',
          role: 'assistant',
          content: CAST_PASSAGES[1],
          createdAt: at(22, '10'),
          speakerId: 'nell',
          speakerName: 'Nell',
          meta: { model: MODEL, promptTokens: 641, completionTokens: 58, finishReason: 'stop' },
        },
        {
          id: 'c4',
          role: 'user',
          content: '"Tomas?" I say, to the stairwell.',
          createdAt: at(22, '11'),
        },
        {
          id: 'c5',
          role: 'assistant',
          content: CAST_PASSAGES[2],
          createdAt: at(22, '11'),
          speakerId: 'tomas',
          speakerName: 'Tomas',
          meta: { model: MODEL, promptTokens: 702, completionTokens: 63, finishReason: 'stop' },
        },
      ],
    },
  };
}

/**
 * A stand-in for the model: the demo story's own prose, and the summary when a
 * summary is what was asked for. Streamed as real SSE, so the app has no idea
 * it is not talking to a provider.
 */
function startModel(port) {
  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (request.method === 'OPTIONS') return response.writeHead(204).end();

    if (request.url.startsWith('/v1/models')) {
      return response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          object: 'list',
          data: [
            { id: MODEL, owned_by: 'demo', name: 'Lamplighter Large', created: 2 },
            { id: 'demo/lamplighter-small', owned_by: 'demo', name: 'Lamplighter Small' },
            { id: 'demo/tealight-8b', owned_by: 'demo', created: 1 },
          ],
        }),
      );
    }

    const body = await readJson(request);
    const asked = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user');

    // Not streamed: the request asking what the chapter established, which
    // wants entries back rather than prose. One new and one update, so the
    // picture of the review sheet shows both states a row can be in.
    if (body.stream === false) {
      return response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: JSON.stringify({ entries: PROPOSED }) },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1063, completion_tokens: 84, total_tokens: 1147 },
        }),
      );
    }

    const text = /Rewrite the story so far/.test(asked?.content ?? '') ? SUMMARY : REPLY;

    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    for (const piece of text.split(/(?<=\s)/)) {
      if (response.writableEnded) return;
      response.write(
        `data: ${JSON.stringify({
          choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
          model: body.model,
        })}\n\n`,
      );
      await delay(8);
    }
    response.write(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
    );
    response.write('data: [DONE]\n\n');
    response.end();
  });
  server.listen(port, '127.0.0.1');
  return server;
}

/**
 * Stops the running server, if any, and starts one on a fresh data folder —
 * empty, or holding the demo story. Seeding happens before the server starts,
 * because the server is the truth and it reads the folder once.
 */
async function freshServer({ withStory = false } = {}) {
  if (persistence) {
    const stopped = new Promise((fulfil) => persistence.once('exit', fulfil));
    persistence.kill();
    await stopped;
    await waitForHealth(false);
  }
  const data = await mkdtemp(join(tmpdir(), 'lamplit-shots-'));
  dataDirs.push(data);
  if (withStory) await seed(data);
  persistence = spawn(process.execPath, [join(ROOT, 'server', 'src', 'index.js')], {
    env: {
      ...process.env,
      LAMPLIT_DATA_DIR: data,
      LAMPLIT_PUBLIC_DIR: BUILT_APP,
      LAMPLIT_PORT: String(appPort),
      LAMPLIT_BACKUP: '0',
      LAMPLIT_OPEN: '0',
    },
    stdio: 'ignore',
  });
  await waitForHealth(true);
}

async function waitForHealth(up, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const alive = await fetch(health).then(
      (response) => response.ok,
      () => false,
    );
    if (alive === up) return;
    if (Date.now() > deadline) throw new Error(`the server never came ${up ? 'up' : 'down'}`);
    await delay(150);
  }
}

function readJson(request) {
  return new Promise((fulfil) => {
    let raw = '';
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => {
      try {
        fulfil(JSON.parse(raw));
      } catch {
        fulfil({});
      }
    });
  });
}

function freePort() {
  return new Promise((fulfil, reject) => {
    const probe = createSocket();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => fulfil(port));
    });
  });
}

function delay(ms) {
  return new Promise((fulfil) => setTimeout(fulfil, ms));
}
