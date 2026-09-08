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
import { fieldValue } from './field';
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
        [liText]="shown()"
        [placeholder]="placeholder()"
        [readOnly]="readOnly()"
        (input)="onInput($event)"
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
      border: 1px solid var(--li-edge-accent);
      border-radius: var(--li-radius-pill);
      background: var(--li-wash-accent-2);
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

  /**
   * What is being typed, or `null` when nothing is — which is the state the
   * box is in nearly all of the time, and the state it goes back to the moment
   * the text is committed.
   *
   * It used to be a copy of the document that was made once and then lived its
   * own life, and that copy could disagree with what the document said without
   * anything putting it right: a box emptied by hand saved its emptiness, the
   * document answered with the text it falls back to — the narrator's shipped
   * instruction — and because that was the same string the box had been given
   * in the first place, nothing changed, no effect ran, and the box stayed
   * empty while the request went out full. The box shows the document unless
   * somebody is writing in it.
   */
  private readonly draft = signal<string | null>(null);

  /** What is in the box: the draft while there is one, the document otherwise. */
  protected readonly shown = computed(() => this.draft() ?? this.value());

  protected readonly dirty = computed(() => {
    const draft = this.draft();
    return draft !== null && draft !== this.value();
  });
  protected readonly words = computed(() => countWords(this.shown()));

  constructor() {
    // The document is still the source of truth, so an edit from outside — the
    // model streaming a summary into this box, a reset putting text back —
    // takes the box back off whoever was typing, exactly as replacing the copy
    // used to. Reading `value()` is what makes this run when it changes.
    effect(() => {
      this.value();
      this.draft.set(null);
    });
  }

  /** Typed into, which is what makes the box the writer's for a moment. */
  protected onInput(event: Event): void {
    this.draft.set(fieldValue(event));
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

  /**
   * The text, to the document — and the box back to following it, whatever the
   * document makes of what it was handed. A store that answers an empty box
   * with the words it falls back to is answering correctly, and the box says
   * so rather than staying as it was left.
   */
  protected commit(): void {
    const draft = this.draft();
    const changed = draft !== null && draft !== this.value();
    this.draft.set(null);
    if (changed && !this.readOnly()) this.save.emit(draft);
  }
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
