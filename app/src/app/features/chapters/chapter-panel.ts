import { Component, DestroyRef, computed, effect, inject, untracked } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DEFAULT_NARRATOR_PROMPT } from '../../core/defaults';
import { characterColour } from '../../core/character-colours';
import { Layout } from '../../core/layout';
import { Character, PanelSection } from '../../core/models';
import { firstLine, isOneAtATime } from '../../core/prompt-builder';
import { DialogsService } from '../../shared/dialogs.service';
import { CharacterSwatch } from '../../shared/character-swatch';
import { EditorField } from '../../shared/editor-field';
import { fieldValue } from '../../shared/field';
import { TextValue } from '../../shared/text-value';
import { ChapterStore } from '../../store/chapter-store';
import { SettingsStore } from '../../store/settings-store';
import { StoryStore } from '../../store/story-store';

/**
 * The swipe that opens it on a phone, where there is no rail to press.
 *
 * A drag that starts within `EDGE_ZONE` of the right-hand side and travels
 * `SWIPE_DISTANCE` to the left, further across than up or down, is the panel
 * being pulled out. The zone is narrow and the direction is checked so that a
 * finger scrolling the story near the edge is never mistaken for one.
 */
const EDGE_ZONE = 24;
const SWIPE_DISTANCE = 48;

/**
 * The chapter's own fields, beside the page instead of over it.
 *
 * The scene, the narrator's instructions, the persona and the cast are what
 * shape the chapter being written, and every one of them used to mean leaving
 * the story for a modal and coming back. They are all here, edited where they
 * are, saved the way every other field in the app is saved — on blur, with a
 * mark while there is something unsaved.
 *
 * Nothing about the app itself is in here. Preferences, the connection and the
 * sampling parameters are not chapter fields and stay behind their own sheets.
 *
 * On a phone the thin rail down the side is gone — it would be a fifteenth of
 * the screen spent on a handle — and the panel is a sheet instead: opened from
 * the one menu or by pulling it in from the right edge, closed by its own
 * button, by Escape, or by the back gesture, which on a phone is what a reader
 * will try first.
 */
