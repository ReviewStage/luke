import type { MicrophoneStatus } from "../shared/contracts";

/** What the row says beneath its name, once the system has answered. */
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
  /**
   * Whether to offer the way to System Settings. Only where macOS has already
   * been answered: that is the one place its answer can be changed, and the one
   * state where sending someone there is not sending them to look at nothing.
   */
  offerSystemSettings: boolean;
  /** Whether the microphone is Luke's to open. */
  ready: boolean;
}

/**
 * Reads the row from the system's answer and whether there is anything to talk
 * to.
 *
 * The microphone has exactly one use here, so without a voice to answer it the
 * row has nothing to ask for. Asking anyway would raise the macOS prompt — the
 * one place the user agrees to their voice reaching OpenAI — on behalf of a
 * feature that cannot run, and would leave the permission granted for a use
 * that never happens.
 */
export function microphoneAccessRow(input: {
  voiceAvailable: boolean;
  status: MicrophoneStatus;
}): MicrophoneAccessRow {
  if (!input.voiceAvailable) {
    return {
      // Names what to do rather than what is missing, and what to do is now
      // something the panel offers: the OpenAI key, under Integrations.
      detail: "Luke opens the microphone only to talk, which needs the OpenAI key.",
      offerAccess: false,
      offerSystemSettings: false,
      ready: false,
    };
  }
  return {
    detail: MICROPHONE_STATUS_DETAIL[input.status],
    offerAccess: input.status === "not-determined",
    offerSystemSettings: input.status === "granted" || input.status === "denied",
    ready: input.status === "granted",
  };
}
