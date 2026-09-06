import { Component, ElementRef, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { DEFAULT_NARRATOR_PROMPT } from '../../core/defaults';
import { ReplyLength, RoleplayCasting, StoryMode } from '../../core/models';
import { StoryStore } from '../../store/story-store';
import { CharacterSwatch } from '../../shared/character-swatch';
import { EditorField } from '../../shared/editor-field';

export interface StoryDialogData {
  /** Opened from a cast row in the chapter panel: scroll to it and focus it. */
  characterId?: string;
}

/** Who is telling the story, who the reader is, and how it should read. */
@Component({
  selector: 'li-story-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
    MatTabsModule,
    CharacterSwatch,
    EditorField,
  ],
  template: `
    <h2 mat-dialog-title>{{ story().title }}</h2>

    <mat-dialog-content>
      <mat-tab-group>
        <mat-tab label="Mode">
          <div class="tab">
            <div class="li-choices">
              <button
                type="button"
                class="li-choice"
                [class.on]="story().mode === 'narrator'"
                (click)="setMode('narrator')"
              >
                <span class="name">Narrator</span>
                <span class="li-hint">
                  One voice tells the whole story. You say what you do; it writes what happens.
                </span>
              </button>
              <button
                type="button"
                class="li-choice"
                [class.on]="story().mode === 'roleplay'"
                (click)="setMode('roleplay')"
              >
                <span class="name">Role-play</span>
                <span class="li-hint">
                  The model plays the other characters and answers in their own words.
                </span>
              </button>
            </div>

            @if (story().mode === 'narrator') {
              <mat-slide-toggle
                [checked]="!story().narrator.useDefault"
                (change)="setOverride($event.checked)"
              >
                Write my own narrator instructions
              </mat-slide-toggle>

              @if (story().narrator.useDefault) {
                <p class="preset">{{ defaultPrompt }}</p>
              } @else {
                <li-editor-field
                  label="Narrator instructions"
                  [rows]="7"
                  [value]="story().narrator.prompt"
                  (save)="setNarratorPrompt($event)"
                />
              }
            } @else {
              <div class="cast">
                <div class="li-choices casting">
                  <button
                    type="button"
                    class="li-choice"
                    [class.on]="story().roleplay.casting === 'ensemble'"
                    (click)="setCasting('ensemble')"
                  >
                    <span class="name">Ensemble</span>
                    <span class="li-hint">
                      The model plays everyone in the scene and answers as whoever the moment calls
                      for.
                    </span>
                  </button>
                  <button
                    type="button"
                    class="li-choice"
                    [class.on]="story().roleplay.casting === 'one-at-a-time'"
                    (click)="setCasting('one-at-a-time')"
                  >
                    <span class="name">One at a time</span>
                    <span class="li-hint">
                      It plays one of them. The rest are in the scene without a voice; switch in the
                      chapter panel.
                    </span>
                  </button>
                </div>

                @for (character of story().characters; track character.id) {
                  <section class="character" [attr.data-character]="character.id">
                    <header>
                      <li-character-swatch
                        [character]="character"
                        (pick)="stories.setCharacterColour(character.id, $event)"
                      />
                      <mat-form-field appearance="outline" class="name-field">
                        <mat-label>Name</mat-label>
                        <input
                          matInput
                          [value]="character.name"
                          (change)="stories.patchCharacter(character.id, { name: value($event) })"
                        />
                      </mat-form-field>
                      <mat-slide-toggle
                        [checked]="character.enabled"
                        (change)="stories.patchCharacter(character.id, { enabled: $event.checked })"
                      >
                        In the story
                      </mat-slide-toggle>
                      <button matButton (click)="stories.removeCharacter(character.id)">
                        Remove
                      </button>
                    </header>
                    <li-editor-field
                      label="Who they are"
                      [rows]="2"
                      [value]="character.description"
                      placeholder="How they speak, what they want, what they will not do."
                      (save)="stories.patchCharacter(character.id, { description: $event })"
                    />
                  </section>
                }
                @if (!story().characters.length) {
                  <p class="li-hint">
                    No characters yet. Without them the model plays whoever the scene needs.
                  </p>
                }
                <button matButton="outlined" (click)="stories.addCharacter()">
                  Add a character
                </button>
              </div>
            }
          </div>
        </mat-tab>

        <mat-tab label="Persona">
          <div class="tab">
            <p class="li-hint">Who the reader is in this story. Always sent, in both modes.</p>
            <mat-form-field appearance="outline">
              <mat-label>Name</mat-label>
              <input
                matInput
                [value]="story().persona.name"
                (change)="setPersona({ name: value($event) })"
              />
            </mat-form-field>
            <li-editor-field
              label="Description"
              [rows]="2"
              [value]="story().persona.description"
              placeholder="Mara, a marine biologist, thirty-one, back on the island after nine years."
              (save)="setPersona({ description: $event })"
            />
          </div>
        </mat-tab>

        <mat-tab label="Style">
          <div class="tab">
            <mat-slide-toggle
              [checked]="story().style.dialogueOnOwnLine"
              (change)="setStyle({ dialogueOnOwnLine: $event.checked })"
            >
              Ask for each spoken line on its own paragraph
            </mat-slide-toggle>

            <div class="lengths">
              <span class="li-hint">Reply length</span>
              @for (option of lengths; track option.value) {
                <button
                  type="button"
                  class="length"
                  [class.on]="story().style.replyLength === option.value"
                  (click)="setStyle({ replyLength: option.value })"
                >
                  {{ option.label }}
                </button>
              }
            </div>

            <p class="li-hint">
              Both become a sentence in the style rules the model is sent. The reading settings
              under Preferences only change how answers are drawn here.
            </p>

            <hr />

            <mat-slide-toggle
              [checked]="story().autoTheme"
              (change)="stories.patch({ autoTheme: $event.checked })"
            >
              Let the model choose the page colours from each chapter's scene
            </mat-slide-toggle>
            <p class="li-hint">
              Opening a chapter sends its scene, and a list of ten palettes with what each one is
              for, and asks which fits. The answer is one word; the chapter is read on that page
              from then on, and switching chapters switches pages. It is a small request of its own,
              made once per scene and never during a turn, and its cost is in the scene sheet's
              footer. Off, nothing is asked and nothing changes. Whatever it picks, the palette row
              in <strong>Preferences → Colours</strong> is where you overrule it.
            </p>
          </div>
        </mat-tab>
      </mat-tab-group>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton="filled" mat-dialog-close>Done</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content {
      max-height: var(--li-sheet-height);
    }

    .tab {
      display: flex;
      flex-direction: column;
      gap: var(--li-space-md);
      padding: var(--li-space-lg) var(--li-space-3xs) var(--li-space-xs);
    }

    .tab > * {
      flex: none;
    }

    .tab hr {
      width: 100%;
      border: 0;
      border-top: 1px solid var(--li-border);
      margin: var(--li-space-2xs) 0;
    }

    .preset {
      margin: 0;
      padding: var(--li-space-md);
      border: 1px dashed var(--li-border);
      border-radius: var(--li-radius-md);
      font-family: var(--li-serif);
      font-size: var(--li-text-md);
      line-height: 1.6;
      color: var(--li-ink-soft);
    }

    .cast {
      display: flex;
      flex-direction: column;
      gap: var(--li-space-md);
    }

    /* Nested inside the mode choice above it, so it is drawn a size down: the
       question it asks only exists because of the answer to that one. */
    .casting .li-choice {
      padding: var(--li-space-sm) var(--li-space-md);
    }

    .casting .name {
      font-size: var(--li-text-lg);
    }

    .character {
      display: flex;
      flex-direction: column;
      gap: var(--li-space-xs);
      padding: var(--li-space-md);
      border: 1px solid var(--li-border);
      border-radius: var(--li-radius-lg);
    }

    .character header {
      display: flex;
      align-items: center;
      gap: var(--li-space-md);
    }

    .name-field {
      flex: 1;
      margin-bottom: -1.25em;
    }

    mat-form-field {
      width: 100%;
    }

    .lengths {
      display: flex;
      align-items: center;
      gap: var(--li-space-xs);
    }

    .lengths .li-hint {
      margin-right: var(--li-space-xs);
    }

    .length {
      padding: var(--li-space-2xs) var(--li-space-md);
      border: 1px solid var(--li-border);
      border-radius: var(--li-radius-pill);
      background: var(--li-surface-raised);
      color: var(--li-ink-soft);
      font: inherit;
      font-size: var(--li-text-sm);
      cursor: pointer;
    }

    .length.on {
      border-color: color-mix(in srgb, var(--li-accent) 70%, var(--li-border));
      background: color-mix(in srgb, var(--li-accent) 12%, transparent);
      color: var(--li-ink);
    }
  `,
})
export class StoryDialog {
  protected readonly stories = inject(StoryStore);
  protected readonly story = this.stories.story;
  protected readonly defaultPrompt = DEFAULT_NARRATOR_PROMPT;

