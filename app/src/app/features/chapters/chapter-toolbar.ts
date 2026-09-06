import { Component, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ChapterStore } from '../../store/chapter-store';
import { DialogsService } from '../../shared/dialogs.service';
import { chapterTitle } from '../../core/prompt-builder';

/**
 * The chapter's own controls, sitting where a writer looks between paragraphs:
 * just above the composer, small enough to ignore until they are wanted.
 */
@Component({
  selector: 'li-chapter-toolbar',
  imports: [MatTooltipModule],
  template: `
    <div class="row">
      <span class="here" [matTooltip]="chapters.chapter().scene">{{ label() }}</span>

      <!-- Closed chapters are continued from the dock, which says so already. -->
      @if (!chapters.isClosed()) {
        <button
          class="li-pill"
          type="button"
          [disabled]="chapters.isEmpty() || chapters.isStreaming()"
          matTooltip="Summarise it into the story so far, keep it, and open the next one"
          (click)="dialogs.closeChapter()"
        >
          Close chapter
        </button>
      }

      <button class="li-pill" type="button" (click)="dialogs.openScene(chapters.chapter().id)">
        Edit scene
      </button>
    </div>
  `,
  styles: `
    .row {
      width: var(--li-column);
      margin: 0 auto;
      display: flex;
      align-items: center;
      gap: var(--li-space-xs);
      padding: 0 0 var(--li-space-3xs);
    }

    .here {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-family: var(--li-serif);
      font-size: var(--li-text-sm);
      color: var(--li-muted);
    }

    /* What the pill does not already know: that it is the fixed thing in a row
       with a title that gives way, and where it goes when hovered. */
    button.li-pill {
      flex: none;
    }

    button.li-pill:hover:not(:disabled) {
      color: var(--li-ink-soft);
      border-color: color-mix(in srgb, var(--li-accent) 45%, var(--li-border));
    }
  `,
})
export class ChapterToolbar {
  protected readonly chapters = inject(ChapterStore);
  protected readonly dialogs = inject(DialogsService);

  protected readonly label = computed(() => {
    const chapter = this.chapters.chapter();
    const title = chapterTitle(chapter);
    const state = chapter.status === 'closed' ? ' · closed' : '';
    return `Chapter ${chapter.number}${title ? ` — ${title}` : ''}${state}`;
  });
}
