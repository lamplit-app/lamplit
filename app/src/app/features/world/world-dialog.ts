import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTabsModule } from '@angular/material/tabs';
import { DEFAULT_SUMMARY_INSTRUCTION } from '../../core/defaults';
import { Chapter, LoreCategory, LoreEntry } from '../../core/models';
import { chapterTitle } from '../../core/prompt-builder';
import { ChapterStore } from '../../store/chapter-store';
import { StoryStore } from '../../store/story-store';
import { EditorField } from '../../shared/editor-field';

const CATEGORIES: { value: LoreCategory; label: string; plural: string }[] = [
  { value: 'fact', label: 'Fact', plural: 'Facts' },
  { value: 'person', label: 'Person', plural: 'People' },
  { value: 'place', label: 'Place', plural: 'Places' },
  { value: 'other', label: 'Other', plural: 'Other' },
];

interface Group {
  label: string;
  entries: LoreEntry[];
}

/** Everything the story knows: what has happened, and what is simply true. */
@Component({
  selector: 'li-world-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatMenuModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatExpansionModule,
    MatTabsModule,
    EditorField,
  ],
  template: `
    <h2 mat-dialog-title>The world of {{ story().title }}</h2>

    <mat-dialog-content>
      <mat-tab-group>
        <mat-tab label="Story so far">
          <div class="tab">
            <li-editor-field
              label="Always included in every request"
              hint="Closing a chapter rewrites this, folding the chapter into it. Edit it freely — this is the whole of what the model remembers before the chapter it is writing."
              [rows]="6"
              serif
              [value]="story().world.storySoFar"
              (save)="stories.setStorySoFar($event)"
            />

            <mat-expansion-panel class="instruction">
              <mat-expansion-panel-header>
                <mat-panel-title>How a chapter is folded in</mat-panel-title>
                <mat-panel-description>
                  {{ story().world.summary.useDefault ? 'default' : 'your own' }}
                </mat-panel-description>
              </mat-expansion-panel-header>

              <p class="li-hint">
                Closing a chapter sends the story so far, the chapter's scene and everything written
                in it, and then this instruction. What comes back replaces the text above, which is
                why it asks for the whole summary rather than an addition to it.
              </p>

              <mat-slide-toggle
                [checked]="!story().world.summary.useDefault"
                (change)="setSummaryOverride($event.checked)"
              >
                Write my own instruction
              </mat-slide-toggle>

              @if (story().world.summary.useDefault) {
                <p class="preset">{{ defaultSummaryInstruction }}</p>
              } @else {
                <li-editor-field
                  label="Instruction"
                  [rows]="6"
                  [value]="story().world.summary.prompt"
                  (save)="stories.setSummaryPrompt({ prompt: $event })"
                />
              }
            </mat-expansion-panel>

            <div class="li-setting">
              <mat-slide-toggle
                [checked]="story().world.extractLore"
                (change)="stories.setExtractLore($event.checked)"
              >
                When a chapter closes, propose lore entries from it
              </mat-slide-toggle>
              <p class="li-hint">
                A second request after the summary, asking what the chapter established that is
                worth keeping. Nothing is written without you ticking it. Off by default, because it
                is a second request and a second bill; the review sheet has a button for it either
                way.
              </p>
            </div>

            @if (folded().length) {
              <section class="folded">
                <h3 class="li-label">Folded in so far</h3>
                @for (chapter of folded(); track chapter.id) {
                  <p>
                    <span class="number">Chapter {{ chapter.number }}</span>
                    {{ title(chapter) }}
                  </p>
                }
              </section>
            }
          </div>
        </mat-tab>

        <mat-tab label="Lore">
          <div class="tab">
            <div class="lore-head">
              <mat-form-field appearance="outline" class="search">
                <mat-label>Search</mat-label>
                <input
                  matInput
                  [value]="filter()"
                  (input)="filter.set(value($event))"
                  placeholder="title or key"
                />
              </mat-form-field>
              <button matButton="outlined" [matMenuTriggerFor]="addMenu">Add an entry</button>
              <mat-menu #addMenu="matMenu">
                @for (category of categories; track category.value) {
                  <button mat-menu-item (click)="add(category.value)">
                    {{ category.label }}
                  </button>
                }
              </mat-menu>
            </div>

            @for (group of groups(); track group.label) {
              <h3 class="li-label">{{ group.label }}</h3>
              @for (entry of group.entries; track entry.id) {
                <section
                  class="entry"
                  [class.off]="!entry.enabled"
                  [class.unwritten]="!entry.content.trim()"
                  [class.open]="isOpen(entry.id)"
                >
                  <div class="summary">
                    <button
                      type="button"
                      class="disclose"
                      [attr.aria-expanded]="isOpen(entry.id)"
                      (click)="toggle(entry.id)"
                    >
                      <span class="caret" aria-hidden="true">{{
                        isOpen(entry.id) ? '▾' : '▸'
                      }}</span>
                      <span class="name">{{ entry.title.trim() || 'Untitled entry' }}</span>
                      <span class="keys">{{ summaryOf(entry) }}</span>
                      @if (!entry.enabled) {
                        <span class="tag li-chip">off</span>
                      }
                      @if (!entry.content.trim()) {
                        <span class="tag warn">needs text</span>
                      }
                    </button>
                    <button matIconButton [matMenuTriggerFor]="actions" aria-label="Entry actions">
                      ⋯
                    </button>
                    <mat-menu #actions="matMenu">
                      <button mat-menu-item (click)="open(entry.id)">Edit</button>
                      <button mat-menu-item (click)="duplicate(entry.id)">Duplicate</button>
                      <button mat-menu-item (click)="remove(entry)">Delete</button>
                    </mat-menu>
                  </div>

                  @if (isOpen(entry.id)) {
                    <header>
                      <mat-form-field appearance="outline" class="title-field">
                        <mat-label>Title</mat-label>
                        <input
                          matInput
                          [value]="entry.title"
                          (change)="stories.patchLore(entry.id, { title: value($event) })"
                        />
                      </mat-form-field>
                      <mat-form-field appearance="outline" class="category-field">
                        <mat-label>Kind</mat-label>
                        <mat-select
                          [value]="entry.category"
                          (valueChange)="stories.patchLore(entry.id, { category: $event })"
                        >
                          @for (category of categories; track category.value) {
                            <mat-option [value]="category.value">{{ category.label }}</mat-option>
                          }
                        </mat-select>
                      </mat-form-field>
                    </header>

                    <mat-form-field appearance="outline" subscriptSizing="dynamic">
                      <mat-label>Keys</mat-label>
                      <input
                        matInput
                        [value]="entry.keys.join(', ')"
                        [disabled]="entry.alwaysOn"
                        (change)="setKeys(entry, value($event))"
                        placeholder="tomas, keeper, old man"
                      />
                      <mat-hint>Comma separated. Any of them fires the entry.</mat-hint>
                    </mat-form-field>

                    <li-editor-field
                      label="What is true (required)"
                      [rows]="3"
                      placeholder="The lighthouse keeper, missing since spring."
                      [value]="entry.content"
                      (save)="stories.patchLore(entry.id, { content: $event })"
                    />

                    @if (!entry.content.trim()) {
                      <p class="unfinished">
                        An entry is the sentence it puts in the prompt, so this one has nothing to
                        say yet and will stay out of it. Write it, or delete the entry.
                      </p>
                    }

                    <div class="switches">
                      <mat-slide-toggle
                        [checked]="entry.enabled"
                        (change)="stories.patchLore(entry.id, { enabled: $event.checked })"
                      >
                        Enabled
                      </mat-slide-toggle>
                      <mat-slide-toggle
                        [checked]="entry.alwaysOn"
                        (change)="stories.patchLore(entry.id, { alwaysOn: $event.checked })"
                      >
                        Always on
                      </mat-slide-toggle>
                    </div>
                  }
                </section>
              }
            }

            @if (!groups().length) {
              <p class="li-hint">
                {{
                  story().world.entries.length
                    ? 'Nothing matches that search.'
                    : 'No lore yet. Add the handful of things the model keeps getting wrong.'
                }}
              </p>
            }

            <footer class="scan">
              <mat-form-field appearance="outline" class="depth">
                <mat-label>Scan depth</mat-label>
                <input
                  matInput
                  type="number"
                  min="0"
                  max="50"
                  [value]="story().world.scan.depth"
                  (change)="setDepth(value($event))"
                />
                <mat-hint>Recent messages searched, besides the scene and your draft.</mat-hint>
              </mat-form-field>
              <mat-slide-toggle
                [checked]="story().world.scan.caseSensitive"
                (change)="stories.patchScan({ caseSensitive: $event.checked })"
              >
                Case sensitive
              </mat-slide-toggle>
              <mat-slide-toggle
                [checked]="story().world.scan.matchWholeWords"
                (change)="stories.patchScan({ matchWholeWords: $event.checked })"
              >
                Whole words only
              </mat-slide-toggle>
            </footer>
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

    h3 {
      margin: var(--li-space-xs) 0 0;
      color: var(--li-muted);
    }

    .instruction {
      border: 1px solid var(--li-border);
      border-radius: var(--li-radius-lg);
    }

    mat-panel-description {
      flex: none;
      color: var(--li-muted);
      font-size: var(--li-text-sm);
    }

    .preset {
      margin: var(--li-space-sm) 0 0;
      padding: var(--li-space-md);
      border: 1px dashed var(--li-border);
      border-radius: var(--li-radius-md);
      font-family: var(--li-serif);
      font-size: var(--li-text-md);
      line-height: 1.6;
      color: var(--li-ink-soft);
    }

    .folded p {
      display: flex;
      gap: var(--li-space-sm);
      margin: var(--li-space-xs) 0 0;
      font-family: var(--li-serif);
      font-size: var(--li-text-md);
      color: var(--li-ink-soft);
    }

    .folded .number {
      flex: none;
      color: var(--li-muted);
    }

    .lore-head {
      display: flex;
      align-items: center;
      gap: var(--li-space-md);
    }

    .search {
      flex: 1;
      margin-bottom: -1.25em;
    }

    .entry {
      display: flex;
      flex-direction: column;
      gap: var(--li-space-xs);
      padding: var(--li-space-xs) var(--li-space-sm);
      border: 1px solid var(--li-border);
      border-radius: var(--li-radius-lg);
    }

    .entry.open {
      padding: var(--li-space-sm) var(--li-space-md) var(--li-space-md);
      background: color-mix(in srgb, var(--li-ink) 3%, transparent);
    }

    /* Collapsed, an entry is one line: what it is called, and what fires it. */
    .summary {
      display: flex;
      align-items: center;
      gap: var(--li-space-2xs);
    }

    .disclose {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: baseline;
      gap: var(--li-space-sm);
      padding: var(--li-space-xs);
      border: 0;
      border-radius: var(--li-radius-md);
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .disclose:hover {
      background: color-mix(in srgb, var(--li-ink) 5%, transparent);
    }

    .caret {
      flex: none;
      width: 0.9rem;
      color: var(--li-muted);
      font-size: var(--li-text-xs);
    }

    .disclose .name {
      flex: none;
      max-width: 16rem;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-family: var(--li-serif);
      font-size: var(--li-text-lg);
      color: var(--li-ink);
    }

    .keys {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-size: var(--li-text-xs);
      color: var(--li-muted);
    }

    .tag {
      flex: none;
      padding: var(--li-space-3xs) var(--li-space-sm);
      border: 1px solid var(--li-border);
      border-radius: var(--li-radius-pill);
      color: var(--li-muted);
    }

    .tag.warn {
      border-color: color-mix(in srgb, var(--li-danger) 45%, var(--li-border));
      color: var(--li-danger);
    }

    .entry.off {
      opacity: 0.6;
    }

    /* Required, and said out loud: an entry with no text can never fire. */
    .entry.unwritten {
      border-style: dashed;
      border-color: color-mix(in srgb, var(--li-danger) 45%, var(--li-border));
    }

    .unfinished {
      margin: 0;
      font-size: var(--li-text-sm);
      line-height: 1.5;
      color: var(--li-danger);
    }

    .entry header {
      display: flex;
      align-items: center;
      gap: var(--li-space-sm);
    }

    .title-field {
      flex: 1;
      margin-bottom: -1.25em;
    }

    .category-field {
      width: 9rem;
      margin-bottom: -1.25em;
    }

    mat-form-field {
      width: 100%;
    }

    .switches {
      display: flex;
      gap: var(--li-space-lg);
      padding-top: var(--li-space-2xs);
    }

    .scan {
      display: flex;
      align-items: flex-start;
      gap: var(--li-space-lg);
      margin-top: var(--li-space-sm);
      padding-top: var(--li-space-md);
      border-top: 1px solid var(--li-border);
    }

    .depth {
      width: 12rem;
    }
  `,
})
export class WorldDialog {
  protected readonly stories = inject(StoryStore);
  private readonly chapters = inject(ChapterStore);

