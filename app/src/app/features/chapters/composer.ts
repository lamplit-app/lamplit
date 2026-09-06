import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ChapterStore } from '../../store/chapter-store';
import { SettingsStore } from '../../store/settings-store';
import { Layout } from '../../core/layout';
import { withDirection } from '../../core/prompt-builder';
import { TOKEN_ESTIMATOR, formatTokens } from '../../core/tokens';
import { DialogsService } from '../../shared/dialogs.service';
import { ProseEditor } from '../../shared/prose-editor';
import { TextValue } from '../../shared/text-value';

/**
 * The end of the page: what happens next, written where the reading stopped.
 *
 * It is in the page's scroller rather than docked under it, so it is on screen
 * for anyone who has read to the end and out of the way of anyone who has not.
 * Which is why it also listens for a key pressed with nothing focused: a writer
 * who finished reading half a page up should not have to go and find the box.
 *
 * The prose is written in a `li-prose-editor`, which shows speech and actions
 * as the page will and hands back markdown; `draft` holds that markdown and is
 * what everything else here reads. The author's direction stays a plain field:
 * it is an instruction, and formatting means nothing to it.
 *
 * Under a finger both of those change, and neither is about width. A phone
 * keyboard has a Return key and no Shift+Return, so Enter is a new line and
 * Send is the button that says Send; and a key pressed with nothing focused
 * cannot happen at all, so nothing listens for one.
 */
