import { text, type WireRecord } from "@sidecar/wire";
import { type JsonStateFile, jsonStateFile } from "./json-state-file.js";

/** The onboarding record, in the app's own state directory. */
export const ONBOARDING_STATE_FILE = "onboarding.json";

/**
 * The one-time onboarding moments Luke remembers per install: the spoken
 * introduction, the arrival beat, and the calendar step. One record, because
 * every field is written by the same launch and read by the same reconcile.
 */
export interface OnboardingState {
  /**
   * When the install's first observed sign-in owed the spoken introduction.
   * Recorded at that edge alone, so an install already signed in when this
   * build arrived is never greeted as a stranger on an upgrade.
   */
  introductionRequiredAt?: string;
  /** When the spoken introduction finished, to the end. */
  introductionCompletedAt?: string;
  /** When the account's first sign-in landed, as this install observed it. */
  arrivalSignedInAt?: string;
  /** When the arrival beat stopped being owed: its reply actually began. */
  arrivalSpokenAt?: string;
  /** When the first announcement after that sign-in was spoken. */
  arrivalFirstAnnouncementAt?: string;
  /** When the install's first observed sign-in put the calendar gate up. */
  calendarOnboardingRequiredAt?: string;
  /**
   * When the calendar gate stopped standing: Done confirmed the connected
   * calendars, or a calendar already standing was recognized.
   */
  calendarOnboardingSettledAt?: string;
  /**
   * When the user declined the calendar step instead. Its own field rather
   * than a settle, so the record keeps what actually happened, but it stands
   * the gate down the same way.
   */
  calendarOnboardingSkippedAt?: string;
}

/**
 * Reads a stored record, or nothing for one with no moment in it at all. "No
 * record" and "an empty record" are one answer, because every predicate over
 * this state treats an absent moment as never observed — the safe direction,
 * since it can only withhold a beat or a gate, never replay one already given.
 */
function onboardingStateFrom(record: WireRecord): OnboardingState | undefined {
  const introductionRequiredAt = text(record.introductionRequiredAt);
  const introductionCompletedAt = text(record.introductionCompletedAt);
  const arrivalSignedInAt = text(record.arrivalSignedInAt);
  const arrivalSpokenAt = text(record.arrivalSpokenAt);
  const arrivalFirstAnnouncementAt = text(record.arrivalFirstAnnouncementAt);
  const calendarOnboardingRequiredAt = text(record.calendarOnboardingRequiredAt);
  const calendarOnboardingSettledAt = text(record.calendarOnboardingSettledAt);
  const calendarOnboardingSkippedAt = text(record.calendarOnboardingSkippedAt);
  const state: OnboardingState = {
    ...(introductionRequiredAt !== undefined ? { introductionRequiredAt } : undefined),
    ...(introductionCompletedAt !== undefined ? { introductionCompletedAt } : undefined),
    ...(arrivalSignedInAt !== undefined ? { arrivalSignedInAt } : undefined),
    ...(arrivalSpokenAt !== undefined ? { arrivalSpokenAt } : undefined),
    ...(arrivalFirstAnnouncementAt !== undefined ? { arrivalFirstAnnouncementAt } : undefined),
    ...(calendarOnboardingRequiredAt !== undefined ? { calendarOnboardingRequiredAt } : undefined),
    ...(calendarOnboardingSettledAt !== undefined ? { calendarOnboardingSettledAt } : undefined),
    ...(calendarOnboardingSkippedAt !== undefined ? { calendarOnboardingSkippedAt } : undefined),
  };
  return Object.keys(state).length === 0 ? undefined : state;
}

/** The record as it persists: the moments that are actually on it, and no key holding nothing. */
function onboardingRecord(state: OnboardingState): WireRecord {
  const record: Record<string, string> = {};
  for (const [moment, at] of Object.entries(state)) if (at !== undefined) record[moment] = at;
  return record;
}

export function onboardingStateFile(
  directory: () => string,
  report?: (message: string) => void,
): JsonStateFile<OnboardingState> {
  return jsonStateFile<OnboardingState>({
    directory,
    fileName: ONBOARDING_STATE_FILE,
    read: onboardingStateFrom,
    write: onboardingRecord,
    ...(report !== undefined ? { report } : undefined),
  });
}
