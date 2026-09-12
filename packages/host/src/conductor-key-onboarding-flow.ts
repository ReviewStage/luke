import type { OnboardingState } from "./onboarding-state.js";

/**
 * When the Conductor key step of onboarding stands.
 *
 * The step exists because the roster is empty until the service holds a
 * Conductor key, and an empty desk with nothing said about it reads as a
 * broken one. So from the first sign-in this install observes, once the
 * spoken introduction has been given, the panel stands a gate asking for the
 * key ahead of the calendar step and ahead of any row, and it stands until
 * it is answered: the vault coming to hold a key, through the same entry the
 * Connections row runs and the same vault-only write, or the gate's own quiet
 * skip declining the step for good. No fixture row ever stands in for the
 * desk behind it; a skipped step leaves the list honestly empty, saying no
 * provider is connected. A quit is not an answer: quitting at the gate and
 * relaunching finds it standing again.
 */
export function conductorKeyOnboardingOwed(state: OnboardingState | undefined): boolean {
  return (
    state?.conductorKeyOnboardingRequiredAt !== undefined &&
    state.conductorKeyOnboardingSettledAt === undefined &&
    state.conductorKeyOnboardingSkippedAt === undefined
  );
}
