import type { BrowserCommand } from "vitest/node";

/**
 * browser-commands.ts -- what a browser test asks of the browser driving it
 * rather than of the page: the media features a visitor's system sets, which
 * no script in the page can change.
 */

/** Emulates a system that asked for reduced motion, or one that did not. */
export const emulateReducedMotion: BrowserCommand<[reduced: boolean]> = async (
  { page },
  reduced,
) => {
  await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
};
