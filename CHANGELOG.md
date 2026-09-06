# Changelog

The top section of this file is the release notes: the tag's workflow copies it
onto the draft release, so it is written for the person downloading, not for the
person who wrote the code. A section is written as the work happens, under
`## Unreleased`, and renamed to the version when the tag goes out.

## Unreleased

**The top bar names three things, and all three are the story.** *Story*, *World*, *Chapters* and
the **⋯** menu, and nothing else. Two of the six words on it were never about the story being
written, and both have moved to where they belong:

- **The model carries its parameters.** The model name in the bar — and **Ctrl/Cmd+K** — opens
  **Model**, one sheet with two tabs: **Connection**, as it was, and **Parameters**, as it was.
  They were four buttons apart with nothing to say they belonged together, though they are the same
  paragraph of the same `settings.json`. The sheet a fresh install opens on is unchanged: the
  connection form alone, with no tab strip and no way past it until there is somewhere to send the
  story.
- **Preferences is behind ⋯**, with *About Lamplit*, where the rest of the app is — and it takes
  **Ctrl/Cmd+,**, the key every editor gives its settings, to make back the click. The menu is
  three groups now: this chapter, then the app, then About.
- **The bar gives up less, later.** The save indicator keeps its word down to a window 12rem
  narrower than before, and the wordmark down to a rem above the phone layout.
- The phone's bar and its one menu are unchanged. Preferences and the model were never offered
  there, and still are not.

**Contrast and motion, and the computer you are on.** Preferences has an **Accessibility**
section. Lamplit has always followed what your computer asks for — a machine set to more contrast
gets a stronger set of rules, one asking for less motion gets an app that stands still — and both
are now yours to overrule in this app alone:

- **Contrast** has three states, because a machine asking for more has to be answerable in both
  directions: follow it, always stronger, or always as Lamplit ships. The stronger rules clear the
  3:1 that WCAG asks of anything marking out a control; the ones it ships sit at about 2:1, and
  your text is over the 4.5:1 AA asks either way. A story with a page of its own keeps that page,
  at whichever strength.
- **Motion** has two: follow it, or always still. There is no *always animate*, and that is
  deliberate — nothing here moves in order to tell you something, so a computer asking for
  stillness is never argued with from a panel.

**A read through the whole of it, and the things that read found.** Nothing here is a feature; all
of it is something that was wrong. The ones you could have noticed:

- **A chapter you deleted stays deleted.** Deleting one and closing the window in the same breath
  left the file on disk, and it came back on the next start. Deleting a story did it story-wide.
- **The last thing you wrote is not lost to a closed window.** A save still on its way was
  invisible to the app as it closed; and a long chapter is too big for the browser to carry out of
  a page that is leaving, which it refuses to say. Both are now saved before the window goes, and
  if the writing cannot be saved you are asked before it closes rather than told afterwards — in
  the desktop app that was a close button that did nothing at all.
- **Saved means saved.** The indicator said so while writes were still queued.
- **An answer you can see is not replaced by an error.** A reply cut short by the endpoint or by
  the connection kept its words and says underneath that it stopped early; it used to be hidden
  behind a red line with the text still on disk.
- **A reply still arriving cannot be edited.** The edit was accepted and then quietly overwritten.
- **Leaving a story mid-answer marks the answer**, instead of leaving one that stops mid-sentence
  and claims to be finished.
- **Escape closes one thing.** A colour menu opened in the chapter panel took the panel with it.
- **Shortcuts stay on the page.** Ctrl+Enter inside a sheet regenerated the chapter behind it, and
  Ctrl+K stacked a second Connection sheet on the first.
- **A chapter title can be given back**: clearing the box now returns it to the scene's first line,
  as the scene sheet has always said it would.
- **A new lore entry appears** even when a search was in the box.
- **A chapter opens at its end**, wherever you left the last one, and arriving at the foot of the
  page no longer tugs it.
- **Ten thousand tokens reads as 10k**, not 10.0k, and a million is not 1000k.
- **What you type comes back as you typed it** in two more shapes: `*a *b* c*` and `***a** b*`.
- **An endpoint that will not stream** is understood rather than reported as an empty answer, and
  a page that will not parse is shown as the text it is rather than blanking the view.
