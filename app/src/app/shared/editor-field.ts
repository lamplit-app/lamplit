import {
  Component,
  OnDestroy,
  booleanAttribute,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TextValue } from './text-value';

let nextId = 0;

/**
 * A block of text that belongs to a document. The save mark appears only once
 * the text differs from what is stored; clicking it commits, and so does
 * leaving the field or closing the modal — Escape and backdrop save, never
 * discard.
 *
 * The label is tied to the box by id rather than by wrapping it: a `<label>`
 * around all of this names the *first* labelable thing inside, which is the
 * save mark, and leaves the box itself with no name at all.
 *
 * How tall the box is, is not an input: put `li-rows-short`, `li-rows-medium`
 * or `li-rows-tall` on the element, as on any other box in the app. The two row
 * counts those classes set are inherited, so they reach the textarea in here
 * with nothing forwarding them — and there is one vocabulary for a height
 * rather than a number here and a pair of custom properties everywhere else.
 */
@Component({
  selector: 'li-editor-field',
  imports: [MatTooltipModule, TextValue],
  template: `
    <div class="field">
      <span class="head">
        @if (label()) {
          <label class="li-field-label" [attr.for]="id">{{ label() }}</label>
        }
        @if (dirty() && !readOnly()) {
          <button
            type="button"
            class="save"
            (click)="commit()"
            matTooltip="Save this text (leaving the field saves too)"
          >
            ✓ Save
          </button>
        }
      </span>

      <textarea
        [id]="id"
        [attr.aria-label]="label() ? null : ariaLabel() || null"
        [class.serif]="serif()"
        [class.dimmed]="dimmed()"
        [liText]="draft()"
        [placeholder]="placeholder()"
        [readOnly]="readOnly()"
        (input)="draft.set(text($event))"
        (blur)="commit()"
      ></textarea>

      <span class="foot">
        @if (hint()) {
          <span class="li-hint">{{ hint() }}</span>
        }
        <span class="li-hint count">{{ words() }} words</span>
      </span>
    </div>
  `,
  styles: `
    .field {
      display: flex;
      flex-direction: column;
      gap: var(--li-space-xs);
    }

    /* The row is held open so that the save mark appearing does not move the
       box, and the name sits at the foot of it — the same step above the box
       that li-field puts its own label, which is the point of both. */
    .head {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: var(--li-space-lg);
      min-height: 1.4rem;
    }

    .save {
      margin-left: auto;
      border: 1px solid color-mix(in srgb, var(--li-accent) 45%, var(--li-border));
      border-radius: var(--li-radius-pill);
      background: color-mix(in srgb, var(--li-accent) 12%, transparent);
      color: var(--li-accent);
      font: inherit;
      font-size: var(--li-text-xs);
      padding: var(--li-space-3xs) var(--li-space-sm);
      cursor: pointer;
    }

    /* Text that is not the writer's own yet — the narrator default, sitting in
       the box it will be edited in. Typing over it is what adopts it. */
    textarea.dimmed {
      color: var(--li-muted);
    }

    .foot {
      display: flex;
      justify-content: space-between;
      gap: var(--li-space-lg);
    }

    .count {
      flex: none;
      margin-left: auto;
    }
  `,
})
export class EditorField implements OnDestroy {
  readonly label = input('');
  /** A name for the box when what it holds is already written above it. */
  readonly ariaLabel = input('');
  readonly value = input('');
  readonly placeholder = input('');
  readonly hint = input('');
  /** A box that holds the story: set as the page sets prose, in the globals. */
  readonly serif = input(false, { transform: booleanAttribute });
  /** Shown, never taken: a closed chapter's scene, and anything else settled. */
  readonly readOnly = input(false, { transform: booleanAttribute });
  /** Drawn as the muted text it is until somebody makes it theirs. */
  readonly dimmed = input(false, { transform: booleanAttribute });

  readonly save = output<string>();

  protected readonly id = `li-editor-${++nextId}`;
  protected readonly draft = signal('');

  protected readonly dirty = computed(() => this.draft() !== this.value());
  protected readonly words = computed(() => countWords(this.draft()));

  constructor() {
    // The document is the source of truth; an outside edit replaces the draft,
    // and [liText] puts it in the box when it lands.
    effect(() => this.draft.set(this.value()));
  }

  /**
   * Closing the sheet saves what is in the box, which is the promise this
   * field makes and the reason Escape is safe here.
   *
   * It has to be `ngOnDestroy` rather than a `DestroyRef` callback: an
   * `output()` registers its own teardown on that same `DestroyRef` when the
   * component is built, so it runs first, and by the time a callback
   * registered afterwards asked it to emit, it had already stopped listening —
   * the save went nowhere. Lifecycle hooks run before those callbacks. Until
   * now the text was saved by accident instead: Chrome fires `blur` when a
   * focused box is removed from the page, and the blur handler did the work.
   * Firefox does not, so there the last thing typed was lost on Escape.
   */
  ngOnDestroy(): void {
    this.commit();
  }

  protected text(event: Event): string {
    return (event.target as HTMLTextAreaElement).value;
  }

  protected commit(): void {
    if (this.dirty() && !this.readOnly()) this.save.emit(this.draft());
  }
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
