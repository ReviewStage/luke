/**
 * motion-held.ts -- motion held still as a stylesheet holds it, which jsdom draws none of.
 *
 * Reduced motion and a capture run hold motion by zeroing the duration tokens,
 * and a script asks those (`motionHeld`), so a test that wants a plan drawn at
 * once, or a pointer held still, stands the token at the one the setting leaves.
 */

const DURATION_FAST = "--luke-duration-fast";

/** Holds motion still on the document, as reduced motion does; undone by `releaseMotion`. */
export function holdMotion(): void {
  document.documentElement.style.setProperty(DURATION_FAST, "1ms");
}

/** Lets motion play again, as the document stood before `holdMotion`. */
export function releaseMotion(): void {
  document.documentElement.style.removeProperty(DURATION_FAST);
}