@Component({
  selector: 'li-chapter-panel',
  imports: [MatTooltipModule, CharacterSwatch, EditorField, TextValue],
  template: `
    @if (open()) {
      <!-- Only when it is covering the page: something has to say the page is
           behind it, and be the click that gives the page back. -->
      @if (overlay()) {
        <div class="scrim" aria-hidden="true" (click)="close()"></div>
      }

      <aside class="panel" aria-label="This chapter">
        <header class="top">
          <span class="what li-title li-one-line">This chapter</span>
          <!-- Full screen, a chevron pointing right points at nothing, and
               there is no keyboard to press Ctrl+. on. The way out is a word,
               at the size a thumb lands on. It still answers to the whole
               sentence, which is what a reader hearing the sheet read out
               needs and what the one word has no room to say. -->
          @if (layout.phone()) {
            <button
              type="button"
              class="close li-link"
              aria-label="Close the chapter panel"
              (click)="close()"
            >
              Close
            </button>
          } @else {
            <button
              type="button"
              class="icon li-icon-button"
              aria-label="Close the chapter panel"
              matTooltip="Close it (Ctrl+.)"
              (click)="close()"
            >
              ›
            </button>
          }
        </header>

        <div class="scroll">
          <section class="block" data-section="scene">
            <button
              type="button"
              class="head li-disclose"
              [attr.aria-expanded]="isOpen('scene')"
              (click)="toggleSection('scene')"
            >
              <span class="li-caret">{{ isOpen('scene') ? '▾' : '▸' }}</span>
              <span class="name">Scene</span>
              <span class="aside li-aside li-one-line">{{ sceneLabel() }}</span>
            </button>
            @if (isOpen('scene')) {
              <div class="body">
                <li-editor-field
                  serif
                  class="li-rows-medium"
                  ariaLabel="The scene"
                  [value]="chapters.chapter().scene"
                  [readOnly]="chapters.isClosed()"
                  [hint]="sceneHint()"
                  placeholder="A lighthouse gallery. Dusk, the first night of autumn."
                  (save)="setScene($event)"
                />
              </div>
            }
          </section>

          @if (story().mode === 'narrator') {
            <section class="block" data-section="narrator">
              <button
                type="button"
                class="head li-disclose"
                [attr.aria-expanded]="isOpen('narrator')"
                (click)="toggleSection('narrator')"
              >
                <span class="li-caret">{{ isOpen('narrator') ? '▾' : '▸' }}</span>
                <span class="name">Narrator</span>
                <span class="aside li-aside li-one-line">{{
                  story().narrator.useDefault ? 'default' : 'your own'
                }}</span>
              </button>
              @if (isOpen('narrator')) {
                <div class="body">
                  <!-- The default sits in the box it would be edited in, greyed
                       until it is written over. Typing is what adopts it. -->
                  <li-editor-field
                    class="li-rows-tall"
                    ariaLabel="Narrator instructions"
                    [value]="narratorText()"
                    [dimmed]="story().narrator.useDefault"
                    (save)="setNarrator($event)"
                  />
                  @if (story().narrator.useDefault) {
                    <p class="li-hint">
                      The instructions Lamplit ships with. Write into them and they become yours.
                    </p>
                  } @else {
                    <button type="button" class="li-link" (click)="backToDefault()">
                      Back to the default
                    </button>
                  }
                </div>
              }
            </section>
          }

          <section class="block" data-section="persona">
            <button
              type="button"
              class="head li-disclose"
              [attr.aria-expanded]="isOpen('persona')"
              (click)="toggleSection('persona')"
            >
              <span class="li-caret">{{ isOpen('persona') ? '▾' : '▸' }}</span>
              <span class="name">Persona</span>
              <span class="aside li-aside li-one-line">{{ story().persona.name }}</span>
            </button>
            @if (isOpen('persona')) {
              <div class="body">
                <input
                  type="text"
                  aria-label="Persona name"
                  placeholder="Who you are in this story"
                  [liText]="story().persona.name"
                  (change)="setPersona({ name: value($event) })"
                />
                <li-editor-field
                  class="li-rows-medium"
                  ariaLabel="Persona description"
                  [value]="story().persona.description"
                  placeholder="Mara, a marine biologist, thirty-one, back on the island after nine years."
                  (save)="setPersona({ description: $event })"
                />
              </div>
            }
          </section>

          @if (story().mode === 'roleplay') {
            <section class="block" data-section="cast">
              <button
                type="button"
                class="head li-disclose"
                [attr.aria-expanded]="isOpen('cast')"
                (click)="toggleSection('cast')"
              >
                <span class="li-caret">{{ isOpen('cast') ? '▾' : '▸' }}</span>
                <span class="name">Cast</span>
                <span class="aside li-aside li-one-line">{{ castLabel() }}</span>
              </button>
              @if (isOpen('cast')) {
                <div class="body">
                  <!-- A character is a name and a paragraph, which is more than
                       a row can hold: these are read here, edited in the sheet. -->
                  @for (character of story().characters; track character.id) {
                    <div
                      class="cast-row"
                      [class.off]="!character.enabled"
                      [class.playing]="isPlaying(character.id)"
                      [style.--li-cast-colour]="colourOf(character)"
                    >
                      <li-character-swatch
                        [character]="character"
                        (pick)="stories.setCharacterColour(character.id, $event)"
                      />

                      <!-- Playing one at a time, the row is the switch: click
                           it and the model is that character from here on. -->
                      @if (switching()) {
                        <button
                          type="button"
                          class="who"
                          [disabled]="!character.enabled || isPlaying(character.id)"
                          [attr.aria-label]="'Play ' + (character.name || 'this character')"
                          [matTooltip]="playTooltip(character.enabled)"
                          (click)="play(character.id)"
                        >
                          <span class="cast-name li-one-line">
                            {{ character.name || 'Unnamed' }}
                            @if (isPlaying(character.id)) {
                              <span class="tag li-chip">playing</span>
                            }
                          </span>
                          <span class="cast-line li-one-line">{{
                            describe(character.description)
                          }}</span>
                        </button>
                      } @else {
                        <span class="who">
                          <span class="cast-name li-one-line">{{
                            character.name || 'Unnamed'
                          }}</span>
                          <span class="cast-line li-one-line">{{
                            describe(character.description)
                          }}</span>
                        </span>
                      }

                      <button
                        type="button"
                        class="li-switch"
                        role="switch"
                        [attr.aria-checked]="character.enabled"
                        [attr.aria-label]="
                          (character.name || 'This character') + ' is in the scene'
                        "
                        [matTooltip]="
                          character.enabled ? 'In the scene — take them out' : 'Bring them in'
                        "
                        (click)="setInScene(character.id, !character.enabled)"
                      >
                        <span class="li-knob"></span>
                      </button>

                      <button
                        type="button"
                        class="icon li-icon-button"
                        [attr.aria-label]="'Edit ' + (character.name || 'this character')"
                        matTooltip="Open this character in the Story sheet"
                        (click)="edit(character.id)"
                      >
                        ✎
                      </button>
                    </div>
                  } @empty {
                    <p class="li-hint">
                      No characters yet. Without them the model plays whoever the scene needs.
                    </p>
                  }
                  <button type="button" class="add li-link" (click)="add()">Add a character</button>
                </div>
              }
            </section>
          }
        </div>
      </aside>
    } @else if (!layout.phone()) {
      <button
        type="button"
        class="handle"
        aria-label="Open the chapter panel"
        matTooltip="The scene, the narrator, your persona and the cast (Ctrl+.)"
        (click)="setOpen(true)"
      >
        <span class="li-caret">‹</span>
        <span class="edge">This chapter</span>
      </button>
    }
  `,
  styles: `
    @use '../../../breakpoints' as bp;

    /* The host is the thin edge — and it stays the thin edge in the covering
       layout too, where the panel is lifted out of the flow and the page keeps
       every pixel it had. */
    :host {
      flex: none;
      display: block;
      width: 1.9rem;
      height: 100%;
      min-height: 0;
    }

    :host(.open) {
      width: min(21rem, 40vw);
    }

    :host(.open.overlay) {
      width: 1.9rem;
    }

    /* No rail at all on a phone: the story gets the whole width, and the panel
       is reached from the menu or from the edge of the screen. */
    @include bp.phone {
      :host,
      :host(.open) {
        width: 0;
      }
    }

    .handle {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--li-space-sm);
      width: 100%;
      height: 100%;
      padding: var(--li-space-md) 0;
      border: 0;
      border-left: 1px solid var(--li-border);
      background: color-mix(in srgb, var(--li-surface) 55%, transparent);
      color: var(--li-muted);
      font: inherit;
      cursor: pointer;
    }

    .handle:hover {
      color: var(--li-ink-soft);
      background: color-mix(in srgb, var(--li-surface) 90%, transparent);
    }

    .edge {
      writing-mode: vertical-rl;
      font-size: var(--li-text-xs);
      letter-spacing: 0.06em;
    }

    .scrim {
      position: absolute;
      inset: 0;
      z-index: var(--li-layer-page);
      background: light-dark(rgb(30 26 20 / 24%), rgb(6 7 10 / 46%));
    }

    .panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      border-left: 1px solid var(--li-border);
      background: var(--li-surface);
    }

    /* Over the page rather than beside it, with the scrim between: at this
       width the panel is the thing being used, and the page under it — the
       composer at the end of it included — waits until the scrim is clicked. */
    :host(.overlay) .panel {
      position: absolute;
      inset-block: 0;
      right: 0;
      z-index: var(--li-layer-over);
      width: min(21rem, 88vw);

      /* Off the shadow scale, because both of its steps fall downwards and
         this one has to fall sideways: the panel's only free edge is the left
         one, and a shadow under a thing whose top and bottom are the window is
         a shadow nobody sees. The same ink as the over step, turned. */
      box-shadow: -18px 0 48px light-dark(rgb(0 0 0 / 12%), rgb(0 0 0 / 45%));
    }

    /* A sheet rather than a drawer: the whole width, because 12% of a phone
       screen showing the story it is covering is not a glimpse of anything. */
    @include bp.phone {
      :host(.overlay) .panel {
        width: 100%;
        border-left: 0;
      }
    }

    .top {
      flex: none;
      display: flex;
      align-items: center;
      gap: var(--li-space-sm);
      padding: var(--li-space-sm) var(--li-space-xs) var(--li-space-sm) var(--li-space-md);
      border-bottom: 1px solid var(--li-border);
    }

    .what {
      flex: 1;
    }

    /* The word that closes the sheet, at the size a finger is aimed with —
       44px, which is what both Apple and Google call a target. */
    .close {
      flex: none;
      min-height: 2.75rem;
      padding: 0 var(--li-space-md);
      font-size: var(--li-text-md);
    }

    .scroll {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: var(--li-space-2xs) 0 var(--li-space-xl);
    }

    @include bp.phone {
      .scroll {
        padding-bottom: calc(var(--li-space-xl) + env(safe-area-inset-bottom));
      }
    }

    .block {
      border-bottom: 1px solid color-mix(in srgb, var(--li-border) 70%, transparent);
    }

    /* A band across the panel, so it takes the whole width; the rest of what
       a folding row is is in li-disclose. */
    .head {
      width: 100%;
      padding: var(--li-space-sm) var(--li-space-md);
      font-size: var(--li-text-sm);
    }

    .head .name {
      flex: none;
      letter-spacing: 0.02em;
    }

    /* What the section says with nothing unfolded, held against the far edge
       so that four of them read down a column. */
    .aside {
      text-align: right;
    }

    .body {
      display: flex;
      flex-direction: column;
      gap: var(--li-space-sm);
      padding: 0 var(--li-space-md) var(--li-space-md);
    }

    /* The stack stretches what is in it; a word does not want the width. */
    .body > .li-link {
      align-self: flex-start;
    }

    .add {
      margin-top: var(--li-space-3xs);
    }

    .cast-row {
      display: flex;
      align-items: center;
      gap: var(--li-space-sm);
      padding: var(--li-space-xs);
      border: 1px solid transparent;
      border-radius: var(--li-radius-md);
    }

    .cast-row:hover {
      border-color: var(--li-border);
      background: var(--li-surface-raised);
    }

    /* In the cast but out of the scene. Still listed, because it is a door
       back in rather than a deletion. */
    .cast-row.off .who {
      opacity: 0.45;
    }

    /* Who the model is being, when it is being one of them — in their own
       colour, so the row and the dot on it are saying the same thing. */
    .cast-row.playing {
      border-color: color-mix(in srgb, var(--li-cast-colour) 45%, var(--li-border));
      background: color-mix(in srgb, var(--li-cast-colour) 14%, transparent);
    }

    .tag {
      margin-left: var(--li-space-xs);
      padding: 0 var(--li-space-xs);
      border-radius: var(--li-radius-pill);
      background: color-mix(in srgb, var(--li-cast-colour) 24%, transparent);
      color: var(--li-cast-colour);
      vertical-align: 1px;
    }

    .who {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
      text-align: left;
    }

    button.who:not(:disabled) {
      cursor: pointer;
    }

    .cast-name {
      font-size: var(--li-text-md);
      color: var(--li-ink);
    }

    .cast-line {
      font-size: var(--li-text-xs);
      color: var(--li-muted);
    }

    /* Round, and small enough to sit on a cast row beside a name. */
    .icon {
      width: 1.6rem;
      height: 1.6rem;
      border-radius: 50%;
      font-size: var(--li-text-md);
    }

    /* Sized for a pointer that lands on one pixel; a finger does not. The
       switch on a row grows in the globals, with the rest of the app's. */
    @include bp.touch {
      .head {
        padding: var(--li-space-md);
      }

      .icon {
        width: 2.25rem;
        height: 2.25rem;
        font-size: var(--li-text-lg);
      }
    }
  `,
  host: {
    '[class.open]': 'open()',
    '[class.overlay]': 'overlay()',
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class ChapterPanel {
  protected readonly chapters = inject(ChapterStore);
  protected readonly stories = inject(StoryStore);
  protected readonly story = this.stories.story;
  protected readonly layout = inject(Layout);
  private readonly settings = inject(SettingsStore);
  private readonly dialogs = inject(DialogsService);

  protected readonly open = computed(() => this.settings.ui().sidebarOpen);

  /** No room left to push the page aside, so it goes over it instead. */
  protected readonly overlay = computed(() => !this.layout.roomForPanel());

  protected readonly narratorText = computed(() => {
    const narrator = this.story().narrator;
    return narrator.useDefault ? DEFAULT_NARRATOR_PROMPT : narrator.prompt;
  });

  protected readonly sceneLabel = computed(() =>
    this.chapters.isClosed() ? 'closed' : firstLine(this.chapters.chapter().scene, 34),
  );

  protected readonly sceneHint = computed(() =>
    this.chapters.isClosed()
      ? 'This chapter is closed; its scene is what it was written on.'
      : 'Sent with every request of this chapter.',
  );

  /** Whether a row is a switch: only one casting has anything to switch. */
  protected readonly switching = computed(() => isOneAtATime(this.story()));

  protected readonly castLabel = computed(() => {
    const playing = this.chapters.playing();
    if (playing) return `playing ${playing.name.trim() || 'Unnamed'}`;
    const count = this.story().characters.length;
    return count === 1 ? '1 character' : `${count} characters`;
  });

  /** Where a drag from the right-hand edge started, while it is still a drag. */
  private swipe: { x: number; y: number } | null = null;

  /** Whether the history entry standing for the open sheet is ours to pop. */
  private pushed = false;

  constructor() {
    const back = () => this.onBack();
    addEventListener('popstate', back);

    // By hand, and passive, rather than as host listeners. A host listener
    // runs a change detection pass after every event it takes, and `touchmove`
    // fires all the way down a scroll — for a handler whose answer is almost
    // always "not this one". The single move that does open the panel sets a
    // signal, which schedules a pass by itself.
    const touch = { passive: true } as const;
    const start = (event: TouchEvent) => this.onTouchStart(event);
    const move = (event: TouchEvent) => this.onTouchMove(event);
    const end = () => (this.swipe = null);
    document.addEventListener('touchstart', start, touch);
    document.addEventListener('touchmove', move, touch);
    document.addEventListener('touchend', end, touch);
    document.addEventListener('touchcancel', end, touch);

    inject(DestroyRef).onDestroy(() => {
      removeEventListener('popstate', back);
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', end);
    });

    this.followWithHistory();
  }

  /**
   * The back gesture closes the sheet, because on a phone it is the first
   * thing a reader will try and the alternative is leaving the app mid-story.
   *
   * A history entry is pushed when the sheet opens and popped when it closes,
   * whichever way it was closed — so the two stay in step and back never has
   * to guess. Watching `open()` rather than doing this inside the openers is
   * what makes that true: the menu, the shortcut, the swipe and the settings
   * document all set the same signal, and only one of them is on this file.
   *
   * The state it opens in is not pushed. A phone that reloads with the panel
   * remembered open has one screen of history, and back should still be the
   * way out of the app.
   */
  private followWithHistory(): void {
    let shown = untracked(this.open);
    effect(() => {
      const open = this.open();
      if (open === shown) return;
      shown = open;
      if (open) {
        if (!this.layout.phone() || this.pushed) return;
        this.pushed = true;
        history.pushState({ liPanel: true }, '');
      } else if (this.pushed) {
        // Closed some other way — the button, Escape, the scrim. The entry
        // that stood for it goes with it, and the `popstate` that answers
        // finds nothing left to do.
        this.pushed = false;
        history.back();
      }
    });
  }

  /** The gesture itself: our entry is gone, so the sheet goes with it. */
  private onBack(): void {
    if (!this.pushed) return;
    this.pushed = false;
    this.setOpen(false);
  }

  /**
   * A finger pulling the sheet in from the right-hand side of the screen.
   *
   * Only where there is no rail to press, only from the outer inch of the
   * screen, and only when it travels further across than up: a reader
   * scrolling the story with their thumb against the edge is doing something
   * else, and this must never take the page away from them.
   */
  private onTouchStart(event: TouchEvent): void {
    this.swipe = null;
    if (!this.layout.phone() || this.open() || event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (!touch || innerWidth - touch.clientX > EDGE_ZONE) return;
    this.swipe = { x: touch.clientX, y: touch.clientY };
  }

  private onTouchMove(event: TouchEvent): void {
    const from = this.swipe;
    const touch = event.touches[0];
    if (!from || !touch) return;
    const across = from.x - touch.clientX;
    const down = Math.abs(from.y - touch.clientY);
    if (across < SWIPE_DISTANCE || across <= down) return;
    this.swipe = null;
    this.setOpen(true);
  }

  protected isOpen(section: PanelSection): boolean {
    return this.settings.ui().sidebarSections[section] !== false;
  }

  protected toggleSection(section: PanelSection): void {
    this.settings.setPanelSection(section, !this.isOpen(section));
  }

  protected setOpen(open: boolean): void {
    this.settings.setSidebarOpen(open);
  }

  protected close(): void {
    this.setOpen(false);
  }

  /**
   * Escape belongs to whatever is on top of everything else. A sheet is over
   * the panel, so it answers first; a menu opened from inside the panel — a
   * character's colours — is over it too, and closing the menu is the whole
   * of what the key meant. A panel that is pushing the page rather than
   * covering it is part of the page, with nothing to dismiss.
   *
   * Nothing keeps a register of open menus, the way the dialogs service can be
   * asked what is open over the page, so the overlay container is looked at
   * directly. What cannot be asked is whether the event was handled: the prose
   * editor marks Escape handled whenever it has the focus, which is most of
   * the time.
   */
  protected onEscape(): void {
    if (this.dialogs.anyOpen()) return;
    if (document.querySelector('.cdk-overlay-container .mat-mdc-menu-panel')) return;
    if (this.open() && this.overlay()) this.close();
  }

  protected readonly value = fieldValue;

  protected describe(description: string): string {
    return firstLine(description, 60) || 'No description yet';
  }

  protected setScene(scene: string): void {
    this.chapters.update(this.chapters.chapter().id, { scene });
  }

  /** Writing over the default is what adopts it; the text is kept as written. */
  protected setNarrator(prompt: string): void {
    this.stories.patch({ narrator: { useDefault: false, prompt } });
  }

  /** The custom text stays in the document, so switching back finds it again. */
  protected backToDefault(): void {
    this.stories.patch({ narrator: { ...this.story().narrator, useDefault: true } });
  }

  protected setPersona(patch: Partial<{ name: string; description: string }>): void {
    this.stories.patch({ persona: { ...this.story().persona, ...patch } });
  }

  protected colourOf(character: Character): string {
    return characterColour(character, this.settings.ui().theme);
  }

  protected isPlaying(characterId: string): boolean {
    return this.chapters.playing()?.id === characterId;
  }

  protected playTooltip(enabled: boolean): string {
    return enabled
      ? 'Play this character from here on'
      : 'Bring them into the scene before playing them';
  }

  protected play(characterId: string): void {
    this.chapters.setActiveCharacter(characterId);
  }

  protected setInScene(characterId: string, inScene: boolean): void {
    this.chapters.setCharacterEnabled(characterId, inScene);
  }

  protected edit(characterId: string): void {
    void this.dialogs.openStory(characterId);
  }

  /** A blank row says nothing, so the sheet opens on it with the name waiting. */
  protected add(): void {
    const character = this.stories.addCharacter();
    void this.dialogs.openStory(character.id);
  }
}
