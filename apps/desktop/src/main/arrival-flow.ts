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
 * first sign-in until its reply actually begins, as the voice window
 * reports; a launch that cannot speak it — no credential, a meeting's quiet,
 * a beat the announcer dropped unspoken — leaves it owed, so the next
 * signed-in launch that can speak does, because a moment nobody heard was
 * not the one moment this plays.
 */

/** The arrival record, beside `introduction.json` in the app's own state directory. */
export const ARRIVAL_STATE_FILE = "arrival.json";

export interface ArrivalState {
  /** When the account's first sign-in landed, as this install observed it. */
  signedInAt?: string;
  /** When the beat stopped being owed: its reply actually began. */
  settledAt?: string;
  /** When the first announcement after that sign-in was spoken. */
  firstAnnouncementAt?: string;
}

/**
 * Reads a stored record, or nothing for a file that is missing or does not
 * parse. "Nothing" means "no sign-in was ever observed", which owes no beat:
 * the safe direction, since it can only withhold the beat, never replay one.
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
 * been spoken to. Only the beat's reply actually beginning settles it — a
 * send the renderer never heard, or a beat the announcer dropped unspoken,
 * leaves it standing for the next launch that can say it.
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
