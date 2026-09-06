import {
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ChapterStore } from '../../store/chapter-store';
import { SettingsStore } from '../../store/settings-store';
import { StoryStore } from '../../store/story-store';
import { DialogsService } from '../../shared/dialogs.service';
import { chapterTitle } from '../../core/prompt-builder';
import { ChapterToolbar } from './chapter-toolbar';
import { Composer } from './composer';
import { MessageList } from './message-list';

/** How close to the bottom still counts as "following along". */
const PINNED_SLACK = 96;

/**
 * The chapter, top to bottom, in one scroller.
 *
 * The composer is the end of the page rather than a dock under it: the story,
 * the chapter's own controls, and then the box to write the next line in. Read
 * to the end and the box is there; scroll up and it goes away with everything
 * else, which is the whole point — a fast model streams faster than anyone
 * reads, and a quarter of a laptop screen held for a box nobody is touching yet
 * is a quarter of a screen not being read on.
 *
 * Which means the scrolling lives here rather than in the message list: there
 * is one scrollport and it holds all three.
 */
@Component({
  selector: 'li-chapters-page',
  imports: [MatButtonModule, MatTooltipModule, ChapterToolbar, Composer, MessageList],
  template: `
    <section #scroller class="page" (scroll)="onScroll()">
      <div #content class="content">
        @if (chapters.isEmpty()) {
          <div class="welcome">
            <div class="card">
              @if (!chapters.hasScene()) {
                <h1>Chapter {{ chapters.chapter().number }}</h1>
                <p>
                  A chapter opens the way a scene opens in a playscript: a few lines saying where we
                  are, when, and what is happening as the lights come up. Write those, and the
                  chapter starts.
                </p>
                <button matButton="filled" (click)="writeScene()">Write the scene</button>
              } @else if (!settings.isConnected()) {
                <h1>{{ title() }}</h1>
                <p>
                  Lamplit talks straight from this page to any OpenAI-compatible endpoint. Point it
                  at one and start writing.
                </p>
                <button matButton="filled" (click)="dialogs.openConnection()">
                  Connect a model
                </button>
              } @else {
                <h1>{{ title() }}</h1>
                <p class="scene">{{ chapters.chapter().scene }}</p>
                <p class="li-hint">
                  Write the first line below. Answering with {{ settings.connection().model }}.
                </p>
              }
            </div>
          </div>
        } @else {
          <li-message-list />
        }

        <li-chapter-toolbar />
        <li-composer (startedTyping)="jumpToLatest()" />

        <!-- Room under the composer, so the last line of the story can be read
             with the box below it rather than against the bottom edge, and so
             the pinned position never puts the caret on the last pixel. -->
        <div class="tail"></div>
      </div>

      <!-- Inside the scroller and the same width as the column, so the button
           lands in the same margin the message actions use. Outside it, the
           scrollbar would be counted in the middle and the two would be a few
           pixels out of line. -->
      @if (!pinned()) {
        <div class="jump-dock">
          <button
            class="jump"
            type="button"
            (click)="jumpToLatest()"
            matTooltip="Jump to latest"
            matTooltipPosition="left"
            aria-label="Jump to latest"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 2.8v9.4m0 0 3.6-3.6M8 12.2 4.4 8.6" />
            </svg>
          </button>
        </div>
      }
    </section>
  `,
  styles: `
    @use '../../../breakpoints' as bp;

    :host {
      display: block;
      height: 100%;
      min-height: 0;
    }

    /* The one scrollport: the story, the toolbar and the composer are all in
       it, in that order. */
    .page {
      height: 100%;
      overflow-y: auto;
      overflow-x: hidden;
    }

    /* At least a screen tall, so a chapter with two lines in it puts the
       composer where a chapter with two hundred does — near the foot of the
       first screen — rather than tight under the second line with the rest of
       the screen blank. Past a screen it simply grows, and the composer goes
       wherever the story ends. */
    .content {
      display: flex;
      flex-direction: column;
      min-height: 100%;
    }

    li-message-list,
    .welcome {
      flex: 1;
    }

    .welcome {
      display: grid;
      place-items: center;
      padding: var(--li-space-xl);
    }

    .tail {
      flex: none;
      height: 33vh;
    }

    /* Dynamic viewport units, because on a phone a third of the screen is a
       third of what can be seen right now — the address bar and the keyboard both take from it.
       The home bar is drawn over the foot of the page, and this is where the
       page pays it back: it is the last thing in the scroller, so nothing the
       story is made of is ever under it. */
    @include bp.phone {
      .tail {
        height: calc(33dvh + env(safe-area-inset-bottom));
      }
    }

    /* A strip of nothing, the width of the column, stuck a finger's width above
       the foot of the scrollport. It carries no height of its own, so it adds
       nothing to the page it is sitting at the end of. */
    .jump-dock {
      position: sticky;
      bottom: var(--li-space-lg);
      width: var(--li-column);
      height: 0;
      margin: 0 auto;
      pointer-events: none;
    }

    /* In the margin, in the same column as a message's actions, rather than
       over the last lines being read. Where there is no margin it tucks into
       the corner of the scroller, on the column's own side padding, small
       enough to cover at most the end of the longest line. */
    .jump {
      position: absolute;
      bottom: 0;
      right: calc(-1 * var(--li-space-lg));
      pointer-events: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      width: var(--li-rail);
      height: var(--li-rail);
      padding: 0;
      border: 1px solid var(--li-border);
      border-radius: 50%;
      background: var(--li-surface-raised);
      color: var(--li-ink-soft);
      cursor: pointer;
      box-shadow: var(--li-shadow-raised);
    }

    .jump:hover,
    .jump:focus-visible {
      color: var(--li-ink);
      border-color: color-mix(in srgb, var(--li-accent) 55%, var(--li-border));
    }

    .jump svg {
      width: 1rem;
      height: 1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    @include bp.touch {
      .jump {
        width: 2.75rem;
        height: 2.75rem;
      }
    }

    /* The same margin the message actions ask for, so the two line up. */
    @media (min-width: 42rem) {
      .jump {
        right: auto;
        left: calc(100% + var(--li-margin-gap));
      }
    }

    .card {
      max-width: 30rem;
      text-align: center;
    }

    h1 {
      font-family: var(--li-serif);
      font-weight: 500;
      font-size: var(--li-text-2xl);
      margin: 0 0 var(--li-space-sm);
      color: var(--li-ink);
    }

    p {
      font-family: var(--li-serif);
      font-size: var(--li-text-lg);
      line-height: 1.6;
      color: var(--li-ink-soft);
      margin: 0 0 var(--li-space-lg);
    }

    /* The scene is prose the writer wrote: set it as prose, not as a caption. */
    .scene {
      white-space: pre-wrap;
      text-align: left;
      padding: var(--li-space-md) var(--li-space-lg);
      border-left: 2px solid color-mix(in srgb, var(--li-accent) 55%, transparent);
      background: color-mix(in srgb, var(--li-surface) 70%, transparent);
    }

    p.li-hint {
      font-family: var(--li-sans);
      font-size: var(--li-text-sm);
    }
  `,
})
export class ChaptersPage {
  protected readonly chapters = inject(ChapterStore);
  protected readonly stories = inject(StoryStore);
  protected readonly settings = inject(SettingsStore);
  protected readonly dialogs = inject(DialogsService);

