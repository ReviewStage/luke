import type { OnboardingState } from "./onboarding-state.js";

/**
 * When the calendar step of onboarding stands.
 *
 * The step exists because Luke's quiet during meetings can only hold what he
 * can see: announcements land mid-meeting exactly for the developer who never
 * found the calendar rows in settings. So onboarding does not end at the
 * sign-in — from the first sign-in this install observes, the panel stands a
 * gate asking for a calendar, and it stands until it is answered: Done
 * confirming the connected calendars, or the gate's own quiet skip declining
 * the step for good. A connection alone leaves it standing, so which
 * calendars count can be chosen and another account added first. Connecting
 * is still the user's own press through the same consent flows the settings
 * rows run; the gate changes when the ask is made, never what it may do.
 */

/**
 * Whether the gate is still owed: a sign-in observed under the step that no
 * Done has settled and no press on the gate's own skip has declined. Both
 * are answers; a quit is not — quitting at the gate and relaunching finds it
 * standing again, because a step a quit could dodge would never be answered
 * at all.
 */
export function calendarOnboardingOwed(state: OnboardingState | undefined): boolean {
  return (
    state?.calendarOnboardingRequiredAt !== undefined &&
    state.calendarOnboardingSettledAt === undefined &&
    state.calendarOnboardingSkippedAt === undefined
  );
}
