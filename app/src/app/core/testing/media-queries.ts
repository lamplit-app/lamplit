/**
 * A media-query engine, for a document that has not got one.
 *
 * jsdom ships no `matchMedia` at all, and `core/layout.ts` asks it four
 * questions — the phone width, the panel width, a coarse pointer, and the
 * theme the machine is in. Two specs kept a stand-in of their own and both
 * were the same handful of fields cast through `unknown` into a real
 * `MediaQueryList`: the kind of cast that compiles no matter what is missing
 * from it. Here the return type is the interface itself, so the compiler is
 * what says the stand-in is complete.
 *
 * Beside `core/`, because what it stands in for is what `core/layout.ts` asks;
 * the documents' fake lives beside `store/` for the same reason.
 */
export function stubMatchMedia(matches: (query: string) => boolean): void {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: matches(query),
    media: query,
    onchange: null,
    // Both spellings of the listener. The CDK, which every Material overlay in
    // a component spec goes through, still uses the deprecated pair — and a
    // half-written stand-in is worse than none, because without `matchMedia`
    // at all the CDK has a fallback of its own and defining it takes that away.
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  });
}

/**
 * Nothing matches, which is the right answer for a component spec: it is this
 * app with a keyboard in front of it and room for the panel. Anything that
 * asserts the phone layout belongs in `e2e/specs/phone`, where there is a real
 * viewport to be narrow.
 */
export const NOTHING_MATCHES = (): boolean => false;

/** A desktop that is in its dark theme, and says so when asked. */
export const MACHINE_IS_DARK = (query: string): boolean => query.includes('dark');
