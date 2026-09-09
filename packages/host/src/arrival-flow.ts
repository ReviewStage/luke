import type { OnboardingState } from "./onboarding-state.js";

/**
 * When the spoken arrival beat is owed, and when the account's first spoken
 * announcement counts.
 *
 * The beat exists because sign-in is where new developers stall: Luke's loop
 * is reactive, and nothing says "you're done here — go work, and you'll be
 * told". So the one time an account arrives, Luke says exactly that aloud,
 * on the same speak-only terms as an edge announcement. It is owed from the
 * first sign-in until its reply actually begins, as the voice window
 * reports; a launch that cannot speak it — no credential, a meeting's quiet,
 * a beat the announcer dropped unspoken — leaves it owed, so the next
 * signed-in launch that can speak does, because a moment nobody heard was
 * not the one moment this plays.
 */

/**
 * Whether the arrival beat is still owed: an observed sign-in that has never
 * been spoken to. Only the beat's reply actually beginning settles it — a
 * send the renderer never heard, or a beat the announcer dropped unspoken,
 * leaves it standing for the next launch that can say it.
 */
export function arrivalBeatOwed(state: OnboardingState | undefined): boolean {
  return state?.arrivalSignedInAt !== undefined && state.arrivalSpokenAt === undefined;
}

/**
 * Whether the next spoken announcement is the account's first, worth counting
 * against the sign-in it followed. Independent of the beat: the count
 * measures the loop proving itself, not the arrival being said.
 */
export function countsFirstAnnouncement(state: OnboardingState | undefined): boolean {
  return state?.arrivalSignedInAt !== undefined && state.arrivalFirstAnnouncementAt === undefined;
}
