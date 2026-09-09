import { DestroyRef, Injectable, Injector, Signal, effect, inject, untracked } from '@angular/core';
import { Layout } from '../core/layout';

/**
 * A drag that starts within `EDGE_ZONE` of the right-hand side and travels
 * `SWIPE_DISTANCE` to the left, further across than up or down, is the sheet
 * being pulled out. The zone is narrow and the direction is checked so that a
 * finger scrolling the page near the edge is never mistaken for one.
 */
const EDGE_ZONE = 24;
const SWIPE_DISTANCE = 48;

/** What a sheet has to say about itself for the three gestures to work. */
export interface PhoneSheetHost {
  /** Whether the sheet is showing. */
  readonly open: Signal<boolean>;
  /**
   * Whether it is covering the page rather than standing beside it. A sheet
   * that is part of the page has nothing to dismiss and no way out to offer.
   */
  readonly overlay: Signal<boolean>;
  /** Opened and closed. Every way of doing either goes through this. */
  setOpen(open: boolean): void;
  /**
   * Whether something is on top of the sheet, so Escape belongs to that and
   * not to this.
   *
   * A function rather than a signal, because what can be on top — a modal, a
   * menu opened from inside the sheet — is not signal state, and so has to be
   * asked at the moment the key is pressed rather than watched.
   */
  covered(): boolean;
}

/**
 * The three gestures that make a panel behave like a sheet on a phone: pulled
 * in from the edge, dismissed by Escape, and closed by the back gesture.
 *
 * None of them is about what is *in* the sheet, which is why they are not in
 * the component: the chapter panel is a column of fields, and it had a swipe
 * recogniser, a `history` entry and a keyboard arbitration in the middle of
 * them. Whoever next adds a field to that panel should not have to read a
 * touch handler to do it.
 *
 * Provided by the component rather than by the root injector — a second phone
 * sheet would be a second set of gestures, and they must not share a history
 * entry — and configured through {@link follow}, once, from its constructor.
 */
@Injectable()
export class PhoneSheet {
  private readonly layout = inject(Layout);
  private readonly injector = inject(Injector);

  private sheet: PhoneSheetHost | null = null;

  /** Where a drag from the right-hand edge started, while it is still a drag. */
  private swipe: { x: number; y: number } | null = null;

  /** Whether the history entry standing for the open sheet is ours to pop. */
  private pushed = false;

  /**
   * The sheet this is the gestures for. Called once, from the component's
   * constructor, and everything below is aimed at whatever it hands over.
   */
  follow(sheet: PhoneSheetHost): void {
    this.sheet = sheet;
    this.followWithHistory();
    this.listen();
  }

  private listen(): void {
    const back = () => this.onBack();
    const key = (event: KeyboardEvent) => this.onKey(event);
    addEventListener('popstate', back);
    // Capture, and this is the whole reason: the CDK closes a menu on Escape
    // from a listener on `document.body`, which is inside this one and so
    // bubbles first. Asked afterwards, every trigger says its menu is shut and
    // the sheet takes the key for itself — which is the panel disappearing
    // along with the menu somebody opened out of it. On the way down, nothing
    // has answered yet and the question has an answer.
    document.addEventListener('keydown', key, true);

    // By hand, and passive, rather than as host listeners. A host listener
    // runs a change detection pass after every event it takes, and `touchmove`
    // fires all the way down a scroll — for a handler whose answer is almost
    // always "not this one". The single move that does open the sheet sets a
    // signal, which schedules a pass by itself.
    const touch = { passive: true } as const;
    const start = (event: TouchEvent) => this.onTouchStart(event);
    const move = (event: TouchEvent) => this.onTouchMove(event);
    const end = () => (this.swipe = null);
    document.addEventListener('touchstart', start, touch);
    document.addEventListener('touchmove', move, touch);
    document.addEventListener('touchend', end, touch);
    document.addEventListener('touchcancel', end, touch);

    this.injector.get(DestroyRef).onDestroy(() => {
      removeEventListener('popstate', back);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', end);
    });
  }

  /**
   * The back gesture closes the sheet, because on a phone it is the first
   * thing a reader will try and the alternative is leaving the app mid-story.
   *
   * A history entry is pushed when the sheet opens and popped when it closes,
   * whichever way it was closed — so the two stay in step and back never has
   * to guess. Watching `open` rather than doing this inside the openers is
   * what makes that true: the menu, the shortcut, the swipe and the settings
   * document all set the same signal, and only one of them is on this file.
   *
   * The state it opens in is not pushed. A phone that reloads with the panel
   * remembered open has one screen of history, and back should still be the
   * way out of the app.
   */
  private followWithHistory(): void {
    const sheet = this.sheet!;
    let shown = untracked(sheet.open);
    effect(
      () => {
        const open = sheet.open();
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
      },
      { injector: this.injector },
    );
  }

  /** The gesture itself: our entry is gone, so the sheet goes with it. */
  private onBack(): void {
    if (!this.pushed) return;
    this.pushed = false;
    this.sheet!.setOpen(false);
  }

  /**
   * Escape belongs to whatever is on top of everything else, and the sheet is
   * the one that asks — a modal is over it, and so is a menu opened from
   * inside it. A sheet that is part of the page has nothing to dismiss.
   *
   * `defaultPrevented` cannot be the test: the prose editor marks Escape
   * handled whenever it has the focus, which in this panel is most of the time.
   */
  private onKey(event: KeyboardEvent): void {
    const sheet = this.sheet!;
    if (event.key !== 'Escape' || sheet.covered()) return;
    if (sheet.open() && sheet.overlay()) sheet.setOpen(false);
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
    if (!this.layout.phone() || this.sheet!.open() || event.touches.length !== 1) return;
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
    this.sheet!.setOpen(true);
  }
}