@Component({
  selector: 'li-composer',
  imports: [MatButtonModule, MatTooltipModule, ProseEditor, TextValue],
  host: {
    '(document:keydown)': 'onDocumentKey($event)',
  },
  template: `
    <div class="dock">
      <div class="column">
        <!-- A chapter that cannot be written into gets the reason and the way
             out of it, rather than a box that refuses what is typed into it. -->
        @if (chapters.writeBlock(); as blocked) {
          @if (blocked.action) {
            <button matButton="outlined" class="blocked" (click)="unblock()">
              {{ blocked.reason }} — {{ blockedAction() }}
            </button>
          } @else {
            <div class="box">
              <li-prose-editor
                #input
                class="prose li-rows-medium"
                label="What happens next"
                [submitOnEnter]="!layout.coarse()"
                [value]="draft()"
                [placeholder]="placeholder()"
                (valueChange)="onDraft($event)"
                (enter)="send()"
              />

              <!-- The author's own field, under the persona's words and inside
                   the same box: one message in two voices, and the split can be
                   read before it is sent rather than discovered afterwards. -->
              @if (authoring()) {
                <div class="direction">
                  <span class="tag li-smallcaps">author</span>
                  <textarea
                    #directionInput
                    class="li-rows-short"
                    aria-label="A direction from the author"
                    placeholder="Where the story goes. The model follows it and never mentions it."
                    [liText]="direction()"
                    (input)="direction.set(text($event))"
                    (keydown)="onKey($event)"
                  ></textarea>
                </div>
              }

              <div class="footer">
                <!-- The three things a line can carry, as quiet words each
                     wearing its own mark. Mousedown is swallowed so the
                     selection they are about is still there when they act. -->
                <div class="marks" role="group" aria-label="Formatting">
                  <button
                    class="quiet mark speech"
                    type="button"
                    (mousedown)="$event.preventDefault()"
                    (click)="input.quote()"
                    matTooltip="Quotes around the selection, or a pair to write into (Ctrl+')"
                  >
                    Speech
                  </button>
                  <button
                    class="quiet mark action"
                    type="button"
                    [class.on]="input.action()"
                    [attr.aria-pressed]="input.action()"
                    (mousedown)="$event.preventDefault()"
                    (click)="input.toggleAction()"
                    matTooltip="An action, in italics (Ctrl+I)"
                  >
                    Action
                  </button>
                  <button
                    class="quiet mark bold"
                    type="button"
                    [class.on]="input.bold()"
                    [attr.aria-pressed]="input.bold()"
                    (mousedown)="$event.preventDefault()"
                    (click)="input.toggleBold()"
                    matTooltip="Bold (Ctrl+B)"
                  >
                    Bold
                  </button>
                </div>

                <div class="buttons">
                  @if (chapters.isStreaming()) {
                    <button matButton="filled" class="stop" (click)="chapters.stop()">Stop</button>
                  } @else {
                    <button
                      class="quiet author"
                      type="button"
                      [class.on]="authoring()"
                      [attr.aria-pressed]="authoring()"
                      (click)="toggleAuthor()"
                      [matTooltip]="authorTooltip()"
                    >
                      Author
                    </button>
                    <button
                      matButton="filled"
                      class="send"
                      [disabled]="!canSend()"
                      (click)="send()"
                      [matTooltip]="sendTooltip()"
                    >
                      Send
                    </button>
                  }
                </div>
              </div>
            </div>

            <!-- The pill is developer mode's; the trimming note is everyone's,
                 because a chapter quietly dropping its own beginning is
                 something the writer has to be told about either way. -->
            @if (pill() || prompt().dropped > 0) {
              <div class="strip">
                @if (pill()) {
                  <button
                    class="li-pill"
                    type="button"
                    (click)="dialogs.openPromptPreview(draft(), direction())"
                    [matTooltip]="contextTooltip"
                  >
                    context {{ contextLabel() }}
                  </button>
                }
                @if (prompt().dropped > 0) {
                  <span class="li-hint">
                    {{ prompt().dropped }} older
                    {{ prompt().dropped === 1 ? 'message' : 'messages' }} left out
                  </span>
                }
              </div>
            }
          }
        }
      </div>
    </div>
  `,
  styles: `
    @use '../../../breakpoints' as bp;

    /* Part of the page now, not a shelf over it: no rule, no tint and nothing
       blurred behind it, because there is nothing behind it. The box draws its
       own border and that is the whole of the furniture. */
    .dock {
      padding: var(--li-space-2xs) 0 0;
    }

    .column {
      width: var(--li-column);
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: var(--li-space-sm);
    }

    .blocked {
      align-self: center;
      color: var(--li-accent);
    }

    .box {
      padding: var(--li-space-sm) var(--li-space-sm) var(--li-space-xs) var(--li-space-md);
      border: 1px solid var(--li-border);
      border-radius: var(--li-radius-lg);
      background: var(--li-surface-raised);
      transition: border-color 120ms ease;
    }

    .box:focus-within {
      border-color: color-mix(in srgb, var(--li-accent) 65%, var(--li-border));
    }

    /* The page's own prose rules do the setting; the box only gives it room. */
    .prose {
      padding: var(--li-space-3xs) var(--li-space-xs) var(--li-space-2xs) 0;
    }

    /* Marks on the left, the two verbs on the right, under whatever is being
       written: a footer, so the box is as wide as the page's text is. */
    .footer {
      display: flex;
      align-items: center;
      gap: var(--li-space-xs);
      margin-top: var(--li-space-2xs);
    }

    .marks {
      display: flex;
      align-items: center;
      gap: var(--li-space-3xs);
      margin-right: auto;
    }

    /* Five controls and no margin to spare: they wrap rather than squeeze. */
    @include bp.phone {
      .footer {
        flex-wrap: wrap;
      }
    }

    .buttons {
      flex: none;
      display: flex;
      align-items: center;
      gap: var(--li-space-xs);
    }

    /* Under the box, sharing its border, so the two fields read as one message
       in two voices rather than as two things to fill in. */
    .direction {
      display: flex;
      align-items: baseline;
      gap: var(--li-space-sm);
      margin-top: var(--li-space-xs);
      padding-top: var(--li-space-xs);
      border-top: 1px solid color-mix(in srgb, var(--li-border) 70%, transparent);
    }

    .direction .tag {
      flex: none;
      color: var(--li-muted);
    }

    /* Bare inside the box, which draws the frame: no border of its own, no
       background, and the frame variables restated so the row arithmetic in
       the shared rule counts what is actually there. */
    .direction textarea {
      --field-pad-y: 0px;
      --field-pad-x: 0;
      --field-border: 0px;
      flex: 1;
      min-width: 0;
      border-radius: 0;
      background: none;
      font-family: var(--li-sans);
      font-size: var(--li-text-md);
      font-style: italic;
      color: var(--li-ink-soft);
    }

    /* A quiet word, lit when what it stands for is on. */
    .quiet {
      padding: var(--li-space-xs) var(--li-space-sm);
      border: 1px solid transparent;
      border-radius: var(--li-radius-pill);
      background: none;
      color: var(--li-muted);
      font-family: var(--li-sans);
      font-size: var(--li-text-xs);
      letter-spacing: 0.02em;
      cursor: pointer;
    }

    .quiet:hover,
    .quiet:focus-visible {
      color: var(--li-ink-soft);
      border-color: var(--li-border);
    }

    .quiet.on {
      border-color: color-mix(in srgb, var(--li-accent) 55%, var(--li-border));
      background: color-mix(in srgb, var(--li-accent) 12%, transparent);
      color: var(--li-accent);
    }

    /* Each mark wears its own: the speech colour, the italic, the weight. */
    .mark {
      padding: var(--li-space-2xs) var(--li-space-sm);
      font-family: var(--li-serif);
      font-size: var(--li-text-sm);
      letter-spacing: 0;
    }

    .mark.speech {
      color: color-mix(in srgb, var(--li-speech) 65%, var(--li-muted));
    }

    .mark.action {
      font-style: italic;
    }

    .mark.bold {
      font-weight: 650;
    }

    .mark.on {
      color: var(--li-ink);
    }

    .send,
    .stop {
      flex: none;
    }

    .strip {
      display: flex;
      align-items: center;
      gap: var(--li-space-sm);
      min-height: 1.2rem;
    }

    button.li-pill:hover {
      color: var(--li-ink-soft);
    }

    /* Big enough to be pressed at all, which the quiet words are not. */
    @include bp.touch {
      .quiet {
        padding: var(--li-space-sm) var(--li-space-md);
      }

      .mark {
        padding: var(--li-space-sm);
      }
    }
  `,
})
export class Composer {
  protected readonly chapters = inject(ChapterStore);
  protected readonly settings = inject(SettingsStore);
  protected readonly dialogs = inject(DialogsService);
  protected readonly layout = inject(Layout);

