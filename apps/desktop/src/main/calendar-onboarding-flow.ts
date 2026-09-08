import { isRecord, text, type UnparsedWireValue } from "@sidecar/wire";

/**
 * When the calendar step of onboarding stands, and how its settling is
 * remembered. The decisions are pure so they can be tested without Electron,
 * on the introduction flow's own pattern; the wiring that acts on them lives
 * in desktop-app.
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

/** The calendar onboarding record, beside `arrival.json` in the app's own state directory. */
export const CALENDAR_ONBOARDING_STATE_FILE = "calendar-onboarding.json";

export interface CalendarOnboardingState {
  /** When the install's first observed sign-in put the gate up. */
  requiredAt?: string;
  /**
   * When the gate stopped standing: Done confirmed the connected calendars,
   * or a calendar already standing was recognized at a launch or a sign-in.
   */
  settledAt?: string;
  /**
   * When the user declined the step instead. Its own field rather than a
   * settle, so the record keeps what actually happened, but it stands the
   * gate down the same way: a decline is answered once and remembered, never
   * re-asked, and the settings rows stay the way to connect later.
   */
  skippedAt?: string;
}

/**
 * Reads a stored record, or nothing for a file that is missing or does not
 * parse. "Nothing" means "no sign-in was ever observed", which raises no
 * gate: the safe direction, since it can only stand the gate down, never
 * raise it over someone who already passed it.
 */
export function calendarOnboardingStateFromStored(
  stored: string | undefined,
): CalendarOnboardingState | undefined {
  if (stored === undefined) return undefined;
  let parsed: UnparsedWireValue;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const requiredAt = text(parsed.requiredAt);
  const settledAt = text(parsed.settledAt);
  const skippedAt = text(parsed.skippedAt);
  return {
    ...(requiredAt !== undefined ? { requiredAt } : undefined),
    ...(settledAt !== undefined ? { settledAt } : undefined),
    ...(skippedAt !== undefined ? { skippedAt } : undefined),
  };
}

/** The record the state persists as. */
export function calendarOnboardingRecord(state: CalendarOnboardingState): string {
  return `${JSON.stringify(state)}\n`;
}

/**
 * Whether the gate is still owed: a sign-in observed under the step that no
 * Done has settled and no press on the gate's own skip has declined. Both
 * are answers; a quit is not — quitting at the gate and relaunching finds it
 * standing again, because a step a quit could dodge would never be answered
 * at all.
 */
export function calendarOnboardingOwed(state: CalendarOnboardingState | undefined): boolean {
  return (
    state?.requiredAt !== undefined &&
    state.settledAt === undefined &&
    state.skippedAt === undefined
  );
}
