import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { MessageEdit, MessageItem } from './message-item';
import { ChapterMessage } from '../../core/models';
import { ProseEditor } from '../../shared/prose-editor';

const MESSAGE: ChapterMessage = {
  id: 'm-1',
  role: 'assistant',
  content: 'The keeper went up the stairs.',
  createdAt: '2026-01-01T00:00:00.000Z',
  meta: { model: 'a-model', promptTokens: 1200, completionTokens: 340 },
};

/**
 * Editing a message is the one place in the app where what is on screen is not
 * yet what the document says, so every way out of it has to be exact: Escape
 * puts the message back untouched, Ctrl+Enter saves without the mouse, and a
 * save that changes nothing must not file an edit — a message marked "edited"
 * for a keystroke that was undone is a lie about the story that never washes
 * out.
 */
describe('MessageItem, being edited', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<MessageItem>>;
  let saved: MessageEdit[];

  const host = () => fixture.nativeElement as HTMLElement;

  function open(message: Partial<ChapterMessage> = {}, streaming = false): void {
    fixture = TestBed.createComponent(MessageItem);
    fixture.componentRef.setInput('message', { ...MESSAGE, ...message });
    fixture.componentRef.setInput('streaming', streaming);
    fixture.componentInstance.edited.subscribe((edit) => saved.push(edit));
    fixture.detectChanges();
  }

  /** The pencil in the margin, which is the way in that has no menu behind it. */
  function startEditing(): void {
    host().querySelector<HTMLButtonElement>('.rail .act[aria-label="Edit"]')!.click();
    fixture.detectChanges();
  }

  /** The prose box, driven the way a keystroke drives it. */
  function type(text: string): void {
    const editor = fixture.debugElement.query(By.directive(ProseEditor))
      .componentInstance as ProseEditor;
    editor.insertText(text);
    fixture.detectChanges();
  }

  function directionBox(): HTMLTextAreaElement {
    const box = host().querySelector<HTMLTextAreaElement>('.direction-edit textarea');
    if (!box) throw new Error('the message has no author half to edit');
    return box;
  }

  function typeDirection(text: string): void {
    const box = directionBox();
    box.value = text;
    box.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  /** A key pressed in whichever half of the editor is named. */
  function press(selector: string, key: string, modifiers: KeyboardEventInit = {}): void {
    host()
      .querySelector(selector)!
      .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
    fixture.detectChanges();
  }

  const editing = () => !!host().querySelector('.editor');
  const shown = () => host().querySelector('.story-prose')?.textContent.trim() ?? '';

  beforeEach(() => {
    saved = [];
    TestBed.configureTestingModule({});
  });

  it('opens on what the message says now', async () => {
    open();
    startEditing();
    await fixture.whenStable();

    expect(editing()).toBe(true);
    expect(host().textContent).toContain('Ctrl+Enter saves, Escape cancels.');
  });

  it('puts the message back, unedited, when Escape is pressed', async () => {
    open();
    startEditing();
    await fixture.whenStable();
    type(' And then he stopped.');

    press('li-prose-editor', 'Escape');

    expect(editing()).toBe(false);
    expect(saved).toEqual([]);
    expect(shown()).toBe('The keeper went up the stairs.');
  });

  it('saves on Ctrl+Enter, without reaching for the button', async () => {
    open();
    startEditing();
    await fixture.whenStable();
    type(' And then he stopped.');

    press('li-prose-editor', 'Enter', { ctrlKey: true });

    expect(editing()).toBe(false);
    expect(saved).toEqual([
      { content: 'The keeper went up the stairs. And then he stopped.', direction: '' },
    ]);
  });

  it('files nothing when the text comes back exactly as it was', async () => {
    open();
    startEditing();
    await fixture.whenStable();

    press('li-prose-editor', 'Enter', { ctrlKey: true });

    expect(editing()).toBe(false);
    expect(saved).toEqual([]);
  });

  it('files nothing when both halves are emptied: a message with nothing left is a deletion', async () => {
    // A message that is nothing but a direction is one the app already keeps,
    // so its prose half opens empty; emptying the other leaves nothing at all.
    open({ content: '', direction: 'Keep him quiet.' });
    startEditing();
    await fixture.whenStable();

    typeDirection('   ');
    press('.direction-edit textarea', 'Enter', { ctrlKey: true });

    expect(editing()).toBe(false);
    expect(saved).toEqual([]);
  });

  it('lets either half be emptied on its own', async () => {
    open({ content: 'What the keeper said.', direction: 'Keep him quiet.' });
    startEditing();
    await fixture.whenStable();

    typeDirection('  ');
    press('.direction-edit textarea', 'Enter', { ctrlKey: true });

    expect(saved).toEqual([{ content: 'What the keeper said.', direction: '' }]);
  });

  it('answers Escape and Ctrl+Enter from the author half as well as the prose', async () => {
    open({ direction: 'Keep him quiet.' });
    startEditing();
    await fixture.whenStable();
    typeDirection('Let him speak.');

    press('.direction-edit textarea', 'Escape');
    expect(editing()).toBe(false);
    expect(saved).toEqual([]);
  });

  it('has no author half to edit when the message never had one', async () => {
    open();
    startEditing();
    await fixture.whenStable();

    expect(host().querySelector('.direction-edit')).toBeNull();
  });

  it('cannot be edited while the words are still arriving', () => {
    open({ content: 'The keeper went' }, true);

    expect(host().querySelector<HTMLButtonElement>('.rail .act[aria-label="Edit"]')!.disabled).toBe(
      true,
    );
    startEditing();
    expect(editing()).toBe(false);
  });
});

