import type { OnboardingState } from "./onboarding-state.js";

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
 * Whether the spoken introduction is owed. The introduction is for a
 * signed-in developer: it is put up by the first sign-in this install ever
 * observes, recorded on disk at that edge, and taken down by a completion,
 * which is written only for a greeting given to its end. A completion never
 * replays; an introduction abandoned partway (a quit, a voice that never
 * connected) writes nothing and so stands owed for the next signed-in launch,
 * because a moment nobody saw was not the one moment this plays. An install
 * that was already signed in before the required moment existed has no edge
 * to record and is never greeted as a stranger on an upgrade. Whether the
 * account is signed in now is the caller's to add: the record says whether
 * the introduction is owed, and the desktop plays it only for the developer
 * it is owed to.
 */
export function introductionOwed(state: OnboardingState | undefined): boolean {
  return state?.introductionRequiredAt !== undefined && state.introductionCompletedAt === undefined;
}
