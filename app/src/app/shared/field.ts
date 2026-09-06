import { AfterContentInit, Component, ElementRef, inject, input } from '@angular/core';

let nextId = 0;

/**
 * A box with its name above it, and a note under it when there is one.
 *
 * The box is projected rather than declared here: at the twenty-three places
 * this is used it is a line, a paragraph or a choice, readonly here and
 * disabled there, one of them with a button beside it — but where its name
 * goes is the same every time, and that is the whole of what this owns. The
 * frame round it is drawn in the globals, over `input`, `textarea` and
 * `select` alike.
 *
 * The name is tied to the box by id rather than by wrapping it: a `<label>`
 * around projected content names the first labelable thing inside, which for
 * the API key is the button that reveals it. The id is put on the box from
 * here rather than asked of every caller, because `for` has to name something
 * and a caller that forgets writes a field with no name and nothing to say so.
 */
@Component({
  selector: 'li-field',
  template: `
    @if (label()) {
      <label class="li-field-label" [attr.for]="id">{{ label() }}</label>
    }

    <ng-content />

    @if (hint()) {
      <span class="li-hint" [id]="hintId">{{ hint() }}</span>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--li-space-xs);
      min-width: 0;
    }
  `,
})
export class Field implements AfterContentInit {
  readonly label = input('');
  /**
   * A note under the box. Anything longer, or with a link in it, is written as
   * content instead: it lands under the box in source order either way.
   */
  readonly hint = input('');

  protected readonly id = `li-field-${++nextId}`;
  protected readonly hintId = `${this.id}-hint`;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  ngAfterContentInit(): void {
    const box = this.host.nativeElement.querySelector('input, select, textarea');
    if (!box) return;
    if (this.label() && !box.id) box.id = this.id;
    if (this.hint() && !box.hasAttribute('aria-describedby')) {
      box.setAttribute('aria-describedby', this.hintId);
    }
  }
}

/**
 * The string a box is holding, from the event it just fired.
 *
 * `$event.target` is an `EventTarget` and has no `.value`, so every
 * `(input)` and `(change)` binding in the app has to say which kind of box it
 * came from before it can read one. The cast is the whole of the work and it
 * is the same cast every time — an input, a textarea and a select all keep a
 * string there — so it is written here rather than once per component, where
 * six copies had drifted into four different unions of those three.
 *
 * A function rather than a pipe or a directive: it is called from a template,
 * where a component's own members are what is in scope, so each of the six
 * holds it as one — `protected readonly value = fieldValue;` — and the
 * templates go on reading `value($event)`.
 */
export function fieldValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
}
