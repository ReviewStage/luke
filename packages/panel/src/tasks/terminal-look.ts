/**
 * terminal-look.ts -- the classes a Terminal tab's room wears, an agent's sandbox's (`terminal-tab.tsx`) and the Mac's own (`mac-terminal-tab.tsx`) alike.
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

/** The terminal's screen, dimmed rather than blanked under any state with no shell connected. */
export const TERMINAL_SCREEN_CLASS = "terminal-tab-screen min-h-0 flex-1";
