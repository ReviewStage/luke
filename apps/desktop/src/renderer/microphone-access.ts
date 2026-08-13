import type { MicrophoneStatus } from "../shared/contracts";

/**
 * What the row says beneath its name, once the two answers above it are in.
 *
 * Two things have to agree before Luke can listen: macOS has to have granted
 * the microphone, and Luke has to have been left holding it. They fail
 * differently and are fixed in different places, so they are never collapsed
 * into one sentence.
 */
const MICROPHONE_STATUS_DETAIL: Record<MicrophoneStatus, string> = {
  granted: "Speech is sent only while a turn is open, and never recorded.",
  "not-determined": "macOS will ask the first time you press the talk key.",
  denied: "Allow Luke in System Settings › Privacy & Security › Microphone.",
  restricted: "This Mac does not permit microphone access.",
  unknown: "Luke could not read the microphone permission.",
};

/** What the Microphone row says, and what it offers. */
export interface MicrophoneAccessRow {
  detail: string;
  /** Whether to offer the button that gives Luke the microphone. */
  offerAccess: boolean;
  /** Whether to offer the button that takes it back. */
  offerRevoke: boolean;
  /**
   * Whether to offer the way to System Settings. Only where macOS has already
   * been answered: that is the one place its answer can be changed, and the one
   * state where sending someone there is not sending them to look at nothing.
   */
  offerSystemSettings: boolean;
  /** Whether Luke is both allowed the microphone and able to use it. */
  ready: boolean;
}

/**
 * Reads the row from the system's answer, Luke's own, and whether there is
 * anything to talk to.
 *
 * The microphone has exactly one use here, so without a voice to answer it the
 * row has nothing to ask for. Asking anyway would raise the macOS prompt — the
 * one place the user agrees to their voice reaching OpenAI — on behalf of a
 * feature that cannot run, and would leave the permission granted for a use
 * that never happens.
 */
export function microphoneAccessRow(input: {
  voiceAvailable: boolean;
  allowed: boolean;
  status: MicrophoneStatus;
}): MicrophoneAccessRow {
  if (!input.voiceAvailable) {
    return {
      detail: "Luke opens the microphone only to talk, and talking needs OPENAI_API_KEY.",
      offerAccess: false,
      offerRevoke: false,
      offerSystemSettings: false,
      ready: false,
    };
  }
  if (!input.allowed) {
    return {
      // Said plainly, because it is the one state where Luke's answer and the
      // system's disagree, and a row that claimed macOS had taken the
      // microphone back would be describing something that did not happen.
      detail:
        "You have taken this back. macOS still lists Luke as allowed until you change it there.",
      offerAccess: true,
      offerRevoke: false,
      offerSystemSettings: true,
      ready: false,
    };
  }
  return {
    detail: MICROPHONE_STATUS_DETAIL[input.status],
    offerAccess: input.status === "not-determined",
    // Nothing to take back until there is something to take: a permission never
    // granted is not held, and one the system refuses is not Luke's to return.
    offerRevoke: input.status === "granted",
    offerSystemSettings: input.status === "granted" || input.status === "denied",
    ready: input.status === "granted",
  };
}
