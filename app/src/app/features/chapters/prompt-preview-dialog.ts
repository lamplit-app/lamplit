import { Component, computed, inject } from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { ChapterStore } from '../../store/chapter-store';
import { StoryStore } from '../../store/story-store';
import { BlockId } from '../../core/models';
import {
  MOVABLE_BLOCKS,
  PINNED_FIRST,
  PINNED_LAST,
  PIN_REASONS,
  isDefaultOrder,
  movableOrder,
  withDirection,
} from '../../core/prompt-builder';
import { formatTokens } from '../../core/tokens';

export interface PromptPreviewData {
  draft: string;
  /** The direction the composer has open, if any; sent with the draft. */
  direction: string;
}

/**
 * The whole prompt, block by block, with what each one costs and which lore
 * fired on which key. One click from the composer, and it replaces most of
 * what a prompt manager is for.
 *
 * The four blocks in the middle can be dragged into a different order, and the
 * sheet rebuilds as they move — the point of reordering is to see what it does,
 * and a preview that only agreed with you after you closed it would be no help.
 * There is no check for developer mode here: this sheet is only reachable
 * through the pill that mode puts back, so being open is the check.
 */
@Component({
  selector: 'li-prompt-preview-dialog',
  imports: [DragDropModule, MatButtonModule, MatDialogModule, MatTooltipModule],
  template: `
    <h2 mat-dialog-title>What the model sees</h2>

    <mat-dialog-content>
      <p class="li-hint">
        Rebuilt from the story, the chapter and its messages every time you send.
        {{ totals() }}
      </p>

      @for (block of leading(); track block.id) {
        <section class="block pinned">
          <header>
            <span class="pin" aria-hidden="true">•</span>
            <span class="name">{{ block.label }}</span>
            <span class="tokens">{{ format(block.tokens) }}</span>
          </header>
          <pre>{{ block.content }}</pre>
          <p class="why">{{ reasons[block.id] }}</p>
        </section>
      }

      <div cdkDropList (cdkDropListDropped)="drop($event)">
        @for (block of movable(); track block.id) {
          <section class="block movable" cdkDrag cdkDragBoundary="mat-dialog-content">
            <header>
              <button
                class="handle"
                type="button"
                cdkDragHandle
                [attr.aria-label]="handleLabel(block.label)"
                matTooltip="Drag, or use the arrow keys"
                (keydown)="onHandleKey($event, block.id)"
              >
                ⠿
              </button>
              <span class="name">{{ block.label }}</span>
              <span class="tokens">{{ format(block.tokens) }}</span>
            </header>
            <pre>{{ block.content }}</pre>
            <div class="ghost" *cdkDragPlaceholder></div>
          </section>
        }
      </div>

      @for (block of trailing(); track block.id) {
        <section class="block pinned">
          <header>
            <span class="pin" aria-hidden="true">•</span>
            <span class="name">{{ block.label }}</span>
            <span class="tokens">{{ format(block.tokens) }}</span>
          </header>
          <pre>{{ block.content }}</pre>
          <p class="why">{{ reasons[block.id] }}</p>
        </section>
      }

      <section class="block">
        <header>
          <span class="name">Lore</span>
          <span class="tokens">{{ prompt().lore.length }} active</span>
        </header>
        @if (prompt().lore.length) {
          <ul class="lore">
            @for (hit of prompt().lore; track hit.entry.id) {
              <li>
                <strong>{{ hit.entry.title || 'Untitled entry' }}</strong>
                @if (hit.key) {
                  fired on “{{ hit.key }}” in the {{ hit.where }}
                } @else {
                  is always on
                }
              </li>
            }
          </ul>
        } @else {
          <p class="li-hint empty">
            Nothing matched the scene, the last messages or what you are typing.
          </p>
        }
        @if (unwritten()) {
          <p class="li-hint empty warn">
            {{ unwritten() }}
            {{ unwritten() === 1 ? 'entry has' : 'entries have' }} no text yet, so
            {{ unwritten() === 1 ? 'it' : 'they' }} cannot fire. Write them in World.
          </p>
        }
      </section>

      <section class="block">
        <header>
          <span class="name">This chapter</span>
          <span class="tokens">{{ format(prompt().tokens.history) }}</span>
        </header>
        <p class="li-hint empty">
          {{ sent() }} messages sent
          @if (prompt().dropped) {
            · {{ prompt().dropped }} older left out to fit the budget
          }
        </p>

        <!-- Not blocks: these sit between the turns, at the point in the
             chapter where the cast changed. -->
        @if (prompt().castNotes.length) {
          <ul class="notes">
            @for (note of prompt().castNotes; track $index) {
              <li>{{ note }}</li>
            }
          </ul>
        }
      </section>

      @if (nextMessage()) {
        <section class="block">
          <header>
            <span class="name">Your next message</span>
            <span class="tokens">{{ format(prompt().tokens.draft) }}</span>
          </header>
          <!-- As it will go out, direction and all, rather than as it is typed:
               the point of the sheet is that nothing about the request is a
               surprise. -->
          <pre>{{ nextMessage() }}</pre>
        </section>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      @if (!isDefault()) {
        <button matButton class="reset" (click)="resetOrder()">Reset the order</button>
      }
      <button matButton (click)="copy()">Copy it all</button>
      <button matButton="filled" mat-dialog-close>Done</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content {
      max-height: var(--li-sheet-height);
    }

    .block {
      margin: var(--li-space-sm) 0 0;
      border: 1px solid var(--li-border);
      border-radius: var(--li-radius-md);
      background: var(--li-surface-raised);
      overflow: hidden;
    }

    header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--li-space-lg);
      padding: var(--li-space-xs) var(--li-space-md);
      border-bottom: 1px solid var(--li-border);
      background: color-mix(in srgb, var(--li-accent) 6%, transparent);
    }

    .name {
      font-size: var(--li-text-sm);
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: var(--li-ink-soft);
    }

    .tokens {
      font-size: var(--li-text-xs);
      color: var(--li-muted);
    }

    .notes {
      margin: 0;
      padding: 0 var(--li-space-md) var(--li-space-md) var(--li-space-xl);
      font-family: var(--li-serif);
      font-size: var(--li-text-md);
      line-height: 1.5;
      color: var(--li-ink-soft);
    }

    pre {
      margin: 0;
      padding: var(--li-space-md);
      white-space: pre-wrap;
      overflow-wrap: break-word;
      font-family: var(--li-serif);
      font-size: var(--li-text-md);
      line-height: 1.55;
      color: var(--li-ink);
    }

    .lore {
      margin: 0;
      padding: var(--li-space-sm) var(--li-space-md) var(--li-space-sm) var(--li-space-xl);
      font-size: var(--li-text-md);
      line-height: 1.6;
      color: var(--li-ink-soft);
    }

    .empty {
      margin: 0;
      padding: var(--li-space-sm) var(--li-space-md);
    }

    .warn {
      color: var(--li-danger);
    }

    /* -- reordering ------------------------------------------------------- */

    .handle {
      flex: none;
      margin: calc(-1 * var(--li-space-3xs)) 0 calc(-1 * var(--li-space-3xs))
        calc(-1 * var(--li-space-3xs));
      padding: 0 var(--li-space-3xs);
      border: 0;
      background: none;
      color: var(--li-muted);
      font-size: var(--li-text-lg);
      line-height: 1;
      cursor: grab;
    }

    .handle:hover,
    .handle:focus-visible {
      color: var(--li-accent);
    }

    /* Where a handle would be on a block that has none, so the labels of the
       pinned blocks and the movable ones still start on the same line. */
    .pin {
      flex: none;
      width: 1.25rem;
      color: color-mix(in srgb, var(--li-muted) 55%, transparent);
      font-size: var(--li-text-lg);
      line-height: 1;
      text-align: center;
    }

    header .name {
      flex: 1;
    }

    .why {
      margin: 0;
      padding: var(--li-space-xs) var(--li-space-md) var(--li-space-sm);
      border-top: 1px dashed color-mix(in srgb, var(--li-border) 80%, transparent);
      font-size: var(--li-text-xs);
      line-height: 1.5;
      color: var(--li-muted);
    }

    .movable header {
      background: color-mix(in srgb, var(--li-accent) 12%, transparent);
    }

    /* The dragged copy is a clone of the element, so it carries this
       component's own attribute with it and these rules still reach it. */
    .block.cdk-drag-preview {
      border-radius: var(--li-radius-md);
      box-shadow: var(--li-shadow-raised);
      overflow: hidden;
    }

    .block.cdk-drag-placeholder {
      opacity: 0;
    }

    /* The gap the block will land in, so a drag has somewhere to aim. */
    .ghost {
      height: 100%;
      border: 1px dashed color-mix(in srgb, var(--li-accent) 55%, transparent);
      border-radius: var(--li-radius-md);
      background: color-mix(in srgb, var(--li-accent) 5%, transparent);
    }

    .cdk-drop-list-dragging .block:not(.cdk-drag-placeholder) {
      transition: transform 180ms cubic-bezier(0, 0, 0.2, 1);
    }

    .reset {
      margin-right: auto;
      color: var(--li-accent);
    }
  `,
})
export class PromptPreviewDialog {
  protected readonly data = inject<PromptPreviewData>(MAT_DIALOG_DATA);
  private readonly chapters = inject(ChapterStore);
  private readonly stories = inject(StoryStore);

