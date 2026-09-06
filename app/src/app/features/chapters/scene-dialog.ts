import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ChapterStore } from '../../store/chapter-store';
import { StoryStore } from '../../store/story-store';
import { TOKEN_ESTIMATOR, formatTokens } from '../../core/tokens';
import { countWords } from '../../shared/editor-field';
import { firstLine } from '../../core/prompt-builder';
import { buildPalettePrompt, paletteLabel } from '../../core/page-palettes';
import { TextValue } from '../../shared/text-value';

export interface SceneDialogData {
  chapterId: string;
  /** True when this sheet is what stands between the chapter and its first line. */
  opening: boolean;
}

/**
 * The scene sheet: one field, not a form.
 *
 * A scene heading in a playscript is free text, the model reads prose
 * perfectly well, and any schema imposed here would be a schema someone has to
 * fight. So: one large field, and the only validation is that it is not empty.
 */
@Component({
  selector: 'li-scene-dialog',
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, TextValue],
  template: `
    <h2 mat-dialog-title>Chapter {{ chapter().number }} — the scene</h2>

    <mat-dialog-content>
      <p class="li-hint lead">
        Where are we, when, who is on stage, what is happening as the lights come up. A word or
        three pages, whatever the chapter needs — it goes to the model exactly as written.
      </p>

      <textarea
        class="scene"
        cdkFocusInitial
        style="--rows-min: 8; --rows-max: 22"
        [liText]="scene()"
        (input)="scene.set(text($event))"
        placeholder="A lighthouse gallery. Dusk, the first night of autumn. Mara is alone, and the lamp is already lit."
      ></textarea>

      <mat-form-field appearance="outline">
        <mat-label>Chapter title (optional)</mat-label>
        <input
          matInput
          [value]="title()"
          (input)="title.set(text($event))"
          [placeholder]="fallbackTitle()"
        />
        <mat-hint>Left blank, the chapter goes by the scene's first line.</mat-hint>
      </mat-form-field>
    </mat-dialog-content>

    <mat-dialog-actions>
      <span class="cost li-hint">
        {{ words() }} words · {{ cost() }} tokens every request
        @if (pageCost()) {
          · {{ pageCost() }}
        }
      </span>
      <button matButton [mat-dialog-close]="false">{{ data.opening ? 'Not yet' : 'Close' }}</button>
      <button matButton="filled" [disabled]="!valid()" (click)="confirm()">
        {{ data.opening ? 'Open the chapter' : 'Save the scene' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content {
      display: flex;
      flex-direction: column;
      gap: var(--li-space-sm);
    }

    .lead {
      margin: 0 0 var(--li-space-2xs);
    }

    /* Prose, written at reading size, because that is what it is. */
    .scene {
      font-family: var(--li-serif);
      font-size: var(--li-text-lg);
      line-height: 1.65;
    }

    mat-form-field {
      width: 100%;
    }

    .cost {
      margin-right: auto;
      padding-left: var(--li-space-sm);
    }
  `,
})
export class SceneDialog {
  protected readonly data = inject<SceneDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<SceneDialog, boolean>);
  private readonly chapters = inject(ChapterStore);
  private readonly stories = inject(StoryStore);
  private readonly estimator = inject(TOKEN_ESTIMATOR);

  protected readonly chapter = computed(
    () =>
      this.chapters.chapters().find((c) => c.id === this.data.chapterId) ?? this.chapters.chapter(),
  );

  protected readonly scene = signal(this.chapter().scene);
  protected readonly title = signal(this.chapter().title);

  protected readonly valid = computed(() => !!this.scene().trim());
  protected readonly words = computed(() => countWords(this.scene()));
  protected readonly fallbackTitle = computed(() => firstLine(this.scene(), 40) || 'Untitled');

  /** What the scene block will cost in every request of this chapter. */
  protected readonly cost = computed(() =>
    formatTokens(this.estimator.count(`Chapter 0, ${this.title()}. The scene:\n${this.scene()}`)),
  );

  /**
   * The other request this sheet makes, when the story lets the model choose
   * the page from the scene: what it cost last time, or what it is about to
   * cost. It is asked once per scene rather than once per turn, which is why it
   * is said in the same breath as the number that *is* once per turn.
   */
  protected readonly pageCost = computed(() => {
    if (!this.stories.story().autoTheme) return '';
    const chapter = this.chapter();
    // The recorded cost belongs to the scene it read. Edit a word and it is an
    // estimate again, because the request is going to be made again.
    if (chapter.paletteTokens && chapter.scene.trim() === this.scene().trim()) {
      return `${paletteLabel(chapter.palette)} cost ${formatTokens(chapter.paletteTokens)}`;
    }
    const asking = this.estimator.countMessages(buildPalettePrompt(this.scene()));
    return `about ${formatTokens(asking)} to choose the page`;
  });

  /** The scene as the sheet was opened on it, for the question below. */
  private readonly openedOn = this.chapter().scene;

  constructor() {
    // Escape and backdrop save a draft; they just do not open the chapter.
    inject(DestroyRef).onDestroy(() => this.commit());
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  /**
   * Confirming is the moment the scene exists to be read, so it is where the
   * story asks the model which page to read the chapter on — when it is a
   * story that asks at all, and when the scene is not the one already asked
   * about. Written first, so what is asked about is what was written.
   *
   * Nothing waits for the answer: the page changes under the chapter a second
   * later, or it does not change at all.
   */
  protected confirm(): void {
    if (!this.valid()) return;
    this.commit();
    void this.chapters.choosePalette(this.chapter().id, this.openedOn);
    this.ref.close(true);
  }

  private commit(): void {
    const chapter = this.chapter();
    const scene = this.scene();
    const title = this.title().trim();
    if (chapter.scene === scene && chapter.title === title) return;
    this.chapters.update(chapter.id, { scene, title });
  }
}
