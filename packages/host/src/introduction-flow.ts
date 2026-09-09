/**
 * When the one-time spoken introduction runs, how far back a session it
 * detects may have moved, and how long its handoff waits. The decisions are
 * pure so they can be tested without Electron; the takeover is a fullscreen
 * mode of the panel, and the wiring that acts on these lives in the desktop's
 * window service.
 */

/**
 * How recently a detected session must have moved to be worth introducing.
 * The roster keeps a waiting session forever — an unanswered question stays
 * news — but "these are your coding agents" said over a transcript from last
 * year introduces a graveyard; a week covers anyone's current work.
 */
export const INTRODUCTION_PEEK_FRESH_MS = 7 * 24 * 60 * 60 * 1000;

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