  protected readonly title = computed(
    () => chapterTitle(this.chapters.chapter()) || `Chapter ${this.chapters.chapter().number}`,
  );

  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  private readonly content = viewChild.required<ElementRef<HTMLElement>>('content');

  /** False once the reader scrolls up: streaming must not yank them back. */
  protected readonly pinned = signal(true);

  /** Changes on a chapter switch, a new message, and every flushed delta. */
  private readonly growth = computed(() => {
    const messages = this.chapters.written();
    const last = messages[messages.length - 1];
    return `${this.chapters.chapter().id}:${messages.length}:${last?.content.length ?? 0}`;
  });

  /** The chapter the pinning belongs to; a different one opens at its end. */
  private shownChapterId = '';

  constructor() {
    afterRenderEffect(() => {
      this.growth();
      // `untracked`, because `keepPinned` reads `pinned` and this effect is
      // reactive over what its callback reads: scrolling into the last inch
      // flips `pinned` true, which would re-run this and snap the reader to
      // the very bottom — a page that pulls the last line out from under them
      // as they arrive at it.
      untracked(() => {
        const id = this.chapters.chapter().id;
        if (id !== this.shownChapterId) {
          // Opened rather than grown: a chapter starts at its end, whatever
          // was true of the one being left.
          this.shownChapterId = id;
          this.pinned.set(true);
        }
        this.keepPinned();
      });
    });

    // Everything else that makes the page taller while the reader is at the
    // foot of it: the composer growing as it is written into, the author's
    // field opening, the toolbar wrapping. A page that grew under a reader who
    // had not moved should still end where they are looking.
    const observer = new ResizeObserver(() => this.keepPinned());
    afterRenderEffect(() => observer.observe(this.content().nativeElement));
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }

  protected onScroll(): void {
    const element = this.scroller().nativeElement;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    this.pinned.set(distance <= PINNED_SLACK);
  }

  /** The end of the page, composer and all. Also where typing sends you. */
  protected jumpToLatest(): void {
    this.pinned.set(true);
    this.scrollToBottom();
  }

  protected writeScene(): void {
    void this.dialogs.openScene(this.chapters.chapter().id, true);
  }

  private keepPinned(): void {
    if (this.pinned()) this.scrollToBottom();
  }

  private scrollToBottom(): void {
    const element = this.scroller().nativeElement;
    element.scrollTop = element.scrollHeight;
  }
}