  // Not `required`: a chapter with no scene, no connection or a closed status
  // has the reason and the way out of it where the box would be, and the
  // document-wide key listener runs on those pages too.
  protected readonly input = viewChild<ProseEditor>('input');
  private readonly directionInput = viewChild<ElementRef<HTMLTextAreaElement>>('directionInput');
  private readonly injector = inject(Injector);
  private readonly changes = inject(ChangeDetectorRef);

  /** The page is asked to bring its end into view; only it knows where that is. */
  readonly startedTyping = output();

  private readonly estimator = inject(TOKEN_ESTIMATOR);

  protected readonly draft = signal('');
  /** The author's half, when there is one. Empty is not the same as closed. */
  protected readonly direction = signal('');
  protected readonly authoring = signal(false);

  /**
   * The prompt without the draft, which is everything expensive: the lore scan
   * and the token count of every message. It depends on the story and the
   * chapter, not on what is being typed, so a keystroke costs one string
   * measurement rather than a rebuild of the whole request.
   */
  protected readonly prompt = computed(() => this.chapters.preview());

  protected readonly contextLabel = computed(() => {
    const { total, budget } = this.prompt().tokens;
    const content = withDirection(this.draft(), this.direction());
    const draft = this.estimator.countMessages([{ role: 'user', content }]);
    return `${formatTokens(total + draft)} / ${formatTokens(budget)}`;
  });

  protected readonly contextTooltip = 'Everything this request will send. Click to read it.';

  /**
   * The context pill, and the prompt preview behind it. Developer mode's, and
   * so the app's rather than the story's — which is why the phone layout does
   * not offer it, along with everything else that was set up on the computer.
   */
  protected readonly pill = computed(
    () => this.settings.ui().developerMode && !this.layout.phone(),
  );

  /** There is no Shift+Enter on a phone keyboard, and no need to mention one. */
  protected readonly sendTooltip = computed(() =>
    this.layout.coarse() ? 'Send it' : 'Enter to send, Shift+Enter for a new line',
  );

  protected readonly canSend = computed(
    () =>
      !!(this.draft().trim() || this.direction().trim()) &&
      !this.chapters.isStreaming() &&
      this.chapters.canWrite(),
  );

  protected readonly authorTooltip = computed(() =>
    this.authoring()
      ? 'Close it. Whatever is in it is thrown away.'
      : 'Say it as the author: an instruction the model follows and never mentions.',
  );

  /** The way out of whatever is keeping the composer shut. */
  protected readonly blockedAction = computed(() => {
    switch (this.chapters.writeBlock().action) {
      case 'scene':
        return 'write it';
      case 'continue':
        return 'continue it';
      case 'connection':
        return 'open Connection';
      default:
        return '';
    }
  });

  protected readonly placeholder = computed(() =>
    this.chapters.isEmpty() ? 'The chapter opens. What do you do?' : 'What happens next?',
  );

  protected text(event: Event): string {
    return (event.target as HTMLTextAreaElement).value;
  }