  protected readonly prompt = computed(() =>
    this.chapters.preview(this.data.draft, this.data.direction),
  );

  protected readonly reasons = PIN_REASONS;

  // The builder has already put the blocks in this story's order, so filtering
  // keeps it — and each of the three groups needs different chrome around it.
  protected readonly leading = computed(() =>
    this.prompt().blocks.filter((b) => PINNED_FIRST.includes(b.id)),
  );
  protected readonly movable = computed(() =>
    this.prompt().blocks.filter((b) => MOVABLE_BLOCKS.includes(b.id)),
  );
  protected readonly trailing = computed(() =>
    this.prompt().blocks.filter((b) => PINNED_LAST.includes(b.id)),
  );

  protected readonly isDefault = computed(() => isDefaultOrder(this.stories.story()));

  /** An entry with nothing written in it can never join a prompt: say so. */
  protected readonly unwritten = computed(
    () => this.stories.story().world.entries.filter((e) => e.enabled && !e.content.trim()).length,
  );

  protected readonly nextMessage = computed(() =>
    withDirection(this.data.draft, this.data.direction),
  );

  protected readonly sent = computed(
    () =>
      this.prompt().messages.filter((m) => m.role !== 'system').length -
      (this.nextMessage() ? 1 : 0),
  );

  protected readonly totals = computed(() => {
    const { total, budget, reserve } = this.prompt().tokens;
    return `${formatTokens(total)} of ${formatTokens(budget)} tokens, with ${formatTokens(reserve)} held back for the reply.`;
  });

