import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DEFAULT_SUMMARY_INSTRUCTION } from '../../core/defaults';
import { LoreProposal, entryFrom } from '../../core/lore-extraction';
import { LoreEntry } from '../../core/models';
import { tokenCost } from '../../core/tokens';
import { newId } from '../../store/documents';
import { ChapterStore } from '../../store/chapter-store';
import { StoryStore } from '../../store/story-store';
import { EditorField } from '../../shared/editor-field';
import { TextValue } from '../../shared/text-value';
import { chapterTitle } from '../../core/prompt-builder';
import { countWords } from '../../shared/editor-field';

/**
 * What the writer settled on: the summary the chapter is folded in by, and the
 * entries they ticked. Nothing here is written by the sheet — closing a
 * chapter is one act, and it happens in one place.
 */
export interface ChapterClose {
  summary: string;
  entries: LoreEntry[];
}

/**
 * Close chapter: the model writes the summary, the writer edits it, and it
 * joins the story so far. The chapter itself is kept either way — nothing here
 * discards anything.
 */
@Component({
  selector: 'li-close-chapter-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatExpansionModule,
    MatProgressSpinnerModule,
    EditorField,
    TextValue,
  ],
  template: `
    <h2 mat-dialog-title>Close {{ heading() }}</h2>

    <mat-dialog-content>
      <p class="li-hint">
        This is the whole story so far, rewritten to include the chapter just finished — it replaces
        what was there rather than being added to it. Confirming closes this chapter and opens the
        next one's scene; the chapter itself stays in the Chapters list, readable, and can be
        continued later.
      </p>

      @if (error()) {
        <p class="error">{{ error() }}</p>
      }

      <textarea
        style="--rows-min: 8; --rows-max: 20"
        [liText]="summary()"
        [readonly]="busy()"
        [placeholder]="
          busy() ? 'Writing the summary…' : 'Write what this chapter should be remembered for.'
        "
        (input)="summary.set(text($event))"
      ></textarea>

      <span class="foot li-hint">
        @if (busy()) {
          <mat-spinner diameter="14" />
          Writing…
        } @else {
          {{ words() }} words
          @if (summaryCost()) {
            · {{ summaryCost() }}
          }
        }
      </span>

      <!-- What the chapter established, as entries rather than as prose. The
           button is here whether or not the story asks for it on its own: it
           is one request, and wanting it once is not wanting it every time. -->
      <section class="proposals">
        <header>
          <span class="name">Lore from this chapter</span>
          @if (proposing()) {
            <span class="li-hint reading"><mat-spinner diameter="14" /> Reading it…</span>
          } @else {
            <button matButton (click)="propose()">
              {{ proposed() ? 'Propose again' : 'Propose lore' }}
            </button>
          }
        </header>

        @if (loreError()) {
          <p class="li-hint failed">{{ loreError() }}</p>
        }

        @for (proposal of proposals(); track $index) {
          <label class="proposal" [class.on]="ticked().has($index)">
            <input
              type="checkbox"
              [checked]="ticked().has($index)"
              (change)="toggle($index)"
              [attr.aria-label]="'Keep ' + proposal.title"
            />
            <div class="body">
              <span class="head">
                <span class="title">{{ proposal.title }}</span>
                <span class="category">{{ proposal.category }}</span>
                @if (proposal.updates) {
                  <span class="category update">replaces an entry</span>
                }
              </span>
              <span class="keys">
                @for (key of proposal.keys; track key) {
                  <span class="key">{{ key }}</span>
                }
              </span>
              <p class="content">{{ proposal.content }}</p>
              @if (proposal.updates; as existing) {
                <p class="was"><span class="tag">now</span>{{ existing.content }}</p>
              }
            </div>
          </label>
        } @empty {
          @if (proposed() && !loreError()) {
            <p class="li-hint">Nothing in this chapter was worth an entry of its own.</p>
          } @else if (!proposing()) {
            <p class="li-hint">
              Ask the model what this chapter established — people, places, facts — and tick what is
              worth keeping. Nothing is written unless you tick it.
            </p>
          }
        }

        @if (loreCost()) {
          <span class="foot li-hint">{{ loreCost() }}</span>
        }
      </section>

      <mat-expansion-panel class="instruction">
        <mat-expansion-panel-header>
          <mat-panel-title>What was asked for</mat-panel-title>
          <mat-panel-description>
            {{ story().world.summary.useDefault ? 'default instruction' : 'your own instruction' }}
          </mat-panel-description>
        </mat-expansion-panel-header>

        @if (story().world.summary.useDefault) {
          <p class="preset">{{ defaultInstruction }}</p>
          <button matButton="outlined" (click)="override()">Write my own</button>
        } @else {
          <li-editor-field
            label="Instruction"
            [rows]="5"
            [value]="story().world.summary.prompt"
            (save)="stories.setSummaryPrompt({ prompt: $event })"
          />
          <button matButton (click)="restoreDefault()">Back to the default</button>
        }
        <p class="li-hint">
          Saved with the story, and used every time a chapter is closed. Change it and write the
          summary again to see the difference.
        </p>
      </mat-expansion-panel>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton (click)="cancel()">Cancel</button>
      @if (!busy()) {
        <button matButton (click)="rewrite()">Write it again</button>
      } @else {
        <button matButton (click)="stop()">Stop</button>
      }
      <button matButton="filled" [disabled]="busy() || !summary().trim()" (click)="confirm()">
        Close the chapter
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    /* A chapter named after a long opening line must not wrap the header. */
    h2 {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    mat-dialog-content {
      display: flex;
      flex-direction: column;
      gap: var(--li-space-sm);
    }

    /* The story so far is prose, and set as prose. */
    textarea {
      font-family: var(--li-serif);
      font-size: var(--li-text-lg);
      line-height: 1.6;
    }

    .foot {
      display: flex;
      align-items: center;
      gap: var(--li-space-xs);
    }

    /* -- the proposals --------------------------------------------------- */

    .proposals {
      display: flex;
      flex-direction: column;
      gap: var(--li-space-sm);
      padding: var(--li-space-sm) var(--li-space-md) var(--li-space-md);
      border: 1px solid var(--li-border);
      border-radius: var(--li-radius-lg);
    }

    .proposals header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--li-space-sm);
      min-height: 2rem;
    }

    .proposals .name {
      font-family: var(--li-sans);
      font-size: var(--li-text-md);
      color: var(--li-ink-soft);
    }

    .reading {
      display: flex;
      align-items: center;
      gap: var(--li-space-xs);
    }

    .failed {
      margin: 0;
      color: var(--li-muted);
    }

    /* A row is the tick and what it would file. Unticked is the resting state
       for an update, so the sheet has to make the difference visible without
       shouting: a tint, not a border. */
    .proposal {
      display: flex;
      align-items: flex-start;
      gap: var(--li-space-sm);
      padding: var(--li-space-sm);
      border: 1px solid var(--li-border);
      border-radius: var(--li-radius-md);
      cursor: pointer;
    }

    .proposal.on {
      border-color: color-mix(in srgb, var(--li-accent) 45%, var(--li-border));
      background: color-mix(in srgb, var(--li-accent) 8%, transparent);
    }

    .proposal input {
      margin: var(--li-space-3xs) 0 0;
      accent-color: var(--li-accent);
    }

    .proposal .body {
      display: flex;
      flex-direction: column;
      gap: var(--li-space-2xs);
      min-width: 0;
    }

    .proposal .head {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: var(--li-space-sm);
    }

    .proposal .title {
      font-family: var(--li-sans);
      font-size: var(--li-text-md);
      color: var(--li-ink);
    }

    .category {
      padding: 0 var(--li-space-xs);
      border-radius: var(--li-radius-pill);
      background: color-mix(in srgb, var(--li-ink) 8%, transparent);
      font-family: var(--li-sans);
      font-size: var(--li-text-xs);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--li-muted);
    }

    .keys {
      display: flex;
      flex-wrap: wrap;
      gap: var(--li-space-xs);
    }

    .key {
      padding: 0 var(--li-space-xs);
      border: 1px solid var(--li-border);
      border-radius: var(--li-radius-pill);
      font-family: var(--li-sans);
      font-size: var(--li-text-xs);
      color: var(--li-muted);
    }

    .proposal .content {
      margin: 0;
      font-family: var(--li-serif);
      font-size: var(--li-text-md);
      line-height: 1.55;
      color: var(--li-ink-soft);
    }

    /* What the entry says today, beside what it would say instead: an update
       overwrites, and nobody should have to remember what it overwrote. */
    .was {
      margin: 0;
      padding-left: var(--li-space-sm);
      border-left: 2px solid color-mix(in srgb, var(--li-muted) 40%, transparent);
      font-family: var(--li-serif);
      font-size: var(--li-text-md);
      line-height: 1.5;
      color: var(--li-muted);
    }

    .was .tag {
      margin-right: var(--li-space-xs);
      font-family: var(--li-sans);
      font-size: var(--li-text-xs);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .instruction {
      /* The panel clips its body for its own animation, and a flex column
         squashes anything that clips when it runs out of room: it would be
         folded to nothing under a long summary rather than scrolled to. */
      flex-shrink: 0;
      border: 1px solid var(--li-border);
      border-radius: var(--li-radius-lg);
    }

    mat-panel-description {
      flex: none;
      color: var(--li-muted);
      font-size: var(--li-text-sm);
    }

    .preset {
      margin: 0 0 var(--li-space-sm);
      padding: var(--li-space-md);
      border: 1px dashed var(--li-border);
      border-radius: var(--li-radius-md);
      font-family: var(--li-serif);
      font-size: var(--li-text-md);
      line-height: 1.6;
      color: var(--li-ink-soft);
    }

    .error {
      margin: 0;
      padding: var(--li-space-sm) var(--li-space-md);
      border: 1px solid color-mix(in srgb, var(--li-danger) 40%, var(--li-border));
      border-radius: var(--li-radius-md);
      color: var(--li-danger);
      font-size: var(--li-text-md);
      line-height: 1.5;
    }
  `,
})
export class CloseChapterDialog {
  private readonly ref = inject(MatDialogRef<CloseChapterDialog, ChapterClose | undefined>);
  private readonly chapters = inject(ChapterStore);
  protected readonly stories = inject(StoryStore);
  protected readonly story = this.stories.story;
  protected readonly defaultInstruction = DEFAULT_SUMMARY_INSTRUCTION;

