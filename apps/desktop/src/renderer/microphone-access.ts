import {
  type HostedUsageAnswer,
  REALTIME_MINT_OUTCOME,
  type RealtimeDiagnostics,
} from "@sidecar/core";
import type { MicrophoneStatus } from "../shared/contracts";

/**
 * Why voice as a whole is off: nothing it can run on stands — no signed-in
 * account carrying the hosted allowance, and no key of the developer's own.
 * One sentence, shared by every mark that stands for the same absence — the
 * front page's Voice row, the key's own heading, and the shortcut rows whose
 * chords answer nothing without it — so it never reads as two different
 * problems.
 */
export const VOICE_KEYLESS_NOTE = "Voice is off: sign in, or connect an OpenAI key.";

/** The one sentence a spent allowance is worded with, wherever it shows. */
export const HOSTED_VOICE_SPENT_NOTE =
  "Today's included voice is used up — it returns at midnight UTC.";

/**
 * The BYOK hint, worded once for every surface that carries it. Away from the
 * key's own row, the hint says where that row lives; beside it, naming the
 * page would send the reader to where they already are.
 */
export function hostedVoiceLift(options: { namesKeyRow?: boolean } = {}): string {
  return options.namesKeyRow
    ? "Connecting your own OpenAI key — on the Voice page — lifts the allowance and runs voice on it instead."
    : "Connecting your own OpenAI key lifts the allowance and runs voice on it instead.";
}

/**
 * What the key section says while voice runs on the signed-in account: whose
 * allowance is speaking, how much of today's remains, and what connecting a
 * key of one's own changes. The numbers prefer the usage read — it answers
 * before the first call of the day and counts the reviews the mint's own
 * diagnostics never see — and fall back to the quota the last mint carried.
 * The refusal a spent allowance answers with is a state here, not an error —
 * nothing is broken, and the sentence says when voice returns on its own.
 */
export function hostedVoiceNote(
  diagnostics: RealtimeDiagnostics | undefined,
  usage?: HostedUsageAnswer,
  options: { namesKeyRow?: boolean; offersKey?: boolean } = {},
): string {
  // A machine that cannot store a key is not sent to go connect one: the
  // Voice page withholds that invitation while storage is unavailable, and a
  // note pointing there from a page away must withhold it the same way.
  const lift = options.offersKey === false ? "" : ` ${hostedVoiceLift(options)}`;
  // When a fresh read is in hand it alone decides spent-ness: the minter's
  // last outcome survives midnight, and yesterday's refusal must not outrank
  // today's full allowance.
  const voiceSpent = usage
    ? usage.voice.remaining === 0
    : diagnostics?.lastOutcome === REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED;
  if (voiceSpent) {
    return `${HOSTED_VOICE_SPENT_NOTE}${lift}`;
  }
  if (usage) {
    return (
      `Voice is included with your Luke account — ${usage.voice.remaining} of ` +
      `${usage.voice.limit} calls and ${usage.attention.remaining} of ` +
      `${usage.attention.limit} session reviews left today.${lift}`
    );
  }
  const quota = diagnostics?.quota;
  if (quota) {
    return `Voice is included with your Luke account — ${quota.remaining} of ${quota.limit} calls left today.${lift}`;
  }
  return `Voice is included with your Luke account, under a daily allowance.${lift}`;
}

/** Why Luke can speak but not listen: the system's grant is still missing. */
export const MICROPHONE_UNGRANTED_NOTE = "Luke cannot listen: the microphone is not allowed yet.";

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
      // The Voice page holds the key row alone while voice is off, so this
      // detail is never drawn there — it only has to stay honest, not send
      // anyone anywhere, and it names no other setting.
      detail: "Luke opens the microphone only to talk.",
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
