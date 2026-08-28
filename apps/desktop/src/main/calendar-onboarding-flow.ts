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
 * gate asking for a calendar, and it stands until it is answered: a calendar
 * connecting, or the gate's own quiet skip declining the step for good.
 * Connecting is still the user's own press through the same consent flows the
 * settings rows run; the gate changes when the ask is made, never what it may
 * do.
 */

/**
 * The calendar onboarding record, beside `arrival.json` in the app's own
 * state directory. Like the arrival's, a missing file does not simply mean
 * "not yet": an install that was already signed in before this file existed
 * finished its onboarding under the old terms, so the launch backfills a
 * settled record rather than gating a veteran.
 */
export const CALENDAR_ONBOARDING_STATE_FILE = "calendar-onboarding.json";

export interface CalendarOnboardingState {
  /**
   * When the install's first observed sign-in put the gate up. Absent on a
   * backfilled record, whose sign-in predates the gate existing at all.
   */
  requiredAt?: string;
  /**
   * When the gate stopped standing: a calendar connected, or — on a
   * backfilled record — the install was recognized as predating the step.
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
 * parse. "Nothing" means "no record", which the launch turns into a backfill —
 * the safe direction, since a backfill can only ever stand the gate down,
 * never raise it over someone who already passed it.
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
 * calendar connection has settled and no press on the gate's own skip has
 * declined. Both are answers; a quit is not — quitting at the gate and
 * relaunching finds it standing again, because a step a quit could dodge
 * would never be answered at all.
 */
export function calendarOnboardingOwed(state: CalendarOnboardingState | undefined): boolean {
  return (
    state?.requiredAt !== undefined &&
    state.settledAt === undefined &&
    state.skippedAt === undefined
  );
}

/**
 * Whether this launch should write a settled record without gating anything.
 * A signed-in launch with no record predates the calendar step — its sign-in
 * was never observed by it — and without the record on file, an update would
 * raise an onboarding gate over someone months in. Only an interactive launch
 * may write it: a fixture or capture run observes no accounts at all.
 */
export function shouldBackfillCalendarOnboardingSettled(input: {
  requiresAccount: boolean;
  signedIn: boolean;
  hasRecord: boolean;
}): boolean {
  return input.requiresAccount && input.signedIn && !input.hasRecord;
}