- **The colours the model picks** are the ones it named, not the first name in our own list.
- **A link in an answer opens beside the story**, in a new tab, instead of navigating the app away
  from the page you were writing on and taking the reply still arriving with it.
- **A long answer arrives without slowing the page down.** Every message was read from its first
  word again on every frame of the stream, and the markdown parser is very slow on the unclosed
  `**` a model writes once it starts repeating itself — slow enough to stop the tab while the
  words were still coming. Each paragraph is read once now, and remembered.
- **Switching the update check off switches it off in the desktop app too.** It used to keep
  asking GitHub, downloading the new version and installing it the next time you quit, whatever
  the switch said. `LAMPLIT_UPDATE_CHECK=0` stops it now as well.

And underneath, where a reader would only notice them going wrong: the API answers only to this
machine's own names, so a page on the web cannot reach it by pointing a domain at your loopback,
and it now authorises no cross-origin request at all, so a page open on another port of your own
machine cannot read your stories or your key either; the page is served under a content security
policy, which leaves where the story is sent entirely your choice and forbids everything else;
`index.html` is never cached, so an upgrade cannot leave a browser asking for files that are gone;
a backup that fails says so instead of reporting one that is not there; an interrupted archive is
written again rather than kept; a write that cannot be renamed cleans up after itself; one
unreadable file costs that file rather than the whole collection; a body that is empty or a list is
refused rather than saved over your story; a chapter you closed stays closed even if you hit Escape
in the same instant, which used to throw the close away and keep only the lore entries; and a
pre-release version compares as older than the release it precedes.

The desktop build carries the version it was built at, so an update can be published at all; a
portable copy no longer installs itself; the browser's own cache lives in a folder of its own
rather than beside your writing; and a start that fails says why instead of leaving a process with
no window. The window now refuses the camera, the microphone, your location and notifications —
none of which Lamplit has ever asked for, and all of which it was granting by default. The licences of everything bundled into the app now ship with it.

**What you type looks like what will be read.** The box you write in is a prose editor now, set in
the reading face at the reading size, and a line is coloured as it is written: `"speech"` in the
speech colour the moment the closing quote lands, `*an action*` in italics the moment the second
asterisk does, `**bold**` likewise — the asterisks go and the mark stays. Editing a message opens
the same editor.

- **Three quiet words under the box**, **Speech**, **Action** and **Bold**, do the same for a
  selection or for what you type next; the shortcuts are **Ctrl+'**, **Ctrl+I** and **Ctrl+B**.
- **Nothing about the message changed.** It is still the plain text with its quotes and asterisks,
  which is what the model reads, and a heading or a list typed the markdown way still renders as
  one after sending. Pasting brings the text and nothing else.
- **Enter still sends, Shift+Enter still breaks the line**, `[AUTHOR]` still splits as it is typed,
  and undo after sending gives back nothing that was sent.
