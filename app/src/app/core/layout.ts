import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/**
 * The questions about the window that CSS cannot answer for us.
 *
 * Most of the answer is CSS and belongs there — `breakpoints.scss` has the
 * widths and the mixins, and a rule that only changes how something looks
 * should use them and never come here. This is for the three things a media
 * query cannot do: decide which items a menu is built out of, decide what a
 * key means, and decide whether the panel takes its width out of the page or
 * lies over it, which is a class on an element rather than a rule.
 *
 * Every width is read off `<html>` rather than written down again, because
 * `styles.scss` publishes them from the Sass variables the mixins use. Two
 * numbers that had to agree would eventually not.
 */
@Injectable({ providedIn: 'root' })
export class Layout {
  /** The phone layout: not enough room for the bar, the panel and a modal. */
  readonly phone = this.watch(`(max-width: ${width('--li-phone-width', '48rem')})`);

  /**
   * Room for the panel beside the page: above this it pushes, below it covers.
   * Read by the panel itself, which draws the scrim and takes Escape.
   */
  readonly roomForPanel = this.watch(`(min-width: ${width('--li-panel-push-width', '69rem')})`);

  /**
   * A finger rather than a pointer, which is a different question: a narrow
   * window on a laptop is the phone layout with a keyboard still attached.
   */
  readonly coarse = this.watch('(pointer: coarse)');

  private watch(query: string) {
    const media = matchMedia(query);
    const matches = signal(media.matches);
    const listen = () => matches.set(media.matches);
    media.addEventListener('change', listen);
    inject(DestroyRef).onDestroy(() => media.removeEventListener('change', listen));
    return matches.asReadonly();
  }
}

/**
 * One of the widths, from the stylesheet. The fallback is for a test running
 * without one — jsdom resolves no custom properties — and is the same number
 * written in `breakpoints.scss`, which is the only place either is ever
 * changed.
 */
function width(property: string, fallback: string): string {
  const declared = getComputedStyle(document.documentElement).getPropertyValue(property).trim();
  return declared || fallback;
}
