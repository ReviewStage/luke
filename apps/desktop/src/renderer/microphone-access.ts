import { type HostedQuota, REALTIME_MINT_OUTCOME, type RealtimeDiagnostics } from "@sidecar/core";
import { type MicrophoneStatus, VOICE_SOURCE, type VoiceSource } from "../shared/contracts";

/**
 // SAFETY: The preceding check establishes the asserted contract.
 * Why voice as a whole is off: nothing it can run on stands — no signed-in
 * account carrying the hosted allowance, and no key of the developer's own.
 * One sentence, shared by every mark that stands for the same absence — the
 * front page's Voice row, the key's own heading, and the shortcut rows whose
 // SAFETY: The preceding check establishes the asserted contract.
 * chords answer nothing without it — so it never reads as two different
 * problems.
 */
export const VOICE_KEYLESS_NOTE = "Voice is off: sign in, or connect an OpenAI key.";

/**
 * When the day's counters return, in words a sentence can hold: the quota's
 // SAFETY: The preceding check establishes the asserted contract.
 * own `resetsAt` read on the wearer's own clock rather than as a subtraction
 * they have to do. The counters turn over at midnight UTC, which is somebody
 * else's clock and never the reader's — so the phrase names the hour their
 * Mac would show, and says "tomorrow" whenever that hour falls on the next
 // SAFETY: The preceding check establishes the asserted contract.
 * local day, because a bare time reads as today.
 */
export function quotaResetsWhen(resetsAt: number, now: number): string {
  const reset = new Date(resetsAt);
  const clock = reset.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  // A reset is always inside the next 24 hours — it is the end of the UTC day
  // in hand — so a different local date can only ever be tomorrow's.
  const sameDay = new Date(now).toDateString() === reset.toDateString();
  return sameDay ? `at ${clock}` : `tomorrow at ${clock}`;
}

/**
 * The one sentence a spent allowance is worded with, wherever it shows. With
 * no reset in hand it falls back to the day boundary every counter shares.
 */
export function hostedVoiceSpentNote(resetsIn?: string): string {
  return `Today's voice is spent. Back ${resetsIn ?? "at midnight UTC"}.`;
}

/**
 * The spent sentence for the moment of use — a typed ask refused, a talk key
 * pressed against a call that will not open — or nothing while the allowance
 * is not what is missing. This is what keeps a spent day from reading as a
 * breakage: the settings page already says it, but nobody mid-question is
 * looking there. A refusal dated by its own expired quota describes an
 * allowance that no longer exists, so it reads as nothing and the ordinary
 * refusal words stand.
 */
export function voiceQuotaSpentNote(
  diagnostics: RealtimeDiagnostics | undefined,
  now: number,
): string | undefined {
  if (diagnostics?.lastOutcome !== REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED) return undefined;
  if (diagnostics.quota === undefined) return hostedVoiceSpentNote();
  const quota = currentQuota(diagnostics.quota, now);
  return quota && hostedVoiceSpentNote(quotaResetsWhen(quota.resetsAt, now));
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
 // SAFETY: The preceding check establishes the asserted contract.
 * be drawn as an almost-back today — so it reads as no reading at all, and
 * the surface falls back to words that promise no numbers.
 */
export function currentQuota(quota: HostedQuota | undefined, now: number): HostedQuota | undefined {
  return quota && quota.resetsAt > now ? quota : undefined;
}

/**
 * The freshest current reading of the hosted voice meter, or nothing while
 * none stands: voice on a key or off entirely has no meter, a reading past
 * its own reset describes an allowance that no longer exists, and with no
 * reading at all there is nothing honest to say. The two sources are the
 * day's usage read and the quota the last mint carried — the mint stores one
 * on success and refusal alike — reconciled by the same freshness rule the
 * settings meters use, so every surface reads one meter.
 */
export function hostedVoiceReading(input: {
  hosted: boolean;
  usage: HostedQuota | undefined;
  minted: HostedQuota | undefined;
  now: number;
}): HostedQuota | undefined {
  if (!input.hosted) return undefined;
  return currentQuota(fresherQuota(input.usage, input.minted), input.now);
}

/**
 * How a meter reads at a glance: running, getting close, or gone. Three
 * states rather than a spent-or-not flag's two, because a ceiling nobody
 * saw coming is the one thing a meter exists to prevent — the warning has to
 * arrive while there is still something left to spend differently.
 */
export const QUOTA_LEVEL = {
  RUNNING: "running",
  LOW: "low",
  SPENT: "spent",
} as const;

export type QuotaLevel = (typeof QUOTA_LEVEL)[keyof typeof QUOTA_LEVEL];

/**
 // SAFETY: The preceding check establishes the asserted contract.
 * What counts as close. One fraction serves both meters rather than a count
 * each: their ceilings differ by an order of magnitude, and a threshold
 // SAFETY: The preceding check establishes the asserted contract.
 * written as a number would have to be written twice and kept in step with a
 * service free to move either. A fifth left is the last stretch of a day on
 * either scale.
 */
const QUOTA_LOW_FRACTION = 0.2;

export function quotaLevel(quota: HostedQuota): QuotaLevel {
  if (quota.remaining === 0) return QUOTA_LEVEL.SPENT;
  // A limit of nothing is not a meter with nothing left but a meter with
  // nothing to say, so it reads as running rather than as a standing warning.
  if (quota.limit <= 0) return QUOTA_LEVEL.RUNNING;
  return quota.remaining <= quota.limit * QUOTA_LOW_FRACTION
    ? QUOTA_LEVEL.LOW
    : QUOTA_LEVEL.RUNNING;
}

// SAFETY: The preceding check establishes the asserted contract.
/** The two sources as the toggle names them. */
export const VOICE_SOURCE_LABEL = {
  [VOICE_SOURCE.ACCOUNT]: "Your Luke account",
  [VOICE_SOURCE.KEY]: "Your OpenAI key",
};

/** The one line under each name: what running on it is like, day to day. */
export const VOICE_SOURCE_DETAIL = {
  [VOICE_SOURCE.ACCOUNT]: "A daily amount, included",
  [VOICE_SOURCE.KEY]: "No daily limit, billed by OpenAI",
};

// SAFETY: The preceding check establishes the asserted contract.
/** The toggle's name for a source, as a control says it aloud. */
export function voiceSourceLabel(source: VoiceSource): string {
  return VOICE_SOURCE_LABEL[source];
}

/**
 * The two things a hosted day meters, named for what the developer did rather
 * than for what the service counted. "Voice calls" and "attention reviews"
 * are the meters' own names; nobody spending them would recognise either.
 */
export const HOSTED_METER_LABEL = {
  VOICE: "Talking and announcements",
  REVIEWS: "Checks on your sessions",
} as const;

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