  protected readonly summary = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly words = computed(() => countWords(this.summary()));
  protected readonly summaryCost = signal('');

  /** The proposals, and which of them the writer has kept. */
  protected readonly proposals = signal<LoreProposal[]>([]);
  protected readonly ticked = signal<ReadonlySet<number>>(new Set());
  protected readonly proposing = signal(false);
  protected readonly proposed = signal(false);
  protected readonly loreError = signal('');
  protected readonly loreCost = signal('');

  protected readonly heading = computed(() => {
    const chapter = this.chapters.chapter();
    const title = chapterTitle(chapter);
    return `Chapter ${chapter.number}${title ? ` — ${title}` : ''}`;
  });

  private controller: AbortController | null = null;
  private loreController: AbortController | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.stop();
      this.loreController?.abort();
    });
    void this.open();
  }

  /**
   * The summary first, and then the entries if the story asks for them — in
   * that order rather than at once, because they are the same chapter read
   * twice and the second read is the one the writer can do without.
   */
  private async open(): Promise<void> {
    await this.rewrite();
    if (this.story().world.extractLore && !this.error()) await this.propose();
  }

  protected override(): void {
    this.stories.setSummaryPrompt({ useDefault: false, prompt: DEFAULT_SUMMARY_INSTRUCTION });
  }

  protected restoreDefault(): void {
    this.stories.setSummaryPrompt({ useDefault: true });
  }

  protected text(event: Event): string {
    return (event.target as HTMLTextAreaElement).value;
  }

  /**
   * Asked for again after a Stop, and the first request is still on its way
   * back: aborting resolves rather than throws, so the old one arrives after
   * the new one started. Everything it has to say — its deltas, its cost, its
   * error, its "no longer busy" — is about a summary that is no longer on the
   * screen, and left to speak it would append to the new text, hand the Stop
   * button a controller that no longer aborts anything, and offer Write it
   * again while writing. So each request is compared with the one in hand.
   */
  protected async rewrite(): Promise<void> {
    this.stop();
    this.summary.set('');
    this.error.set('');
    this.busy.set(true);
    const controller = new AbortController();
    this.controller = controller;
    const result = await this.chapters.summarise((delta) => {
      if (this.controller === controller) this.summary.update((text) => text + delta);
    }, controller.signal);
    if (this.controller !== controller) return;

    this.busy.set(false);
    this.controller = null;
    this.summaryCost.set(tokenCost(result.usage));
    if (result.error) this.error.set(result.error);
    // Streamed text is already in the signal; the final text wins if it differs.
    else if (result.text) this.summary.set(result.text);
  }

  /**
   * A second request, on the same chapter. A failure is a muted line and
   * nothing else: the summary is written, the close is not blocked, and a
   * chapter is not held up by a feature that is meant to save typing.
   */
  protected async propose(): Promise<void> {
    if (this.proposing()) return;
    this.loreController?.abort();
    this.loreError.set('');
    this.loreCost.set('');
    this.proposals.set([]);
    this.ticked.set(new Set());
    this.proposing.set(true);
    const controller = new AbortController();
    this.loreController = controller;

    const result = await this.chapters.proposeLore(controller.signal);
    // The same rule as the summary above: an answer to a question that has
    // since been asked again belongs to nobody.
    if (this.loreController !== controller) return;
    this.loreController = null;
    this.proposing.set(false);
    this.proposed.set(true);
    this.loreCost.set(tokenCost(result.usage));
    if (result.error) {
      this.loreError.set(`No entries came back: ${result.error}`);
      return;
    }
    this.proposals.set(result.proposals);
    // A new entry is additive and a mistake is one deletion away; an update
    // overwrites something the writer wrote, so it waits to be asked for.
    this.ticked.set(
      new Set(result.proposals.map((p, i) => (p.updates ? -1 : i)).filter((i) => i >= 0)),
    );
  }

  protected toggle(index: number): void {
    this.ticked.update((set) => {
      const next = new Set(set);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  }

  protected stop(): void {
    this.controller?.abort();
    this.controller = null;
    this.busy.set(false);
  }

  /**
   * Backing out, with nothing written: not the chapter, not the story so far,
   * and not a single proposal. Explicitly rather than through
   * `mat-dialog-close`, whose bare form closes with an empty string — which
   * read as an answer here, and closed the chapter on a summary of nothing.
   */
  protected cancel(): void {
    this.answer(undefined);
  }

  /**
   * The sheet is answered once, and the answer stands.
   *
   * A dialog goes on listening for Escape and for a click outside while it is
   * closing, and Material treats either as a fresh close with no result — so a
   * key pressed in the fraction of a second after Close the chapter threw away
   * the summary and the entries on their way out, and the chapter stayed open.
   * Refusing further closes is what makes the decision a decision.
   */
  private answer(result: ChapterClose | undefined): void {
    this.ref.disableClose = true;
    this.ref.close(result);
  }

  protected confirm(): void {
    const summary = this.summary().trim();
    if (!summary) return;
    // Only what was ticked. An untouched sheet keeps nothing at all, which is
    // what "propose" has to mean.
    const kept = this.proposals().filter((_, i) => this.ticked().has(i));
    this.answer({ summary, entries: kept.map((proposal) => entryFrom(proposal, newId())) });
  }
}
