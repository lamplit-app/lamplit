import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { Chapter } from '../../core/models';
import { chapterTitle, firstLine } from '../../core/prompt-builder';
import { ChapterStore } from '../../store/chapter-store';
import { StoryStore } from '../../store/story-store';
import { DialogsService } from '../../shared/dialogs.service';
import { countWords } from '../../shared/editor-field';

interface Row {
  chapter: Chapter;
  title: string;
  opening: string;
  messages: number;
  words: number;
  active: boolean;
}

/** The table of contents. One row per chapter, in the order they were written. */
@Component({
  selector: 'li-chapters-dialog',
  imports: [MatButtonModule, MatDialogModule, MatMenuModule],
  template: `
    <h2 mat-dialog-title>{{ stories.story().title }}</h2>

    <mat-dialog-content>
      @for (row of rows(); track row.chapter.id) {
        <article class="row" [class.active]="row.active">
          <button class="open" type="button" (click)="open(row)">
            <span class="line">
              <span class="number">{{ row.chapter.number }}</span>
              <span class="title li-title li-one-line">{{ row.title || 'Untitled chapter' }}</span>
              <span class="state li-chip" [class.closed]="row.chapter.status === 'closed'">
                {{ row.chapter.status }}
              </span>
            </span>
            @if (row.opening !== row.title) {
              <span class="opening li-one-line">{{ row.opening || 'No scene yet' }}</span>
            }
            <span class="counts li-one-line">
              {{ row.messages }} {{ row.messages === 1 ? 'message' : 'messages' }} ·
              {{ row.words }} words
            </span>
          </button>

          <button matIconButton [matMenuTriggerFor]="menu" aria-label="Chapter actions">⋯</button>
          <mat-menu #menu="matMenu">
            <button mat-menu-item (click)="editScene(row)">Edit scene</button>
            <button mat-menu-item (click)="rename(row)">Rename</button>
            @if (row.chapter.status === 'closed') {
              <button mat-menu-item (click)="continue(row)">Continue this chapter</button>
            }
            <button mat-menu-item (click)="remove(row)">Delete</button>
          </mat-menu>
        </article>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close>Done</button>
      <button matButton="filled" (click)="newChapter()">New chapter</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content {
      max-height: var(--li-sheet-height);
    }

    .row {
      display: flex;
      align-items: center;
      gap: var(--li-space-2xs);
      border-bottom: 1px solid color-mix(in srgb, var(--li-border) 60%, transparent);
    }

    .row.active {
      background: color-mix(in srgb, var(--li-accent) 8%, transparent);
    }

    .open {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: var(--li-space-3xs);
      padding: var(--li-space-md) var(--li-space-sm);
      border: 0;
      border-radius: var(--li-radius-md);
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .open:hover {
      background: color-mix(in srgb, var(--li-ink) 5%, transparent);
    }

    .line {
      display: flex;
      align-items: baseline;
      gap: var(--li-space-sm);
      min-width: 0;
    }

    .number {
      flex: none;
      width: 1.4rem;
      font-family: var(--li-serif);
      font-size: var(--li-text-lg);
      color: var(--li-muted);
    }

    .title {
      flex: 1;
    }

    .state {
      flex: none;
      color: var(--li-accent);
    }

    .state.closed {
      color: var(--li-muted);
    }

    /* Indented past the chapter number above, so the two lines under a title
       start where the title does rather than at a number of their own. The
       number's width and the row's gap, added up. */
    .opening,
    .counts {
      padding-left: calc(1.4rem + var(--li-space-sm));
      color: var(--li-muted);
    }

    .opening {
      font-family: var(--li-serif);
      font-size: var(--li-text-md);
    }

    .counts {
      font-size: var(--li-text-xs);
    }
  `,
})
export class ChaptersDialog {
  protected readonly chapters = inject(ChapterStore);
  protected readonly stories = inject(StoryStore);
  private readonly dialogs = inject(DialogsService);
  private readonly ref = inject(MatDialogRef<ChaptersDialog>);

  protected readonly rows = computed<Row[]>(() => {
    const active = this.chapters.chapter().id;
    return this.chapters.chapters().map((chapter) => {
      // The records of the cast changing are in the list but are not of it:
      // a chapter's size is what was written in it.
      const written = chapter.messages.filter((m) => m.kind !== 'cast');
      return {
        chapter,
        title: chapterTitle(chapter),
        opening: firstLine(chapter.scene),
        messages: written.length,
        words: written.reduce((total, m) => total + countWords(m.content), 0),
        active: chapter.id === active,
      };
    });
  });

  protected open(row: Row): void {
    this.chapters.open(row.chapter.id);
    this.ref.close();
  }

  protected async editScene(row: Row): Promise<void> {
    await this.dialogs.openScene(row.chapter.id);
  }

  protected async rename(row: Row): Promise<void> {
    const title = await this.dialogs.askText({
      title: `Chapter ${row.chapter.number}`,
      label: 'Chapter title',
      value: row.chapter.title,
    });
    if (title !== undefined) this.chapters.update(row.chapter.id, { title });
  }

  protected continue(row: Row): void {
    this.chapters.continueChapter(row.chapter.id);
    this.ref.close();
  }

  protected async remove(row: Row): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: `Delete chapter ${row.chapter.number}?`,
      message: `“${row.title || 'Untitled chapter'}” and its ${row.messages} messages go for good. Chapter numbers are not reused, so the ones after it keep their own.`,
      danger: true,
    });
    if (ok) this.chapters.deleteChapter(row.chapter.id);
  }

  protected async newChapter(): Promise<void> {
    this.ref.close();
    await this.dialogs.newChapter();
  }
}
