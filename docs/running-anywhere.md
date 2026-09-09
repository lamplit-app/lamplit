# Running it anywhere

[← Documentation](README.md) · Previous: [The desktop app](desktop.md) · Next: [On your phone](on-your-phone.md)

---

The whole app as one folder, about a megabyte, for any machine that has Node.js on it: the same
server and the same built app the [desktop app](desktop.md) wraps, without the browser engine.
This is the way in on a Mac, where there is no installer, and the way in on a machine with no
desktop to speak of.

**[Download Lamplit.zip](https://github.com/lamplit-app/lamplit/releases/latest/download/Lamplit.zip)**
— that link always points at the newest release. The version is inside, in `package.json` and
`README.txt`.

Unzip it anywhere and make one call:

| Where | Call |
|---|---|
| Windows | `start.bat` — double-click it |
| macOS | `start.command` — double-click it |
| Linux | `./start.sh` (`start.command` is the same script under the name Finder will run) |

## What is in it

```
lamplit-0.2.0/
  start.bat          Windows: double-click it
  start.command      macOS: double-click it
  start.sh           Linux: ./start.sh
  server/            the persistence server
  public/            the built app, served by it
  node_modules/      the server's production dependencies, and only those
  package.json
  README.txt
  data/              created on first run, beside the script
```

The server's dependencies travel inside, resolved from the tree that was actually tested rather
than fetched again at the far end. **Node.js 20.19+ is the only thing that has to be on the
machine already.** There is nothing to install and nothing to build.

## If Node.js is missing, or too old

The start scripts check for it before anything else — presence *and* version, because an old Node
would otherwise fail somewhere deep with a stack trace. When it is missing or too old, the script
says so in one line and offers the one command that would install it on this machine:

| | |
|---|---|
| Windows, with winget | `winget install OpenJS.NodeJS.LTS` |
| macOS, with Homebrew | `brew install node` |
| Linux | `sudo apt install nodejs npm`, or the `dnf` or `pacman` equivalent |

It is an offer, not a step: a y/n prompt with the exact command on screen, and **nothing is
installed unless the answer is yes.** Say no, or have none of those package managers, and it prints
the download to fetch from [nodejs.org](https://nodejs.org/en/download) for this system and stops.

A distribution's own `nodejs` package is sometimes older than 20.19. If it is, the script says so
after the install and points at nodejs.org, rather than starting and failing.

## On a Mac

`start.command` and `start.sh` are the same script under two names. Finder opens a `.sh` in a text
editor and *runs* a `.command`, so double-clicking is the one that works.

The first time you run a file you downloaded, macOS may refuse it — *"cannot be opened because it
is from an unidentified developer"*, the quarantine flag every download carries. Right-click
`start.command` and choose **Open** instead: that asks once, and never again for that file.

## What happens when you run it

One call starts the server, opens <http://127.0.0.1:4177> in your browser, and creates `data/`
beside itself. Close the window or press **Ctrl+C** to stop it.

Any current browser will do. In one that does not yet size text boxes to their text (Firefox
before 152, Safari before 26.2) the boxes keep their starting height and scroll inside themselves
instead of growing; nothing else is different.

If port 4177 is busy it takes the next free one and says so.

## Options

Both scripts pass their arguments straight through:

```bash
./start.sh --port 5000              # listen somewhere else
./start.sh --data ~/stories         # keep the documents somewhere else
```

```
start.bat --port 5000
start.bat --data D:\stories
```

And by environment variable:

| | |
|---|---|
| `LAMPLIT_PORT`, `LAMPLIT_DATA_DIR` | the same two, as variables |
| `LAMPLIT_OPEN=0` | do not open a browser |
| `LAMPLIT_BACKUP=0` | skip the daily backup |
| `LAMPLIT_BACKUP_DIR` | put backups somewhere else |
| `LAMPLIT_HOST` | bind somewhere other than `127.0.0.1` — think before you do |
| `LAMPLIT_SHARE_PORT` | the port sharing uses, instead of 4177 |
| `LAMPLIT_SHARE_HOST` | which interface sharing opens on, instead of all of them |

## From your phone

Lamplit is a web app served by its own server, so a phone on the same Wi-Fi only needs to be let
in. Open **Preferences → Advanced** and switch on **Share on this network**.

A second listener opens on port 4177 — the one on `127.0.0.1` never moves, and the tab already open
on the computer does not notice. Under the switch is a QR code. Point your phone's camera at it: it
opens Lamplit once, the phone is remembered, and after that the story is simply there. If the
computer has more than one network address, which is usual on Windows, pick the one your phone is
likely to be on and scan that code; the wrong one simply will not load.

**New code** makes a fresh code and unpairs every phone that has ever scanned one. Use it if a
phone goes missing, or if you shared on a network you would rather not have.

What the app looks like once the phone is in — the one menu, the panel as a sheet, and adding it to
the home screen — is [On your phone](on-your-phone.md).

Two things are worth being plain about:

- **A phone that has scanned the code can do everything you can.** Read and change every story, and
  read your API key, which Lamplit keeps as plain text. There is no second password.
- **It is plain HTTP.** The traffic between the phone and the computer is not encrypted. HTTPS
  needs a certificate that a phone will trust, which needs a domain name, which is not something
  a folder on your laptop has.

So: a network you trust, and switch it off when you are done. Switching it off closes the listener
at once; the setting is remembered, so a machine that was sharing when you shut it down is sharing
again when it starts.

One thing sharing cannot fix: **a model running on the computer.** The story is sent to the model
by the browser showing it, so if your endpoint is `http://localhost:...`, the phone will reach
Lamplit and then try to reach the model on the *phone*, and fail. Preferences says so when it
notices. Give Lamplit an endpoint the phone can reach as well, and both work.

## Moving it

The folder is self-contained and writes nothing outside itself. Copy it to a USB stick, a NAS, a
second machine; the stories go with it. Nothing is registered with the operating system and
nothing is left behind if you delete it.

The same fact is what makes an upgrade a two-step job here rather than one: the new zip is a new
folder, and `data` is in the old one. [Upgrading](upgrading.md) has the two ways to carry it
across.

## Building it yourself

The release's zip is built by the workflow from the same staged folder the installers are built
from, so it is the same bytes either way. To make one here — from a branch, from a change you have
not pushed, or because you would rather not download a binary:

```bash
npm run package
```

That builds the app and writes two things into `build/`:

```
build/
  lamplit-0.2.0/          the folder, ready to run
  lamplit-0.2.0.zip       the same folder, ~1 MB
```

```bash
npm run package -- --no-build     # reuse the last Angular build
npm run package -- --out dist     # write somewhere other than build/
```

## The zip, or the desktop app?

[The desktop app](desktop.md) wraps exactly this folder — the same server, the same built app, the
same dependencies — and adds Node.js and a window. Take it if you want one file and one icon.

Take the zip when the machine already has Node and you would rather have a megabyte than a hundred
of them, when you want the stories in a folder you chose rather than in a profile, or when you are
putting it somewhere that has no desktop to speak of. Both read and write the same files, so
nothing stops you from using each where it suits.
