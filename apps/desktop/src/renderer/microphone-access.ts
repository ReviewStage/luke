import { type HostedQuota, REALTIME_MINT_OUTCOME, type RealtimeDiagnostics } from "@sidecar/core";
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

/**
 * When the day's counters return, in words a sentence can hold: the quota's
 * own `resetsAt` against the clock in hand. Rounded deliberately — a counter
 * nobody can spend by the minute earns no seconds precision.
 */
export function quotaResetsInWords(resetsAt: number, now: number): string {
  const msLeft = resetsAt - now;
  if (msLeft <= 60_000) return "in under a minute";
  const minutes = Math.round(msLeft / 60_000);
  if (minutes < 90) return `in about ${minutes < 60 ? `${minutes} minutes` : "an hour"}`;
  return `in about ${Math.round(minutes / 60)} hours`;
}

/**
 * The one sentence a spent allowance is worded with, wherever it shows: with
 * the reset in hand it says when voice returns, and without one it falls back
 * to the day boundary every counter shares.
 */
export function hostedVoiceSpentNote(resetsIn?: string): string {
  return resetsIn
    ? `Voice is used up — back ${resetsIn}.`
    : "Voice is used up — back at midnight UTC.";
}

/**
 * The fresher of two readings of the same meter, decided from the readings
 * themselves: `resetsAt` names the day, so a later one is a later day, and
 * within one day `remaining` only ever falls — the usage read and the quota a
 * mint carried have no timestamps of their own, but the smaller remainder is
 * the newer fact. This is what lets a held usage read and a newer mint's
 * quota disagree without the surface showing yesterday's allowance, or
 * allowance a spent mint has already refused.
 */
export function fresherQuota(a?: HostedQuota, b?: HostedQuota): HostedQuota | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.resetsAt !== b.resetsAt) return a.resetsAt > b.resetsAt ? a : b;
  return a.remaining <= b.remaining ? a : b;
}

/**
 * A reading only while its day is still running. Past its own reset a quota
 * describes an allowance that no longer exists — a spent yesterday must not
 * be drawn as an almost-back today — so it reads as no reading at all, and
 * the surface falls back to words that promise no numbers.
 */
export function currentQuota(quota: HostedQuota | undefined, now: number): HostedQuota | undefined {
  return quota && quota.resetsAt > now ? quota : undefined;
}

/**
 * The BYOK hint, worded once. It names no page: the key row it means stands
 * directly below the one place this sentence is drawn.
 */
export function hostedVoiceLift(): string {
  return "Your own OpenAI key below lifts the limits.";
}

/**
 * The Account section's words while voice runs on the account but no numbers
 * are in hand yet — every state with a quota draws the meters instead. Only
 * the minter's last outcome can speak here, and a spent allowance is a state,
 * not an error: the sentence says voice comes back on its own.
 */
export function hostedVoiceNote(
  diagnostics: RealtimeDiagnostics | undefined,
  options: { offersKey?: boolean; now?: number } = {},
): string {
  const now = options.now ?? Date.now();
  // A machine that cannot store a key is not offered one to connect.
  const lift = options.offersKey === false ? "" : ` ${hostedVoiceLift()}`;
  // A spent outcome speaks only while its own day runs: past the reset it
  // describes yesterday, and the fresh day has an allowance again.
  const spentStands =
    diagnostics?.lastOutcome === REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED &&
    (diagnostics.quota === undefined || currentQuota(diagnostics.quota, now) !== undefined);
  if (spentStands) {
    return `${hostedVoiceSpentNote()}${lift}`;
  }
  return `Voice and session review are included with your account.${lift}`;
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
