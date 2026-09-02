import { REALTIME_MINT_OUTCOME, type RealtimeDiagnostics } from "@sidecar/realtime";
import type { MicrophoneStatus } from "#shared/wire/audio";
import { VOICE_SOURCE, type VoiceSource } from "#shared/wire/settings";

/**
 * Why voice as a whole is off: nothing it can run on stands — no signed-in
 * account carrying hosted voice, and no key of the developer's own.
 * One sentence, shared by every mark that stands for the same absence — the
 * front page's Voice row, the key's own heading, and the shortcut rows whose
 * chords answer nothing without it — so it never reads as two different
 * problems.
 */
export const VOICE_KEYLESS_NOTE = "Voice is off: sign in, or connect an OpenAI key.";

export const HOSTED_VOICE_UNAVAILABLE_NOTE = "Voice is temporarily unavailable. Try again later.";

/** A neutral customer-facing answer when the hosted emergency brake refuses a call. */
export function hostedVoiceUnavailableNote(
  diagnostics: RealtimeDiagnostics | undefined,
): string | undefined {
  return diagnostics?.lastOutcome === REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED
    ? HOSTED_VOICE_UNAVAILABLE_NOTE
    : undefined;
}

/** The two sources as the toggle names them. */
export const VOICE_SOURCE_LABEL = {
  [VOICE_SOURCE.ACCOUNT]: "Your Luke account",
  [VOICE_SOURCE.KEY]: "Your OpenAI key",
};

/** The one line under each name: what running on it is like, day to day. */
export const VOICE_SOURCE_DETAIL = {
  [VOICE_SOURCE.ACCOUNT]: "Included with your Luke account",
  [VOICE_SOURCE.KEY]: "Billed directly by OpenAI",
};

/** The toggle's name for a source, as a control says it aloud. */
export function voiceSourceLabel(source: VoiceSource): string {
  return VOICE_SOURCE_LABEL[source];
}

/** Why Luke can speak but not listen: the system's grant is still missing. */
export const MICROPHONE_UNGRANTED_NOTE = "Luke cannot listen: the microphone is not allowed yet.";

/**
 * What the row says beneath its name, once the system has answered. Only a
 * state the user has to act on or cannot act on says anything: a granted
 * microphone is already shown as granted, and the row drawn before macOS has
 * been asked carries the Allow button that is the whole answer.
 */
function microphoneStatusDetail(status: MicrophoneStatus): string | undefined {
  switch (status) {
    case "denied":
      return "Allow Luke in System Settings › Privacy & Security › Microphone.";
    case "restricted":
      return "This Mac does not permit microphone access.";
    case "unknown":
      return "Luke could not read the microphone permission.";
    default:
      return undefined;
  }
}
/** What the Microphone row says, and what it offers. */
export interface MicrophoneAccessRow {
  /** Absent wherever the row's name and its controls already say everything. */
  detail?: string;
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
      offerAccess: false,
      offerSystemSettings: false,
      ready: false,
    };
  }
  const row: MicrophoneAccessRow = {
    offerAccess: input.status === "not-determined",
    offerSystemSettings: input.status === "granted" || input.status === "denied",
    ready: input.status === "granted",
  };
  const detail = microphoneStatusDetail(input.status);
  if (detail !== undefined) row.detail = detail;
  return row;
}

/**
 * Why the front page's Voice row wears its exclamation mark, or nothing while
 * voice is ready to run. One sentence naming the first thing still missing —
 * the key before the microphone, because the key is what makes the microphone
 * worth asking for — worded for the hover and the screen reader alike. The
 * Voice page itself is where the missing thing is explained and supplied, so
 * the mark only has to say that something there still needs a hand.
 */
export function voiceAttentionNote(input: {
  voiceAvailable: boolean;
  status: MicrophoneStatus;
}): string | undefined {
  if (!input.voiceAvailable) {
    return VOICE_KEYLESS_NOTE;
  }
  if (!microphoneAccessRow(input).ready) {
    return MICROPHONE_UNGRANTED_NOTE;
  }
  return undefined;
}
