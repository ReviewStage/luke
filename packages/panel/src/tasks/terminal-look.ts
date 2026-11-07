/**
 * terminal-look.ts -- the classes an agent's Terminal tab's room wears (`terminal-tab.tsx`).
 *
 * The screen and the shells beside it stand in a body on the terminal's own
 * ground; the list slides in past the body's right edge and out over the
 * screen, so the body clips what stands past it, with `clip` rather than
 * `hidden`, as a File tab's body does, and is the box the leaving list
 * stands against.
 */

/** The body the screen and the shells stand in. */
export const TERMINAL_BODY_CLASS = "terminal-tab-body relative bg-terminal-ground";

/** The column the screen fills beside the shells. */
export const TERMINAL_HOST_CLASS = "terminal-tab-host flex min-w-0 flex-1 flex-col";

/** The box the terminal's screen is shown in, which the screen fills. */
export const TERMINAL_SCREEN_CLASS = "terminal-tab-screen relative min-h-0 flex-1";
