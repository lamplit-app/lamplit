# Story and world

[← Documentation](README.md) · Previous: [Chapters](chapters.md) · Next: [The prompt](the-prompt.md)

---

A **story** is one self-contained document: who tells it, who you play, how it should read, and
everything that is true in its world. Its chapters are separate documents; the story is the thing
they all share.

Two modals hold all of it: **Story** and **World**. The scene, the narrator, the persona
and the cast are also in the [chapter panel](reading-and-writing.md), beside the page, for
the edits you want to make without leaving the story.

## Story → Mode

![Narrator or role-play](images/story-mode.png)

### Narrator

One voice tells the whole story. You say what you do; it writes what happens, what is said, and
what the world does in return. The default instruction asks for third person, past tense, clear
literary prose, and for it to end on something you can answer — and never to write for you.

**Write my own** replaces that instruction entirely, for this story. The default is shown so you
can see what you are replacing, and it stays in the box, greyed, until you write over it — so an
empty box is never a story with no narrator instruction at all. Whatever the box shows is what the
request is sent, here, in the chapter panel and under **What the model sees** alike.

### Role-play

The model plays the other characters and answers in their own words. Add them here — a name and a
description each — and switch any of them off without deleting them, either here or on the row in
the [chapter panel](reading-and-writing.md).

**Each one gets a colour** from a palette of ten, the moment it is added. Nobody is asked: the
first ten characters in a story are all different, and an eleventh shares with the first. The dot
beside a name opens the palette, and one more click changes it.

There is no colour picker there on purpose. Every one of the ten clears WCAG AA against both
papers and was chosen to stay as far as it can from the other nine once a common colour-vision
deficiency has flattened them — a free colour promises none of that. If you want one anyway,
**Preferences → Colours** lists the cast with a colour input each; that colour is used in both
themes, and **Back to the palette** undoes it.

A story written before any of this opens coloured, worked out from each character's place in the
cast, so it opens the same way every time.

There are two ways to cast it, and the choice sits under the mode.

**Ensemble** is the default and what the app has always done. The model plays every character in
the scene and answers as whoever the moment calls for. The prompt becomes *"You are playing X and
Y"* followed by each description. Pick it for a room: a scene where several people talk to each
other as much as to you, and you would rather the model decide who speaks than tell it.

**One at a time** gives the model a single character to be. The rest are named as present — it may
describe what they do, as your character sees it — but it never speaks for them. Pick it for a
conversation: one person across a table, whose voice you want to stay put. The prompt becomes
*"You are playing X, and nobody else"*, and the rule about never writing for your persona extends
to everybody else on stage.

**How the characters are played** is the instruction above the cast, folded away under **Add a
character**. Either casting sends it first, before the names and the descriptions, with every
request of a role-play story. A description says who a character is; this says how a role-play is
played — that each of them knows only what they would know and is not there to please you, that
they may disagree, refuse, lie or say nothing, that every reply should move the scene and leave you
something to answer, and that nothing steps outside the fiction to comment on it. It asks for
nothing about tense: role-play reads well in either, and your own prose is what settles it.

**Write my own role-play instructions** replaces it for this story, on the same terms as the
narrator's. The switch starts you from ours rather than from a blank page, so it is an edit; the
words stay in the box, greyed, if you switch back; and an emptied box is never a story with no
instruction — ours is sent, and the box shows what is being sent.

**Switching** is in the chapter panel's **Cast** section: click a row and the model plays that
character from there on. The row that is being played is marked, and the little switch on each row
takes a character in and out of the scene.

The model is told when any of that changes, at the point in the chapter where it changed:

> *From here you play Tomas. Nell is no longer the character you play; everything above in Nell's
> voice was Nell, not you.*
>
> *Isa has left the scene.* / *Isa joins the scene.*

Nothing already written is rewritten — the model is told what it was, and the chapter reads exactly
as it did. The notes are in [What the model sees](the-prompt.md) under **This chapter**, and each
answer remembers who wrote it: closing the chapter summarises it with the right names attached, and
the page says [who is speaking](reading-and-writing.md) above each passage.

## Story → Persona

![Who you play](images/story-persona.png)

Who *you* are in this story: a name and a few lines. It is sent with every single request, in
both modes, because it is the one thing the model cannot infer from the text.

Both fields are optional. Both are worth filling in.

## Story → Style

Two settings, and both of them become a sentence in the style rules the model is sent:

- **Ask for each spoken line on its own paragraph.**
- **Reply length** — short, medium or long.

Then one that is not sent at all. **Let the model choose the page colours from each chapter's
scene** is off unless you switch it on, and a chapter set in a snowbound monastery and one set in a
jazz club at two in the morning stop being read on the same cream paper. When it is on, confirming
the scene sheet sends one short request — the scene, and the ten palettes as a name, a line about
each and the moods it is for — and the model answers with a single name. The chapter is read on
that page from then on, keeps it when you come back to it, and switching chapters switches pages.
It never sees a colour, only the moods, and its answer can only be one of the ten. A failure of any
kind changes nothing. It is a request of its own and so a bill of its own, made once per scene and
never during a turn; what it cost is in the scene sheet's footer beside what the scene costs every
turn. Whatever it picks, the palette row in **Preferences → Colours** is where you overrule it —
see [Reading and writing](reading-and-writing.md).

