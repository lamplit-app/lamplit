import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { StoryMode } from '../../core/models';
import { Field } from '../../shared/field';
import { TextValue } from '../../shared/text-value';

export interface StorySetup {
  title: string;
  mode: StoryMode;
  persona: { name: string; description: string };
}

export interface NewStoryData extends StorySetup {
  /** First run seeds this sheet from the story the app made on its own. */
  heading: string;
  confirm: string;
}

/**
 * The three things worth deciding before the first scene: what the story is
 * called, who is telling it, and who the reader plays. They shape every
 * request, so they come first — and every one of them can be changed later in
 * Story, which is why nothing here is required.
 */
@Component({
  selector: 'li-new-story-dialog',
  imports: [MatButtonModule, MatDialogModule, Field, TextValue],
  template: `
    <h2 mat-dialog-title>{{ data.heading }}</h2>

    <mat-dialog-content>
      <li-field label="Title">
        <input
          type="text"
          cdkFocusInitial
          [value]="title()"
          (input)="title.set(text($event))"
          placeholder="Untitled story"
        />
      </li-field>

      <span class="li-label group">Who tells it</span>
      <div class="li-choices">
        <button
          type="button"
          class="li-choice"
          [class.on]="mode() === 'narrator'"
          (click)="mode.set('narrator')"
        >
          <span class="name">Narrator</span>
          <span class="li-hint">
            One voice tells the whole story. You say what you do; it writes what happens.
          </span>
        </button>
        <button
          type="button"
          class="li-choice"
          [class.on]="mode() === 'roleplay'"
          (click)="mode.set('roleplay')"
        >
          <span class="name">Role-play</span>
          <span class="li-hint">
            The model plays the other characters and answers in their own words.
          </span>
        </button>
      </div>

      <span class="li-label group">Who you play</span>
      <li-field label="Name">
        <input type="text" [value]="name()" (input)="name.set(text($event))" placeholder="Mara" />
      </li-field>

      <li-field label="Description">
        <textarea
          class="li-rows-medium"
          [liText]="description()"
          (input)="description.set(text($event))"
          placeholder="A marine biologist, thirty-one, back on the island after nine years."
        ></textarea>
      </li-field>

      <p class="li-hint">
        All of it can be changed later in Story, and in Role-play you add the cast there too. Next
        comes the scene the first chapter opens on.
      </p>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton [mat-dialog-close]="undefined">Cancel</button>
      <button matButton="filled" (click)="confirm()">{{ data.confirm }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content {
      display: flex;
      flex-direction: column;
      gap: var(--li-space-md);
    }

    /* Naming the pair below it rather than a box, so it is set as the app sets
       the name of a block — otherwise it is the same word in the same size as
       the field labels under it and says nothing about what it covers. */
    .group {
      margin-top: var(--li-space-2xs);
      /* Standing to what it names as close as a field label stands to its box,
         which is a step tighter than the sheet's own gap. */
      margin-bottom: calc(var(--li-space-xs) - var(--li-space-md));
      color: var(--li-muted);
    }
  `,
})
export class NewStoryDialog {
  protected readonly data = inject<NewStoryData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<NewStoryDialog, StorySetup | undefined>);

  protected readonly title = signal(this.data.title);
  protected readonly mode = signal<StoryMode>(this.data.mode);
  protected readonly name = signal(this.data.persona.name);
  protected readonly description = signal(this.data.persona.description);

  protected text(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  /** Cancel and Escape both mean "not this way": nothing is created, or kept. */
  protected confirm(): void {
    this.ref.close({
      title: this.title().trim(),
      mode: this.mode(),
      persona: { name: this.name().trim(), description: this.description().trim() },
    });
  }
}