  protected readonly lengths: { value: ReplyLength; label: string }[] = [
    { value: 'short', label: 'Short' },
    { value: 'medium', label: 'Medium' },
    { value: 'long', label: 'Long' },
  ];

  protected readonly persona = computed(() => this.story().persona);

  constructor() {
    const wanted = inject<StoryDialogData | null>(MAT_DIALOG_DATA, { optional: true })?.characterId;
    if (!wanted) return;
    // After the sheet has opened, not before: Material takes the focus itself
    // once the opening animation is done, and anything focused ahead of that
    // is focused and then let go of again.
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    inject(MatDialogRef)
      .afterOpened()
      .subscribe(() => {
        const row = host.nativeElement.querySelector<HTMLElement>(`[data-character="${wanted}"]`);
        row?.scrollIntoView({ block: 'center' });
        row?.querySelector('input')?.focus();
      });
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected setMode(mode: StoryMode): void {
    this.stories.patch({ mode });
  }

  protected setCasting(casting: RoleplayCasting): void {
    this.stories.patchRoleplay({ casting });
  }

  protected setOverride(override: boolean): void {
    const narrator = this.story().narrator;
    this.stories.patch({
      narrator: {
        useDefault: !override,
        // Starting from the default beats starting from an empty box.
        prompt: narrator.prompt || (override ? DEFAULT_NARRATOR_PROMPT : ''),
      },
    });
  }

  protected setNarratorPrompt(prompt: string): void {
    this.stories.patch({ narrator: { ...this.story().narrator, prompt } });
  }

  protected setPersona(patch: Partial<{ name: string; description: string }>): void {
    this.stories.patch({ persona: { ...this.story().persona, ...patch } });
  }

  protected setStyle(
    patch: Partial<{ dialogueOnOwnLine: boolean; replyLength: ReplyLength }>,
  ): void {
    this.stories.patch({ style: { ...this.story().style, ...patch } });
  }
}