> This is the half of "style" that is a *request to the model*. The half that is about how the
> text is drawn on your screen — text size, theme, whether quoted lines are visually broken out —
> lives in **Preferences → Reading** and changes nothing about the prompt. See
> [Reading and writing](reading-and-writing.md).

### Voice, and why there is no switch for it

Some writers put their character's actions in the first person — *I open the door* — and some in
the third — *Mara opens the door*. Some want a narrator that talks to them: *you open the door*.

There is no setting for any of it, on purpose. A model reads the frame from what it is given and
follows it, and **the first turns of a chapter set it more firmly than a checkbox would.** Write
your opening line the way you want the answers and you will usually get them; a switch that says
one thing while your prose says another is a fight the prose wins.

If you do want to say it outright — or it has drifted and you want it back — every one of these is
sent with the request, and every one of them is yours to edit:

- **Your own first turn.** The cheapest and the strongest. The model has your line in front of it
  and a pattern to continue.
- **The scene** — sent verbatim with every request of the chapter, and the first thing the model
  reads about it. A scene written in the voice you want is a strong and quiet instruction.
- **The narrator's instructions**, in narrator mode: **Story → Mode → Write my own**, or the
  **Narrator** section of the [chapter panel](reading-and-writing.md). The default's second
  sentence is *"Write in third person, past tense, in clear literary prose."* Replace that one
  sentence — *"Address Mara as you and write in the second person, present tense"* — and keep the
  rest of it as it is. The text starts out as the default, so this is an edit rather than a blank
  page.
- **How the characters are played**, in role-play: **Story → Mode → How the characters are
  played**. It asks for nothing about tense on purpose, so there is nothing there to argue with
  your prose; add a sentence to it if you want to say it outright.
- **Your persona's description**, which is sent in both modes: *"Mara, a marine biologist. Her
  lines are written in the first person."*
- **An author direction**, for a change part-way through a chapter:
  *[AUTHOR] From here, write in the second person.* It is followed, it is never mentioned, and it
  stays in the chapter behind every later turn. See
  [Reading and writing](reading-and-writing.md).

Whatever you change, [What the model sees](the-prompt.md) shows the assembled request, so you can
read what the model is actually being told rather than guessing why it answered as it did.

## World → Story so far

![The story so far](images/world.png)

One page of prose that is **always sent**, no conditions. It is the memory of everything before
the current chapter.

You can write it yourself — it is just a text box — but mostly you will not have to: **close
chapter** rewrites it for you, folding the chapter just finished into it. See
[Chapters](chapters.md).

**How a chapter is folded in** is the instruction that does that rewriting, and this is where you
replace it for this story if the default is not to your taste. **Folded in so far** underneath
lists which chapters have been folded in.

**When a chapter closes, propose lore entries from it** is the switch under that, off by default.
On, closing a chapter makes a second request after the summary — the same chapter, read for what
it *established* rather than for what happened — and the review sheet shows what came back as a
checklist. Nothing is written without a tick, an update to an existing entry arrives unticked, and
a failure is one muted line rather than a blocked close. See [Chapters](chapters.md) for what the
sheet looks like; the button there does the same thing once, whether or not this switch is on.

## World → Lore

![A world of entries, one line each](images/lore-collapsed.png)

Lore is everything that is true in the world but only worth sending *when the story is about it*.
People, places, facts. Entries collapse to a single line — title, keys, state — so a world can
hold dozens and still be read at a glance, grouped by kind.

Open one to edit it:

![One entry open](images/lore-open.png)

| Field | |
|---|---|
| **Title** | What you call it. Also the label in the collapsed list. |
| **Kind** | Fact, person, place or other. Only groups the list. |
| **Keys** | Comma separated. Any one of them fires the entry. |
| **What is true** | The sentence the model actually receives. Required — an entry without it is flagged rather than quietly skipped, because an entry *is* the sentence it contributes. |
| **Enabled** | Off means it never fires. Useful for something not true *yet*. |
| **Always on** | Skip the keyword scan; send it every time. |

### How the scan works

Before each request the app searches a window of text for every enabled entry's keys. The window
is:

- the chapter's **scene**,
- what you have **just typed**,
- and the last **N messages** of the chapter.

N is **Scan depth** at the bottom of the tab (4 by default). Matching is case-insensitive
substring by default; **Case sensitive** and **Whole words only** are there if a short key is
firing on the wrong thing.

Entries that fire are sent as a "What is true in this world" block. Entries that do not fire cost
nothing. You can always check which fired, and on which key, in
[What the model sees](the-prompt.md).

## Several stories

The story name in the top bar opens the story menu: switch between them, **Rename**,
**Duplicate**, **Delete**, or **New story…**.

Each story is self-contained — persona, cast, world and all — so **Duplicate** is how you reuse a
setup for a new run without a shared library to maintain. Deleting a story deletes its chapters
with it, and asks first.
