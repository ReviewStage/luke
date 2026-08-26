import { isRecord, text, type UnparsedWireValue } from "@sidecar/wire";

/**
 * When the spoken arrival beat is owed, and how the account's first sign-in
 * and first spoken announcement are remembered. The decisions are pure so
 * they can be tested without Electron, on the introduction flow's own
 * pattern; the wiring that acts on them lives in desktop-app.
 *
 * The beat exists because sign-in is where new developers stall: Luke's loop
 * is reactive, and nothing says "you're done here — go work, and you'll be
 * told". So the one time an account arrives, Luke says exactly that aloud,
 * on the same speak-only terms as an edge announcement. It is owed from the
 * first sign-in until it is actually handed to the voice; a launch that
 * cannot speak it — no credential, a meeting's quiet — leaves it owed, so
 * the next signed-in launch that can speak does, because a moment nobody
 * heard was not the one moment this plays.
 */

/**
 * The arrival record, beside `introduction.json` in the app's own state
 * directory. Unlike the introduction's, a missing file does not simply mean
 * "not yet": an install that was already signed in before this file existed
 * has been living with Luke for some time, so the launch backfills a settled
 * record rather than greeting a veteran as an arrival.
 */
export const ARRIVAL_STATE_FILE = "arrival.json";

export interface ArrivalState {
  /**
   * When the account's first sign-in landed. Absent on a backfilled record,
   * which is what keeps the first-announcement count honest: an install whose
   * sign-in was never observed has no elapsed time worth reporting.
   */
  signedInAt?: string;
  /**
   * When the beat stopped being owed: it was handed to the voice, or — on a
   * backfilled record — the install was recognized as predating it.
   */
  settledAt?: string;
  /** When the first announcement after that sign-in was spoken. */
  firstAnnouncementAt?: string;
}

/**
 * Reads a stored record, or nothing for a file that is missing or does not
 * parse. "Nothing" means "no record", which the launch turns into a backfill —
 * the safe direction, since a backfill can only ever withhold the beat and the
 * count, never replay one already given.
 */
export function arrivalStateFromStored(stored: string | undefined): ArrivalState | undefined {
  if (stored === undefined) return undefined;
  let parsed: UnparsedWireValue;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const signedInAt = text(parsed.signedInAt);
  const settledAt = text(parsed.settledAt);
  const firstAnnouncementAt = text(parsed.firstAnnouncementAt);
  return {
    ...(signedInAt !== undefined ? { signedInAt } : undefined),
    ...(settledAt !== undefined ? { settledAt } : undefined),
    ...(firstAnnouncementAt !== undefined ? { firstAnnouncementAt } : undefined),
  };
}

/** The record the state persists as. */
export function arrivalRecord(state: ArrivalState): string {
  return `${JSON.stringify(state)}\n`;
}

/**
 * Whether the arrival beat is still owed: an observed sign-in that has never
 * been spoken to. Only handing the beat to the voice settles it — a launch
 * that could not speak leaves it standing for the next one that can.
 */
export function arrivalBeatOwed(state: ArrivalState | undefined): boolean {
  return state?.signedInAt !== undefined && state.settledAt === undefined;
}

/**
 * Whether the next spoken announcement is the account's first, worth counting
 * against the sign-in it followed. Independent of the beat: the count
 * measures the loop proving itself, not the arrival being said.
 */
export function countsFirstAnnouncement(state: ArrivalState | undefined): boolean {
  return state?.signedInAt !== undefined && state.firstAnnouncementAt === undefined;
}

/**
 * Whether this launch should write a settled record without speaking anything.
 * A signed-in launch with no record predates the arrival beat — its sign-in
 * was never observed — and without the record on file, a later sign-out and
 * sign-in would greet someone months in as an arrival. Only an interactive
 * launch may write it: a fixture or capture run observes no accounts at all.
 */
export function shouldBackfillArrivalSettled(input: {
  requiresAccount: boolean;
  signedIn: boolean;
  hasRecord: boolean;
}): boolean {
  return input.requiresAccount && input.signedIn && !input.hasRecord;
}