  protected readonly story = this.stories.story;
  protected readonly categories = CATEGORIES;
  protected readonly defaultSummaryInstruction = DEFAULT_SUMMARY_INSTRUCTION;
  protected readonly filter = signal('');

  /**
   * Which entries are open for editing. A world can hold dozens, and all of
   * them open at once is unreadable, so they start collapsed — except the one
   * just added, which is open because it still has to be written.
   */
  private readonly expanded = signal<ReadonlySet<string>>(new Set());

  /** Which chapters are already in the story so far, newest first. */
  protected readonly folded = computed(() =>
    this.chapters
      .chapters()
      .filter((chapter) => chapter.status === 'closed' && chapter.summary.trim())
      .sort((a, b) => b.number - a.number),
  );

  protected readonly groups = computed<Group[]>(() => {
    const needle = this.filter().trim().toLowerCase();
    const entries = this.story().world.entries.filter(
      (entry) =>
        !needle ||
        entry.title.toLowerCase().includes(needle) ||
        entry.keys.some((key) => key.toLowerCase().includes(needle)),
    );
    return CATEGORIES.map((category) => ({
      label: category.plural,
      entries: entries.filter((entry) => entry.category === category.value),
    })).filter((group) => group.entries.length);
  });

  /** Starting from the default beats starting from an empty box. */
  protected setSummaryOverride(override: boolean): void {
    const summary = this.story().world.summary;
    this.stories.setSummaryPrompt({
      useDefault: !override,
      prompt: summary.prompt || (override ? DEFAULT_SUMMARY_INSTRUCTION : ''),
    });
  }