/**
 * The footer is the only place a reader is told anything about how the reply
 * came back — and the one that matters most is the reply that stopped because
 * it ran out of room, which otherwise reads as a model that trails off.
 */
describe('MessageItem, in its footer', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<MessageItem>>;

  function open(message: Partial<ChapterMessage>, showTokens = true): string {
    fixture = TestBed.createComponent(MessageItem);
    fixture.componentRef.setInput('message', { ...MESSAGE, ...message });
    fixture.componentRef.setInput('showTokens', showTokens);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector('.said')?.textContent.trim() ?? '';
  }

  beforeEach(() => TestBed.configureTestingModule({}));

  it('says the reply was cut off at the limit rather than letting it trail away', () => {
    expect(open({ meta: { ...MESSAGE.meta, finishReason: 'length' } })).toContain(
      'cut off at the reply limit',
    );
  });

  it('says nothing about a reply that simply finished', () => {
    expect(open({ meta: { ...MESSAGE.meta, finishReason: 'stop' } })).not.toContain('cut off');
  });

  it('calls a reply the reader stopped stopped, and not cut off', () => {
    const said = open({ meta: { ...MESSAGE.meta, finishReason: 'length', aborted: true } });
    expect(said).toContain('stopped');
    expect(said).not.toContain('cut off');
  });

  it('names the model and what the turn cost, and drops the cost when it is not wanted', () => {
    expect(open({})).toBe('a-model  ·  1.2k in · 340 out');
    expect(open({}, false)).toBe('a-model');
  });

  it('says how much of the prompt the provider had already read', () => {
    // The one place a caching failure is visible: a number that was under
    // yesterday's answers and is not under today's.
    expect(open({ meta: { ...MESSAGE.meta, cachedTokens: 1100 } })).toBe(
      'a-model  ·  1.2k in · 340 out · 1.1k cached',
    );
    // And nothing at all from an endpoint that does not count it, which is
    // most of them and every local one.
    expect(open({})).not.toContain('cached');
  });

  it('says a message was edited', () => {
    expect(open({ editedAt: '2026-01-02T00:00:00.000Z' })).toContain('edited');
  });

  it('says nothing at all about a turn that failed; the bubble says it instead', () => {
    expect(open({ meta: { model: 'a-model', error: 'The endpoint refused: 502.' } })).toBe('');
  });
});

/**
 * The bubble a failed turn leaves behind is the only thing on the page that
 * offers to spend money, so what each of its buttons does — and which of them
 * only changes a setting — has to be exact.
 */
describe('MessageItem, when the turn failed', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<MessageItem>>;
  let asked: number;
  let dismissed: number;
  let budgets: number[];

  const host = () => fixture.nativeElement as HTMLElement;

  function open(meta: ChapterMessage['meta']): void {
    fixture = TestBed.createComponent(MessageItem);
    fixture.componentRef.setInput('message', { ...MESSAGE, content: '', meta });
    fixture.componentInstance.regenerate.subscribe(() => asked++);
    fixture.componentInstance.remove.subscribe(() => dismissed++);
    fixture.componentInstance.setContext.subscribe((budget) => budgets.push(budget));
    fixture.detectChanges();
  }

  function click(name: string): void {
    const button = [...host().querySelectorAll<HTMLButtonElement>('.error-actions button')].find(
      (candidate) => candidate.textContent.trim() === name,
    );
    if (!button) throw new Error(`no button called ${name}`);
    button.click();
    fixture.detectChanges();
  }

  beforeEach(() => {
    asked = 0;
    dismissed = 0;
    budgets = [];
    TestBed.configureTestingModule({});
  });

  it('says what went wrong, and offers to ask again', () => {
    open({ model: 'a-model', error: 'The endpoint refused: 502.' });

    expect(host().querySelector('.error')?.textContent.trim()).toBe('The endpoint refused: 502.');
    click('Try again');
    expect(asked).toBe(1);
  });

  it('offers to take the bubble away without asking again', () => {
    open({ model: 'a-model', error: 'The endpoint refused: 502.' });

    click('Dismiss');
    expect(dismissed).toBe(1);
    expect(asked).toBe(0);
  });

  it('offers a budget that fits when the endpoint named its window', () => {
    open({
      model: 'a-model',
      error: 'This model takes 8192 tokens.',
      contextLimit: { window: 8192, requested: 19004, budget: 16384 },
    });

    click('Set context to 7680');
    expect(budgets).toEqual([7680]);
    // Offered, never taken: the setting changed and nothing was sent.
    expect(asked).toBe(0);
    expect(host().textContent).toContain('Context budget set to 7680.');
  });

  it('makes no offer at all when the endpoint named no window', () => {
    open({
      model: 'a-model',
      error: 'The request was too long.',
      contextLimit: { requested: 19004, budget: 16384 },
    });

    const labels = [...host().querySelectorAll('.error-actions button')].map((button) =>
      button.textContent.trim(),
    );
    expect(labels).toEqual(['Try again', 'Dismiss']);
  });
});
