import type { MicrophoneStatus } from "../shared/contracts";

/** What the state means for talking, which is the only thing it decides. */
const MICROPHONE_STATUS_DETAIL: Record<MicrophoneStatus, string> = {
  granted: "Speech is sent only while a turn is open, and never recorded.",
  "not-determined": "macOS will ask the first time you press the talk key.",
  denied: "Allow Luke in System Settings › Privacy & Security › Microphone.",
  restricted: "This Mac does not permit microphone access.",
  unknown: "Luke could not read the microphone permission.",
};

const MICROPHONE_STATUS_LABEL: Record<MicrophoneStatus, string> = {
  "not-determined": "Not requested yet",
  granted: "Granted",
  denied: "Denied in System Settings",
  restricted: "Restricted by this Mac",
  unknown: "Unknown",
};

/** What the Microphone row says, and what it offers. */
export interface MicrophoneAccessRow {
  label: string;
  detail: string;
  /** Whether to offer the button that raises the system prompt. */
  offerAccess: boolean;
  /** Whether Luke is both allowed the microphone and able to use it. */
  ready: boolean;
}

/**
 * Reads the row from the permission and from whether there is anything to talk
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
      label: "Not used",
      detail: "Luke opens the microphone only to talk, and talking needs OPENAI_API_KEY.",
      offerAccess: false,
      ready: false,
    };
  }
  return {
    label: MICROPHONE_STATUS_LABEL[input.status],
    detail: MICROPHONE_STATUS_DETAIL[input.status],
    offerAccess: input.status === "not-determined",
    ready: input.status === "granted",
  };
}
