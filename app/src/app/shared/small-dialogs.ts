import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

export interface TextPromptData {
  title: string;
  label: string;
  value?: string;
  confirm?: string;
}

/** One line of text, for naming a story or retitling a chapter. */
@Component({
  selector: 'li-text-prompt-dialog',
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline">
        <mat-label>{{ data.label }}</mat-label>
        <input
          matInput
          cdkFocusInitial
          [value]="draft()"
          (input)="draft.set(text($event))"
          (keydown.enter)="confirm()"
        />
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <!-- Bound rather than bare: a mat-dialog-close with no value closes with
           the empty string, which a caller asking "was this cancelled?" reads
           as an answer. Backing out of this one has to be nothing at all. -->
      <button matButton [mat-dialog-close]="undefined">Cancel</button>
      <button matButton="filled" (click)="confirm()">{{ data.confirm ?? 'Save' }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-form-field {
      width: 22rem;
      max-width: 100%;
    }
  `,
})
export class TextPromptDialog {
  protected readonly data = inject<TextPromptData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<TextPromptDialog, string | undefined>);

  protected readonly draft = signal(this.data.value ?? '');

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  /**
   * Save closes with what is in the box, empty or not: for a chapter, cleared
   * is a title given back to the scene's first line, which the scene sheet
   * offers in as many words. Cancel and Escape close with nothing, which is
   * what "undefined" is kept for — the two are different answers.
   */
  protected confirm(): void {
    this.ref.close(this.draft().trim());
  }
}

export interface ConfirmData {
  title: string;
  message: string;
  confirm?: string;
  danger?: boolean;
}

/** The one thing the app asks twice about: deleting something written. */
@Component({
  selector: 'li-confirm-dialog',
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <p>{{ data.message }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton [mat-dialog-close]="false" cdkFocusInitial>Cancel</button>
      <button matButton="filled" class="go" [class.danger]="data.danger" [mat-dialog-close]="true">
        {{ data.confirm ?? 'Delete' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    p {
      max-width: 26rem;
      margin: 0;
      font-size: var(--li-text-md);
      line-height: 1.6;
      color: var(--li-ink-soft);
    }

    .go.danger {
      --mat-button-filled-container-color: var(--li-danger);
      --mat-button-filled-label-text-color: light-dark(#fff, #1a0f0d);
    }
  `,
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmData>(MAT_DIALOG_DATA);
}