  protected handleLabel(label: string): string {
    return `Move the ${label} block. Drag it, or use the arrow keys.`;
  }

  protected drop(event: CdkDragDrop<unknown>): void {
    const shown = this.movable().map((b) => b.id);
    moveItemInArray(shown, event.previousIndex, event.currentIndex);
    this.writeOrder(shown);
  }

  /** The same move, for anyone not using a mouse. */
  protected onHandleKey(event: KeyboardEvent, id: BlockId): void {
    const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!step) return;
    event.preventDefault();

    const shown = this.movable().map((b) => b.id);
    const from = shown.indexOf(id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= shown.length) return;
    moveItemInArray(shown, from, to);
    this.writeOrder(shown);
  }

  /**
   * A block with nothing in it is not drawn, so the order on screen is only
   * part of the story's own. The blocks that were shown are written back into
   * the slots they occupied, which leaves the invisible ones exactly where they
   * were — an empty persona should not jump about because the world moved.
   */
  private writeOrder(shown: BlockId[]): void {
    const order = movableOrder(this.stories.story());
    const slots = order.map((id, i) => [id, i] as const).filter(([id]) => shown.includes(id));
    const next = [...order];
    slots.forEach(([, slot], i) => {
      const id = shown[i];
      if (id) next[slot] = id;
    });
    this.stories.setPromptOrder(next);
  }

  protected resetOrder(): void {
    this.stories.resetPromptOrder();
  }

  protected format(tokens: number): string {
    return `${formatTokens(tokens)} tokens`;
  }

  protected async copy(): Promise<void> {
    const text = this.prompt()
      .messages.map((m) => `[${m.role}]\n${m.content}`)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard blocked; nothing useful to say about it */
    }
  }
}
