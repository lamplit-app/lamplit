import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ParamRow } from './param-row';

/**
 * The row is where a number typed by hand becomes a number in the request, so
 * everything it can do to that number matters: the range is a promise to the
 * endpoint, and on an optional row an empty box means "leave it out
 * altogether", which is not the same as sending the default.
 */
describe('ParamRow', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<ParamRow>>;
  let emitted: (number | undefined)[];

  /** The row as Parameters shows temperature: 0 to 2, and always sent. */
  function open(inputs: Record<string, unknown> = {}): void {
    fixture = TestBed.createComponent(ParamRow);
    fixture.componentRef.setInput('label', 'Temperature');
    fixture.componentRef.setInput('min', 0);
    fixture.componentRef.setInput('max', 2);
    fixture.componentRef.setInput('step', 0.05);
    fixture.componentRef.setInput('value', 1);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.componentInstance.valueChange.subscribe((value) => emitted.push(value));
    fixture.detectChanges();
  }

  /** The exact box beside the slider, committed the way leaving it commits. */
  function typeExact(text: string): void {
    const box = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('.exact')!;
    box.value = text;
    box.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function exact(): HTMLInputElement {
    return (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('.exact')!;
  }

  /** The switch on an optional row: Material draws it as a button. */
  function toggle(): HTMLButtonElement {
    return (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'mat-slide-toggle button',
    )!;
  }

  beforeEach(() => {
    emitted = [];
  });

  it('takes a number inside the range as it was typed', () => {
    open();
    typeExact('1.35');
    expect(emitted).toEqual([1.35]);
  });

  it('holds a number typed past either end at the end it passed', () => {
    open();
    typeExact('9');
    typeExact('-4');
    expect(emitted).toEqual([2, 0]);
  });

  it('says nothing about a box with nothing in it, when the row is always sent', () => {
    open();
    typeExact('');
    expect(emitted).toEqual([]);
  });

  it('says nothing about something that is not a number', () => {
    open();
    typeExact('warm');
    expect(emitted).toEqual([]);
  });

  it('takes a decimal comma, the way a French or German desktop types one', () => {
    open();
    typeExact('0,9');
    expect(emitted).toEqual([0.9]);
  });

  it('writes the number in the app’s language, not the browser’s', () => {
    open({ value: 0.9 });
    // A type=number box formats and parses in the browser's UI locale, so on
    // a non-English desktop it would show 0,9 in an otherwise en_GB app.
    expect(exact().type).toBe('text');
    expect(exact().getAttribute('inputmode')).toBe('decimal');
    expect(exact().value).toBe('0.9');
  });

  it('reads an emptied box on an optional row as: do not send this at all', () => {
    open({ optional: true, value: 40 });
    typeExact('');
    expect(emitted).toEqual([undefined]);
  });

  it('drops an optional parameter from the request when it is switched off', () => {
    open({ optional: true, value: 40, min: 0, max: 200, step: 1 });
    toggle().click();
    fixture.detectChanges();
    expect(emitted).toEqual([undefined]);
  });

  it('switches an unset parameter on at the middle of its range, not at zero', () => {
    open({ optional: true, value: undefined, min: 0, max: 200, step: 1 });
    toggle().click();
    fixture.detectChanges();
    expect(emitted).toEqual([100]);
  });

  it('shows an unset parameter as empty and says it is not being sent', () => {
    open({ optional: true, value: undefined, min: 0, max: 200, step: 1 });
    expect(exact().value).toBe('');
    expect(exact().getAttribute('placeholder')).toBe('not sent');
    expect(exact().disabled).toBe(true);
  });
});
