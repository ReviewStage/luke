import { type HostedQuota, REALTIME_MINT_OUTCOME, type RealtimeDiagnostics } from "@sidecar/core";
import { type MicrophoneStatus, VOICE_SOURCE, type VoiceSource } from "../shared/contracts";

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
 * own `resetsAt` read on the wearer's own clock rather than as a subtraction
 * they have to do. The counters turn over at midnight UTC, which is somebody
 * else's clock and never the reader's — so the phrase names the hour their
 * Mac would show, and says "tomorrow" whenever that hour falls on the next
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
 * The one sentence a spent allowance is worded with, wherever it shows. It
 * answers the question actually being asked — is Luke broken? — before it
 * says when voice returns: observation is local and unmetered, so the rows
 * keep moving whatever the day's talking has cost. With no reset in hand it
 * falls back to the day boundary every counter shares.
 */
export function hostedVoiceSpentNote(resetsIn?: string): string {
  return `You have used today's free voice — back ${resetsIn ?? "at midnight UTC"}. Luke keeps watching your sessions.`;
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
 * How a meter reads at a glance: running, getting close, or gone. Three
 * states rather than the two a spent flag carried, because a ceiling nobody
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
 * What counts as close. One fraction serves both meters rather than a count
 * each: their ceilings differ by an order of magnitude, and a threshold
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

/**
 * The two sources as the toggle names them, and what each one costs. Held
 * apart from the labels so the price reads as the tag it is drawn as, and
 * together in one place so the toggle, its spoken name, and the disclosure
 * beneath can never word the same choice three ways.
 */
export const VOICE_SOURCE_LABEL: Record<VoiceSource, string> = {
  [VOICE_SOURCE.ACCOUNT]: "Your Luke account",
  [VOICE_SOURCE.KEY]: "Your OpenAI key",
};

export const VOICE_SOURCE_PRICE: Record<VoiceSource, string> = {
  [VOICE_SOURCE.ACCOUNT]: "Free",
  [VOICE_SOURCE.KEY]: "You pay",
};

/** The one line under each name: what running on it is like, day to day. */
export const VOICE_SOURCE_DETAIL: Record<VoiceSource, string> = {
  [VOICE_SOURCE.ACCOUNT]: "A daily amount, included",
  [VOICE_SOURCE.KEY]: "No daily limit, billed by OpenAI",
};

/** The toggle's name for a source, as a control says it aloud. */
export function voiceSourceLabel(source: VoiceSource): string {
  return `${VOICE_SOURCE_LABEL[source]} (${VOICE_SOURCE_PRICE[source].toLowerCase()})`;
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

/**
 * What each meter actually spends, for the disclosure that answers "what
 * counts as one?" — folded away until asked, because the definitions are
 * needed once and the numbers are needed daily.
 */
export const HOSTED_METER_MEANING = {
  VOICE: "One conversation you open, or one thing Luke says on his own.",
  REVIEWS:
    "Each session update weighed in the background to decide whether it is worth telling you about.",
} as const;

/**
 * What is true of both uses once a key is what pays for them, said once
 * beneath the two the key disclosure lists. It is the only thing that half
 * says which the allowance's half does not: Luke does the same two jobs
 * either way, so they are worded identically in both, and what differs is
 * where the work goes and who is billed for it — the half no meter could ever
 * show.
 *
 * Not the place for the Realtime API's billing requirement: that matters
 * while a key is being got rather than while one is being spent, and the
 * entry's own hint says it there.
 */
export const KEY_USE_NOTE =
  "Both go straight from your Mac to OpenAI on this key. Luke's service sees none of it, there is no daily limit, and OpenAI bills you at their rates.";

/**
 * A meter's ceiling as the disclosure says it, or nothing at all until a
 * reading has arrived. The number is the service's to state — it is read off
 * the quota in hand rather than written here, so the panel cannot drift from
 * the ceiling actually being enforced.
 */
export function dailyLimitWords(limit?: number): string {
  return limit === undefined ? "" : `${limit} a day. `;
}

/**
 * The Account section's words while voice runs on the account but no numbers
 * are in hand yet — every state with a quota draws the meters instead. Only
 * the minter's last outcome can speak here, and a spent allowance is a state,
 * not an error: the sentence says voice comes back on its own.
 */
export function hostedVoiceNote(
  diagnostics: RealtimeDiagnostics | undefined,
  options: { now?: number } = {},
): string {
  const now = options.now ?? Date.now();
  // A spent outcome speaks only while its own day runs: past the reset it
  // describes yesterday, and the fresh day has an allowance again.
  const spentStands =
    diagnostics?.lastOutcome === REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED &&
    (diagnostics.quota === undefined || currentQuota(diagnostics.quota, now) !== undefined);
  if (spentStands) return hostedVoiceSpentNote();
  // What a key of your own would change is not said here any more: the toggle
  // above draws both sources side by side, with what each costs on its face,
  // and a sentence repeating one of them would be selling the other.
  return "Talking and session checks are included free with your account, up to a daily amount.";
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