  protected isOpen(id: string): boolean {
    return this.expanded().has(id);
  }

  protected toggle(id: string): void {
    this.expanded.update((open) => {
      const next = new Set(open);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected open(id: string): void {
    this.expanded.update((open) => new Set(open).add(id));
  }

  protected add(category: LoreCategory): void {
    // A new entry has no title and no keys yet, so it matches no search: with
    // one in the box the row that was just created is filtered out of the list
    // as it is made, and Add an entry looks like it did nothing at all.
    this.filter.set('');
    this.open(this.stories.addLore(category).id);
  }

  protected duplicate(id: string): void {
    this.stories.duplicateLore(id);
  }

  /** What the collapsed row says about when this entry fires. */
  protected summaryOf(entry: LoreEntry): string {
    if (entry.alwaysOn) return 'always on';
    return entry.keys.length ? entry.keys.join(', ') : 'no keys yet';
  }

  protected title(chapter: Chapter): string {
    return chapterTitle(chapter);
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected setKeys(entry: LoreEntry, raw: string): void {
    const keys = raw
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean);
    this.stories.patchLore(entry.id, { keys });
  }

  protected setDepth(raw: string): void {
    const depth = Number(raw);
    if (Number.isFinite(depth)) this.stories.patchScan({ depth: Math.max(0, Math.trunc(depth)) });
  }

  protected remove(entry: LoreEntry): void {
    this.stories.removeLore(entry.id);
  }
}
