/**
 * When the one-time spoken introduction runs and how long its handoff waits.
 * The decisions are pure so they can be tested without Electron; the takeover
 * is a fullscreen mode of the panel, and the wiring that acts on these lives
 * in the desktop's window service.
 */

/**
 * How long the handoff waits for the panel beneath the takeover to report
 * being drawn before the window follows anyway.
 *
 * The panel draws its capsule at the notch inside the surface the takeover
 * still covers, so the window shrinking to that capsule's own bounds
 * afterwards moves nothing on screen. A panel that never reports must not
 * leave a window covering the whole display, which is what bounds the wait.
 */
export const INTRODUCTION_HANDOFF_READY_MS = 2_000;

/**
 * Whether this launch gives the introduction. Only a launch that requires an
 * account can: a fixture or capture run is deterministic and offline, and a
 * signed-in launch — an upgrade, a relaunch — has already met Luke. A
 * completion on file means it was given to the end once; an introduction
 * abandoned partway (a quit, a voice that never connected) writes nothing and
 * so replays, because a moment nobody saw was not the one moment this plays.
 */
export function shouldRunIntroduction(input: {
  requiresAccount: boolean;
  signedIn: boolean;
  completed: boolean;
}): boolean {
  return input.requiresAccount && !input.signedIn && !input.completed;
}
