import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/**
 * The questions about the window that CSS cannot answer for us.
 *
 * Most of the answer is CSS and belongs there — `breakpoints.scss` has the
 * widths and the mixins, and a rule that only changes how something looks
 * should use them and never come here. This is for the four things a media
 * query cannot do: decide which items a menu is built out of, decide what a
 * key means, decide whether the panel takes its width out of the page or lies
 * over it, which is a class on an element rather than a rule, and hand the
 * theme the machine is in to something that is not a stylesheet.
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

  /**
   * The theme the rest of the desktop is in, and the third of the three
   * preferences the reader's machine answers. The other two are settled in the
   * stylesheet — a media query and an attribute over it — and this one cannot
   * be: which of two colours a character's name is drawn in is decided in
   * TypeScript, and there is no rule that can say it.
   *
   * `SettingsStore.theme` is the one reader, and it is where this and the
   * setting are put together. A signal rather than the question asked at the
   * moment of drawing, so a desktop that turns dark at sunset takes the app
   * with it.
   */
  readonly prefersDark = this.watch('(prefers-color-scheme: dark)');

  /**
   * One query, as a signal that keeps up with it.
   *
   * `matchMedia` is asked for rather than assumed, for the reason
   * `theming.ts` gives beside `wantsContrast`: a unit test has a document but
   * not a browser's worth of window, and jsdom ships no media-query engine at
   * all. Nothing matching is the right answer there — a spec is this app with
   * a keyboard in front of it and room for the panel — and it is a better one
   * than a service that throws on construction for every spec that reaches a
   * store.
   */
  private watch(query: string) {
    if (typeof matchMedia !== 'function') return signal(false).asReadonly();
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