- The editor is [Tiptap](https://tiptap.dev) on ProseMirror, headless. The app is about 86 kB
  larger to download (322 kB uncompressed).

**Every text box grows on the line that needs it.** The scene, the lore, a persona, the summary
of a chapter closing, the author's direction and the box you write in all size themselves to their
text now, up to the height they were given, and shrink again when text is deleted. They used to
grow a line late, jump when a summary streamed in, and open short in a sheet; the browser does the
sizing itself now and none of that is left. A browser without the feature (Firefox before 152,
Safari before 26.2) shows a box of the starting height that scrolls inside itself.

**The composer is the end of the page now, not a dock under it.** The story, the chapter's two
buttons and the box you write in are one scroll: reach the box and you have reached the end of the
story so far.

- **Scroll up and the page is text, edge to edge.** The box goes away with everything else, which
  is a quarter of a laptop screen and most of a phone given back to the thing you are actually
  doing. **↓** in the margin brings the end back, box included.
- **Reading at the model's pace is unchanged.** While you are at the end of the page, an answer
  arriving keeps you there and the box stays on screen the whole time.
- **Start typing and the box comes to you.** A letter pressed while nothing is focused focuses the
  composer, brings the end of the page into view and takes the letter. Space is left alone — it
  pages the story down.
- **A third of a screen of quiet under the box**, so the last line of the story is read above it
  rather than against the bottom edge.

**The page can change with the scene.** A chapter set in a snowbound monastery and one set in a
jazz club at two in the morning were read on the same cream paper. **Preferences → Colours** now
opens on a **page palette** row — the page Lamplit ships and ten others: Frost, Hearth, Nocturne,
Tide, Dusk, Verdant, Ember, Pallor, Gilt, Bloom. One click sets every swatch under it, in both
themes.

- **A preset, and nothing more.** A palette writes the same colours the panel has always edited, so
  changing one afterwards still works and still wins; the row says *custom* while it does, and
  **Reset** puts you back to the palette rather than all the way out of it.
- **Every one of them is a page you can read on.** Each was built rather than picked — a hue per
  role, walked towards its own ink until the text, the dialogue, the accent and the errors all
  clear WCAG AA against all three of that theme's papers.
- **Or let the model pick.** **Story → Style** has a switch, off unless you turn it on: confirming
  a chapter's scene sends the scene and the ten palettes as moods — never as colours — and the
  answer is one name. The chapter is read on that page from then on and keeps it when you come back
  to it, so switching chapters switches pages. It is a request of its own, made once per scene and
  never during a turn, and what it cost is in the scene sheet's footer. It works on endpoints that
  have never heard of a JSON schema, and anything that goes wrong changes nothing.
- **And the last word is yours.** When the open chapter has a page of its own, the palette row says
  so and edits that one.

**Closing a chapter can propose the lore in it.** The summary keeps what the story needs to make
sense; it cannot keep the name in passing, the town an hour up the coast, who owes whom. The model
that has just read the chapter can pick those out, and **Propose lore** in the review sheet asks it
to.

- **A checklist, not a change.** Each proposal shows its title, its kind, its keys and what it
  would say. New entries arrive ticked; an update arrives unticked and shows the entry's current
  text under the proposed one, because it overwrites something you wrote. Closing files what is
  ticked and nothing else, and Cancel files nothing at all.
- **Off unless you ask.** It is a second request and a second bill, so the button is how you ask
  for it. **World → Story so far** has a switch for running it on its own every time a chapter
  closes.
- **It works on endpoints that have never heard of JSON schemas.** The strict shape is asked for
  first and dropped on a refusal, and the answer is read out of a fenced block or a sentence of
  preamble either way.
- **A failure is one muted line.** The summary is still there, the close still goes through.

**Cancelling a chapter close no longer closes the chapter.** It closed it with an empty summary,
which also replaced the story so far with nothing. Cancel now leaves the chapter, the story so far
and the world exactly as they were. **Cancelling a rename** leaves the name alone in the same way;
it used to save the empty box over it.

**You can say it as the author now.** *The storm arrives tonight. She should refuse.* Written into
the story that is a hint the model may or may not take. Written as a **direction** it is an
instruction it is told to follow, and told to follow without ever mentioning it.

- **Two ways to write one.** The **Author** button beside Send opens a field under the box, or type
  `[AUTHOR]` at the start of a line and everything after it moves into that field as you type. A
  message can be prose, a direction, or both, and either half on its own is worth sending.
- **It is never part of the story.** In the page it is a note under your prose — italic, indented,
  labelled *author* — and it is left out of the summary when the chapter closes and out of the
  keyword scan that fires lore. It shaped what happened; it is not what happened.
- **It stays in the chapter**, so *the storm arrives tonight* is still holding three messages later.
- **The model is told how to read it**, in a block that sits last of all, after the style rules,
  because it overrides them. That block cannot be edited, cannot be dragged anywhere else, and
  there is no setting that turns it off.

**The page says who is speaking.** A story cast one character at a time now puts a small name above
each passage — the character who wrote it, in their own colour, with a dot to match — and your own
lines carry your persona's name in a quieter one. A run of turns by the same speaker is named once,
because the second one is the same person still talking.

- **Nothing else changed about a message.** No avatar, no box, no border: the name is set in the
  interface font at the size the meta line uses, above the first paragraph in both dialogue
  settings, and the model and token count stay where they were underneath.
- **A narrator's story has no labels**, and neither does an ensemble answer: nobody in particular
  wrote it, and the prose carries the names as it always did.
- **A rename does not go back and change who said what.** The name is written down with the answer,
  so what a character already said stays in the name she had then. Delete her and her lines keep
  her name, in the muted colour.

**Every character has a colour.** One from a palette of ten, handed out the moment a character is
added, so the first ten in a story are all different without anyone choosing. It is the dot beside
their name in the chapter panel's **Cast** and in the **Story** sheet, and it tints the row of
whoever the model is playing.

- **The ten were not picked by eye.** Each is written twice, a dark ink for the light papers and a
  light one for the dark, and every one of them clears WCAG AA against all three surfaces of its
  theme. The hues were chosen by maximising the smallest gap between any two of them once
  protanopia, deuteranopia and tritanopia have each been simulated over the whole set. Ten colours
  cannot all be distinct to everyone; the palette's job was to make the worst pair as good as it
  can be.
- **Changing one** is a click on the dot and a click on another of the ten. No colour picker there,
  because a free colour promises none of the above.
- **A colour of your own**, if you want one: **Preferences → Colours** now lists the cast with a
  colour input each, and **Back to the palette** gives it back. That one is used in both themes.
- **A story written before any of this opens coloured**, worked out from each character's place in
  the cast, so it opens the same way every time.

**Role-play can be a room or a conversation.** Under **Story → Mode → Role-play** there are now
two ways to cast it. **Ensemble** is what the app has always done and stays the default: the model
plays everyone in the scene and answers as whoever the moment calls for. **One at a time** gives it
a single character to be — the rest are named as present, and it may describe what they do, but it
never speaks for them.

- **Switching is in the chapter panel.** Click a row in **Cast** and the model plays that character
  from there on; the row being played is marked. The small switch on each row takes somebody in or
  out of the scene, in either casting.
- **The model is told, where it happened.** A switch or a departure becomes a short line in the
  chapter at that point — *"From here you play Tomas. Nell is no longer the character you play"*,
  *"Isa has left the scene."* Nothing already written is rewritten, and the chapter reads exactly as
  it did: the lines are in **What the model sees**, not in the story.
- **Each answer remembers who wrote it**, so closing a chapter summarises it with the right names
  attached rather than as one anonymous voice.
- **An existing story is untouched.** A story that never answered the question is an ensemble, and
  an ensemble sends the same prompt, byte for byte, that it always did.

**The chapter's own fields are beside the page now, not on top of it.** The scene, the narrator's
instructions, your persona and the cast each used to mean leaving the story for a modal and coming
back. They are a panel down the right-hand side: a thin edge until you click it or press
**Ctrl+.**, and it opens the way you left it next time.

- **Everything in it is edited where it is**, and saved the way every other field in the app is
  saved — the mark appears once the text differs from what is stored, and leaving the field commits
  it. A closed chapter shows its scene and will not take a change to it.
- **The narrator default sits in the box**, greyed, instead of behind a switch: write into it and it
  becomes yours, and **Back to the default** hands it back with your own text kept.
- **A cast row is a name and the first line of the description.** The pencil at the end of it opens
  that character in the **Story** sheet, because a character is more than a row can hold.
- **On a wide window it narrows the reading column** and covers nothing. On a narrow one it comes
  over the page, and **Escape** or a click behind it sends it away. The composer stays usable in
  both.
- Nothing about the app is in it. The connection, the sampling parameters and the reading settings
  are not chapter fields and stay where they were.

**Nothing sits on top of the story any more.** A message's actions — edit,
regenerate, replay, copy, delete — used to appear as a pill over the first line
of the message they belonged to, so moving the pointer across the page to read
hid the words under it. They are marks in the **right margin** now, out past
the edge of the text, and they appear on hover or when you tab into a message
exactly as before.

- **Jump to latest** moves with them: a small round **↓** in the same column of
  margin, rather than a filled button over the last lines you were reading.
- **On a narrow window or a touch screen** there is no margin to write in and
  no pointer to hover with, so the same actions sit behind a single **⋯**
  *under* the message, on the line that already carries the model and the token
  count. Neither layout is ever over a word, at any width.
- The keyboard path is unchanged, and so is everything the actions do.

**Lamplit tells you when there is a newer one, and what changed in it.** Once
per start, the server asks GitHub which versions have been published. When one
of them is newer than yours, the top bar says so — a small pill, *0.2.0
available*, and nothing else. No modal, no banner over the page you are writing
on. Click it for **What's new**: every release above yours, newest first, with
the notes as they were written.

- **The notes are in the app now.** **⋯ → About Lamplit → Release notes** shows
  every release, so they can be read with nothing pending. They are also a page
  on the website, generated from this file, so there is still one place they are
  written.
- **The desktop app is unchanged in what it does**: it still downloads the
  update itself and installs it when you quit. The zip and a copy running from
  the repository now hear about one too, which they never did.
- **What leaves your machine**: one request to `api.github.com` for the list of
  releases, carrying what any HTTP request carries and nothing about you, your
  stories or your provider. The server makes it, not the browser, so the only
  host the app itself talks to is still the model endpoint you chose.
- **Switching it off** is **Preferences → Advanced → Check for a new version
  when Lamplit starts**, or `LAMPLIT_UPDATE_CHECK=0` for a zip started by a
  script. Off means the request does not happen, rather than happening and being
  ignored.

**The prompt's blocks can be put in a different order.** In **What the model
sees**, the persona, the story so far, the world and this chapter each have a
handle: drag one and the sheet rebuilds as it moves, so you can see what the
change does before anything is sent. The arrow keys move a block whose handle
has the focus.

- **Three blocks stay where they are.** The mode preamble is always first — it
  says what the model is, and the rest is read as instructions to that — and
  the style rules and your own direction are always last, because the
  instruction closest to the conversation is the one that sticks. Each says so
  in the sheet.
- **The order belongs to the story**, not to the app: another story is
  unaffected, and a duplicate carries it along. **Reset the order** appears
  once you have moved something.
- Only a changed order is written down, so a story written by an older Lamplit
  opens in the shipped order — and so does one whose stored order names a block
  this version does not have, rather than the app guessing at what was meant.

**Developer mode, for the half of the app that is about the app.** The context
pill under the composer and **What the model sees** behind it are now off
unless you ask for them: **Preferences → Advanced → Developer mode**. A fresh
install is the writing app and nothing else.

- **One door instead of two.** The **What the model sees** button in the chapter
  toolbar is gone; the pill was always the better way in, because it says what
  the room is about and counts your draft as you type.
- **About** gains the folder your documents are in, under the version, while
  developer mode is on. The build line stays where it was for everyone — it is
  what makes a bug report answerable.
- It changes nothing about the request. A story written with it on and one
  written with it off send exactly the same thing.
- **Show token counts** is unaffected: the line under each answer is about
  reading, and stays in **Preferences → Reading**.

**Preferences, and the colours the story is read in.** The **Reading** menu in
the top bar is now **Preferences**, a sheet with room in it. **Reading** is the
same four settings it always was — theme, dialogue on its own line, token
counts, text size — and it is open when the sheet opens.

- **Colours.** Every colour the two themes are built from is a swatch you can
  change, and the page redraws as you drag: the page, the paper, the text, your
  own lines, the accent, the dialogue, the rest. Each theme keeps its own set,
  so the dark palette and the light one are yours separately. **Reset** puts one
  theme back to exactly what Lamplit ships.
- **A reading font** — the serif it ships with, a sans-serif, or a monospace,
  from the fonts your computer already has. It sets the story; the app around it
  stays as it is.
- **It warns rather than blocks.** Text on paper below the 4.5:1 that WCAG AA
  asks of body text says so, and lets you carry on.
- Only what you changed is written down, so a `settings.json` from 0.1.0 opens
  with the theme exactly as it shipped, and a colour a later version improves
  still reaches you unless you had overridden that one.
- **Advanced** is where the two settings above live: the update check and
  developer mode. It is the drawer for anything that comes with a warning.

**The zip is on the release now.** Every release carries `Lamplit.zip` beside the
installers: the whole app in about a megabyte, for any machine that already has
Node.js 20.19 or newer. 0.1.0's notes promised it and the release did not have
it — this is that, and
[the link](https://github.com/lamplit-app/lamplit/releases/latest/download/Lamplit.zip)
always points at the newest one. It is also the way in on a Mac, which has no
installer of its own.

- **The start scripts look for Node.js before they start anything.** If it is
  missing, or older than 20.19, they say so in one line and then offer the one
  command that would install it on this machine — winget on Windows, Homebrew on
  a Mac, apt, dnf or pacman on Linux. It is an offer: the command is on screen,
  and nothing is installed unless you answer yes. Say no and it leaves you the
  exact download from nodejs.org.
- **`start.command`, for a Mac.** Finder opens a double-clicked `.sh` in a text
  editor and runs a `.command`, so the zip now carries both — the same script
  under the name that works.
- **The download page** marks the card for the computer you are reading it on,
  and keeps the zip one click away under *Advanced*.

**Every build says which one it is.** **⋯ → About Lamplit** now shows the
version, the CI run that built it, the commit it was built from and the date:
the line to quote in a bug report, since a version number alone stops being
enough once two builds have carried it. The desktop app's **Help** menu shows
the same line, and `/api/health` returns every field of it.

- **It notices an upgrade.** Start a newer Lamplit over stories written by an
  older one and it says so, once, at the top of the page, with a link to what
  changed. Dismiss it and it never comes back for that version. A fresh install
  has nothing to compare against and stays quiet.
- **[Upgrading](https://lamplit-app.github.io/lamplit/upgrading.html)** is a
  new page in the guide: how to get the new version on each channel, how to
  carry your stories across when you run the zip, and where every way of
  running it keeps them.

**Lamplit has moved to an address of its own.** The project used to live under the personal account
that started it, so every link to it — the download page, the releases, the issues — was somebody's
name. It is now at [github.com/lamplit-app/lamplit](https://github.com/lamplit-app/lamplit), and
the download page at [lamplit-app.github.io/lamplit](https://lamplit-app.github.io/lamplit/).

- **Nothing you have installed breaks.** The old addresses redirect, so a 0.1.0 that is already
  running still finds its update check and its downloads. Bookmarks and clones keep working.
- **Your provider no longer hears a name.** The apps that credit the tools calling them —
  OpenRouter among them — are told where Lamplit lives with every request. That line used to carry
  the author's own site. It carries the project's now.

**Read the story on your phone.** Lamplit is a web app served by its own server, so a phone on the
same Wi-Fi only needed letting in. **Preferences → Advanced → Share on this network** does it:
a second listener opens, and under the switch is a QR code. Point a phone's camera at it once and
the story is there — the same story, the same files, saved back to the same computer.

- **The computer's own door does not move.** Lamplit still answers on `127.0.0.1` exactly as
  before, and the tab already open on the desk does not notice. Switching sharing off closes the
  second listener and nothing else; switching it on again does not make anyone scan twice.
- **Nothing gets in without the code.** A phone that has not scanned it — or anything else on the
  network that goes looking — gets a page saying to scan the code on the computer, and nothing
  more. **New code** makes a fresh one and unpairs every phone at once.
- **Said plainly, because it matters:** a phone that has scanned the code can read and change
  everything you can, your API key included, and the traffic across your network is plain HTTP and
  is not encrypted. Share on a network you trust. The dialog says so too.
- **Windows will ask** whether to allow Lamplit through the firewall the first time. It has to be
  allowed for a private network, or the phone gets nothing.
- **A model running on this computer stays on this computer.** The story is sent to the model by
  the browser reading it, so a `localhost` endpoint is unreachable from a phone. Preferences says
  so when it notices, rather than letting the writing fail over there.
- The setting lives in `data/server.json`, which the server owns, so a machine that was sharing
  when you shut it down is sharing when it starts. It works the same in the zip and in the desktop
  app.

**And a layout for it, once it is there.** A phone got the desktop app scaled down: a bar of six
buttons, a panel that flipped to an overlay, sheets floating in the middle of a 390-pixel screen.
Below 48rem there is now one layout, for one purpose — carry on the story you started at the desk.

- **The bar is the wordmark, the save dot and one menu.** Tap the wordmark for which story and
  chapter you are in, and the others; tap **⋯** for Story, World, Chapters, the chapter panel, and
  this chapter's own turning points.
- **The story runs edge to edge**, with the box to write in at the end of it, exactly as it does on
  the computer.
- **The chapter panel is a sheet**, opened from that menu or pulled in from the right-hand edge,
  and closed by the back gesture. Playing one character at a time works from it as it always has.
- **Every sheet is the whole screen**, with its buttons where a thumb is rather than at the end of
  a scroll, and nothing is left under the address bar, the home bar or the notch.
- **Enter makes a new line and Send sends**, because a phone keyboard has no Shift+Enter to break
  a line with. A message's actions are behind the **⋯** under it.
- **Preferences, Parameters, Connection, About and What's new are not offered.** They are the app
  rather than the story, they were settled on the computer, and the phone is already reading the
  answers out of the same `settings.json`.
- **Add it to the home screen** for the app's own icon and a window with no browser chrome. There
  is no offline mode and no service worker: with the computer asleep there is nothing to read, and
  a cached shell would be a nicer-looking way of saying so.
- A narrow window on a desktop gets the same layout. Nothing anywhere asks what device this is.

**The story, read out loud.** **Listen** in a message's actions reads that message in a voice the
device already has; **Read replies aloud** — in Preferences → Reading, and in the phone's one menu
— reads each answer as it finishes, which is what a phone propped against something across the
room is for. Press again, or write the next line, and it stops.

- **Nothing is sent anywhere to do it.** The reading is the browser's own, on the machine, with
  the voices that machine ships with. No key is spent and no service can be down.
- **The words, not the marks.** The asterisks that make an action italic, the heading hashes and
  the list bullets are left out; the quotation marks are kept, because a voice pauses at them. In
  role-play with one character at a time the speaker is named first, since a listener cannot see
  the name above the passage.
- **The voice and the speed** are picked in **Preferences → Reading**. The voice is stored by
  name, so a phone that has never heard of your laptop's voice reads in its own.
- A long reply is handed over a few sentences at a time. Chrome stops speaking after about fifteen
  seconds of one utterance and says nothing about it, which is exactly the replies worth listening
  to.

**Dictation is the keyboard's, and always will be.** Every phone keyboard has a microphone key
that dictates into any text box, and the composer is a text box. Lamplit does not add a button of
its own: the browser's recogniser refuses to run on the plain-HTTP address your phone reaches
Lamplit at, and the way round that is a domain name and a certificate for a server that lives on
your desk. What did change is the box itself — dictating into it, or writing in any language that
needs an input method, no longer risks a doubled or a missing word. The editor was re-marking
speech and answering `[AUTHOR]` in the middle of text the keyboard had not finished writing; it
waits for the keyboard now.

**Two devices writing one story no longer lose one of them.** Every document now carries a
revision, and a save says which revision it was based on. A save based on one that has moved on is
refused rather than applied, the page reloads that document and says **"Changed on another device;
reloaded"** — and coming back to a tab that was in the background fetches whatever changed while
you were away. Before this, the second writer's saves were quietly dropped and reported as saved.

## 0.1.0 — the first release

The first version anyone can install without a terminal.

Lamplit writes a story with you, in chapters, with a language model of your
choosing. It runs on your machine, keeps every story as a plain JSON file you can
copy or back up yourself, and sends your API key straight to your provider and
nowhere else — there is no account, no server of ours, and nothing to sign up for.

**What is in it**

- **Chapters.** A story is written in chapters. Each opens on a scene you write,
  and closing one folds it into the story so far, so a long story stays a
  reasonable size to send.
- **Narrator or role-play.** Tell the story in third person, or play one person
  in it and let the model play the rest.
- **A world that remembers.** A persona, a cast, and lore entries that reach the
  model when the writing mentions them.
- **The whole prompt, visible.** *What the model sees* shows exactly what is
  about to be sent, block by block, before it goes.
- **Twenty-two providers,** from OpenAI, Anthropic and Google to OpenRouter and
  NanoGPT, or anything else that speaks OpenAI's chat completions — including a
  model running on your own machine through Ollama or LM Studio.

**Getting it**

- **Windows** — the installer, or the portable .exe if you would rather it
  installed nothing. Windows will warn you about an unfamiliar app the first
  time; the download page shows the two clicks past it.
- **Linux** — the AppImage runs with no install at all, or take the .deb.
- **macOS** — not built, for want of an Apple developer licence. The download
  page says what to do instead.
- **Any machine with Node.js** — the zip runs from one call and is a megabyte.

Your stories live in your profile (**File → Open data folder** finds it) and are
left alone when you uninstall.
