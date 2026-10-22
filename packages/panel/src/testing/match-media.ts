/**
 * match-media.ts -- the browser's `matchMedia`, which jsdom lacks, answering every query as a desktop with a mouse would: no match.
 *
 * jsdom lays nothing out and answers no media query, so a module that asks
 * the window, the composer asking whether the pointer is a finger, would
 * find no `matchMedia` to call. Here no query matches, which is a mouse's
 * fine pointer, motion unreduced, and the light appearance; a test that
 * needs another answer stubs `matchMedia` itself. Installed for every test
 * file by the suite's setup wherever the environment has none of its own.
 */

/** A media query's answer that never matches and never changes. */
function unmatched(query: string): MediaQueryList {
  const ignore = () => undefined;
  return {
    matches: false,
    media: query,
    onchange: null,
    addEventListener: ignore,
    removeEventListener: ignore,
    addListener: ignore,
    removeListener: ignore,
    dispatchEvent: () => false,
  };
}

globalThis.matchMedia ??= unmatched;