  /**
   * `[AUTHOR]` at the start of a line takes that line and everything after it
   * out of the prose and into the author's field, tag and all.
   *
   * It is a shorthand for the button beside Send rather than a syntax: the
   * split happens as it is typed and is shown, so what leaves the composer is
   * always what the writer can see in it. The editor is given the prose back
   * at once, and forgets the rest: the next keystroke must not land on a tag
   * that has already been taken out, or it would be taken out again.
   */
  protected onDraft(typed: string): void {
    const match = /^[ \t]*\[author\][ \t]*/im.exec(typed);
    if (!match) {
      this.draft.set(typed);
      return;
    }

    const prose = typed.slice(0, match.index).replace(/\s+$/, '');
    const said = typed.slice(match.index + match[0].length).trim();
    const already = this.direction().trim();

    this.draft.set(prose);
    this.input()?.show(prose);
    this.direction.set(already && said ? `${already}\n${said}` : already || said);
    this.authoring.set(true);
    this.focusDirection();
  }

  /** Opens the author's field, or closes it and drops what was in it. */
  protected toggleAuthor(): void {
    const open = !this.authoring();
    this.authoring.set(open);
    if (open) this.focusDirection();
    else this.direction.set('');
  }

  /**
   * A letter pressed with nothing focused goes into the composer.
   *
   * On a touch screen it does not happen at all: the shortcut exists so that a
   * writer need not go and find the box with the mouse, and a finger goes to
   * the box to type in the first place.
   *
   * "Nothing focused" is `document.body` and only that, which is what makes
   * this safe rather than clever: a dialog, a menu, another field or a button
   * all hold focus themselves, so none of them is interrupted, and Space on a
   * focused button still presses it. Space is left alone even here — it pages
   * the story down, and a reader uses it far more often than a writer would
   * open a line with one.
   *
   * The character is put in by hand rather than left to the browser to deliver
   * after the focus moves: this way it goes through the editor like any other
   * keystroke, so `[AUTHOR]` still works and there is nothing to be fragile
   * about.
   */
  protected onDocumentKey(event: KeyboardEvent): void {
    // Nothing to catch under a finger: there is no keyboard on screen until
    // the box has the focus, so a keystroke that arrived with nothing focused
    // came from somewhere this cannot reason about.
    if (this.layout.coarse()) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length !== 1 || event.key === ' ') return;
    if (document.activeElement && document.activeElement !== document.body) return;

    const editor = this.input();
    if (!editor) return;
    event.preventDefault();
    editor.insertText(event.key);
    this.startedTyping.emit();
  }

  /** The author's field: Enter sends from there too, and Shift+Enter is a newline. */
  protected onKey(event: KeyboardEvent): void {
    // Except under a finger, where it is a new line, as it is in the prose box
    // above it: a phone keyboard's Return has no Shift beside it.
    if (this.layout.coarse()) return;
    // Ctrl/Cmd+Enter belongs to the global regenerate shortcut, so it does not send.
    if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    this.send();
  }

  protected send(): void {
    if (!this.canSend()) return;
    const text = this.draft();
    const said = this.direction();
    // The editor follows the draft: emptied, and its history with it, so undo
    // cannot bring back what has been sent.
    this.draft.set('');
    this.direction.set('');
    this.authoring.set(false);
    void this.chapters.send(text, said);
  }

  /**
   * Puts the field on the page now and the caret in it, rather than a frame
   * from now: the `[AUTHOR]` split happens mid-word, and whatever is typed
   * between the tag closing and the field taking focus would otherwise land
   * in the prose the tag was just taken out of.
   */
  private focusDirection(): void {
    this.changes.detectChanges();
    const field = this.directionInput()?.nativeElement;
    if (field) {
      focusEnd(field);
      return;
    }
    // Not on the page yet after all: after the render that puts it there.
    afterNextRender(
      () => {
        const late = this.directionInput()?.nativeElement;
        if (late) focusEnd(late);
      },
      { injector: this.injector },
    );
  }

  protected unblock(): void {
    const chapter = this.chapters.chapter();
    switch (this.chapters.writeBlock().action) {
      case 'scene':
        void this.dialogs.openScene(chapter.id, true);
        break;
      case 'continue':
        this.chapters.continueChapter(chapter.id);
        break;
      case 'connection':
        void this.dialogs.openConnection();
        break;
    }
  }
}

function focusEnd(field: HTMLTextAreaElement): void {
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
}
