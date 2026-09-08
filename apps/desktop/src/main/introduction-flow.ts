import { isRecord, text, type UnparsedWireValue } from "@sidecar/wire";

/**
 * When the one-time spoken introduction runs, and how its completion is
 * remembered. The decisions are pure so they can be tested without Electron;
 * the takeover window and the wiring that acts on them live in desktop-app
 * and window/introduction-window.
 */

/**
 * The introduction's completion record, beside `last-run-version.json` in the
 * app's own state directory and under the same idiom: a missing or unreadable
 * file means the introduction has never finished, which is exactly the answer
 * a fresh install must get.
 */
export const INTRODUCTION_STATE_FILE = "introduction.json";

/**
 * How recently a detected session must have moved to be worth introducing.
 * The roster keeps a waiting session forever — an unanswered question stays
 * news — but "these are your coding agents" said over a transcript from last
 * year introduces a graveyard; a week covers anyone's current work.
 */
export const INTRODUCTION_PEEK_FRESH_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long the handoff waits for the real panel's renderer to report ready
 * before the takeover fades anyway: the crossfade must land on a drawn gate,
 * not a window still loading, but a panel that never reports must not hold
 * the introduction open forever.
 */
export const INTRODUCTION_HANDOFF_READY_MS = 2_000;

/**
 * How long the takeover's fade runs once the panel beneath is ready — the
 * window is destroyed only after it, so the sessions dissolve into the gate
 * rather than vanishing with the window.
 */
export const INTRODUCTION_FADE_MS = 600;

/**
 * How long the takeover has to report that it mounted before the launch
 * abandons it. A takeover whose renderer never drew is a fullscreen window
 * swallowing every click with nothing on it — the one failure this feature
 * must not be able to reach — and every ordinary ending is that renderer's
 * own report, so the deadline is the main process's to keep.
 */
export const INTRODUCTION_RENDER_DEADLINE_MS = 15_000;

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

/** Whether a stored record says the introduction finished. */
export function introductionCompleted(stored: string | undefined): boolean {
  if (stored === undefined) return false;
  try {
    const parsed: UnparsedWireValue = JSON.parse(stored);
    return isRecord(parsed) && text(parsed.completedAt) !== undefined;
  } catch {
    return false;
  }
}

/** The record a finished introduction persists. */
export function introductionRecord(completedAtIso: string): string {
  return `${JSON.stringify({ completedAt: completedAtIso })}\n`;
}
