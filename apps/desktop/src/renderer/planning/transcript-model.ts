import { PLANNING_READ, type PlanningView } from "@sidecar/hosted/planning-view";
import { TRANSCRIPT_SPEAKER, type TranscriptSpeaker } from "@sidecar/live";
import type { VoiceView } from "#shared/messages/voice-view";

/**
 * transcript-model.ts -- what the open plan's Transcript tab draws, decided from the stored transcript and the call standing now.
 *
 * Two sources make one list. The host reads what was said on the plan's
 * calls from the record whenever the plan opens and whenever a call about it
 * ends; the call standing now is not on record yet, so its words come from
 * the voice window's report as they are said. The two are told apart by the
 * store's id for the call's session, which both carry: a call the record
 * already holds is drawn from the record, so the live call and its stored
 * copy are never drawn twice. The live words outlast the call itself until
 * the record's copy lands, so hanging up never blanks the words just said.
 */

/** Who each speaker is on the tab. */
export const SPEAKER_LABEL = {
  [TRANSCRIPT_SPEAKER.USER]: "You",
  [TRANSCRIPT_SPEAKER.ASSISTANT]: "Luke",
} as const satisfies Record<TranscriptSpeaker, string>;

/** What the tab says before anything was said on any call about the plan. */
export const TRANSCRIPT_EMPTY_LINE =
  "Nothing said yet — start a call and the transcript appears here.";

/** How far from the bottom, in pixels, the list still counts as following the newest line. */
const FOLLOW_SLACK_PX = 24;

/** Which state the tab draws. */
export const TRANSCRIPT_REGION = {
  READING: "reading",
  /** The read failed and nothing is held: the failure and Try again. */
  FAILED: "failed",
  /** Nothing was said on any call about the plan. */
  EMPTY: "empty",
  READY: "ready",
} as const;

/** One line as the tab draws it: who said it and the words, whitespace settled. */
interface TranscriptRow {
  readonly key: string;
  readonly speaker: TranscriptSpeaker;
  readonly text: string;
}

/** One call as the tab draws it: when it started, whether it stands now, and its lines. */
export interface TranscriptCallRow {
  readonly key: string;
  /** Epoch milliseconds the call started; for the call standing, when this window first heard it. */
  readonly startedAt: number;
  readonly live: boolean;
  readonly lines: readonly TranscriptRow[];
}

export type TranscriptRegion =
  | { readonly kind: typeof TRANSCRIPT_REGION.READING }
  | { readonly kind: typeof TRANSCRIPT_REGION.FAILED }
  | { readonly kind: typeof TRANSCRIPT_REGION.EMPTY }
  | {
      readonly kind: typeof TRANSCRIPT_REGION.READY;
      readonly calls: readonly TranscriptCallRow[];
      /** Whether older words were left out of the read. */
      readonly earlierOmitted: boolean;
    };

/**
 * The call whose words the voice window reported last, as the tab holds it:
 * kept past the call's end until the record's copy of it lands.
 */
export interface HeardCall {
  readonly planId: string;
  readonly transcript: NonNullable<VoiceView["callTranscript"]>;
  /** When this window first heard the call, which its header shows. */
  readonly heardAt: number;
  /** Whether the call still stands. */
  readonly live: boolean;
}

/** Words as the tab draws them: runs of whitespace one space, the ends trimmed. */
function settledText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/**
 * The call heard now, from the voice window's report and what was held
 * before: a new call replaces the held one, the same call grows it, and a
 * report naming no call leaves the held one standing, no longer live. A call
 * about another plan than the one open is not this tab's.
 */
export function heardCall(input: {
  held: HeardCall | undefined;
  voice: Pick<VoiceView, "callPlanId" | "callTranscript">;
  planId: string | undefined;
  now: number;
}): HeardCall | undefined {
  const { held, voice, planId, now } = input;
  if (planId === undefined) return undefined;
  const reported = voice.callPlanId === planId ? voice.callTranscript : undefined;
  if (reported === undefined) {
    if (held === undefined || held.planId !== planId) return undefined;
    return held.live ? { ...held, live: false } : held;
  }
  const same =
    held !== undefined &&
    held.planId === planId &&
    held.live &&
    held.transcript.voiceSessionId === reported.voiceSessionId;
  return { planId, transcript: reported, heardAt: same ? held.heardAt : now, live: true };
}

/** The heard call as a row of the list, or nothing when the record already holds it or nothing was said. */
function heardRow(heard: HeardCall, recorded: ReadonlySet<string>): TranscriptCallRow | undefined {
  const { voiceSessionId, lines } = heard.transcript;
  if (voiceSessionId !== undefined && recorded.has(voiceSessionId)) return undefined;
  const rows = lines
    .map((line) => ({ key: line.rowId, speaker: line.speaker, text: settledText(line.words) }))
    .filter((line) => line.text !== "");
  if (rows.length === 0) return undefined;
  return {
    key: voiceSessionId ?? "heard",
    startedAt: heard.heardAt,
    live: heard.live,
    lines: rows,
  };
}

/**
 * The tab's state. A transcript held is drawn whatever a later read came to,
 * with the call heard now after it; with none held, the call heard is drawn
 * alone, and failing that the read's own state is.
 */
export function transcriptRegion(input: {
  transcript: PlanningView["transcript"];
  heard: HeardCall | undefined;
}): TranscriptRegion {
  const stored = input.transcript?.transcript;
  const recorded = new Set(stored?.calls.map((call) => call.id));
  const calls: TranscriptCallRow[] = (stored?.calls ?? []).flatMap((call) => {
    const lines = call.lines
      .map((line, index) => ({
        key: String(index),
        speaker: line.speaker,
        text: settledText(line.text),
      }))
      .filter((line) => line.text !== "");
    return lines.length === 0
      ? []
      : [{ key: call.id, startedAt: call.startedAt, live: false, lines }];
  });
  const heard = input.heard === undefined ? undefined : heardRow(input.heard, recorded);
  if (heard !== undefined) calls.push(heard);
  if (calls.length > 0) {
    return {
      kind: TRANSCRIPT_REGION.READY,
      calls,
      earlierOmitted: stored?.earlierOmitted ?? false,
    };
  }
  if (stored !== undefined) return { kind: TRANSCRIPT_REGION.EMPTY };
  if (input.transcript?.status === PLANNING_READ.FAILED) return { kind: TRANSCRIPT_REGION.FAILED };
  return { kind: TRANSCRIPT_REGION.READING };
}

/**
 * A call's header: the day, as today, yesterday, a weekday this week, or a
 * date, then the time, in the developer's own locale and zone.
 */
export function callHeading(startedAt: number, now: number, locale?: string): string {
  const started = new Date(startedAt);
  const today = new Date(now);
  const midnight = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const daysAgo = Math.round((midnight(today) - midnight(started)) / 86_400_000);
  const time = started.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (daysAgo === 0) return `Today, ${time}`;
  if (daysAgo === 1) return `Yesterday, ${time}`;
  const options: Intl.DateTimeFormatOptions =
    daysAgo > 1 && daysAgo < 7
      ? { weekday: "long" }
      : started.getFullYear() === today.getFullYear()
        ? { month: "short", day: "numeric" }
        : { month: "short", day: "numeric", year: "numeric" };
  const day = started.toLocaleDateString(locale, options);
  return `${day}, ${time}`;
}

/** Whether a list scrolled this far is at its newest line, so a new line should keep it there. */
export function followsNewest(list: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): boolean {
  return list.scrollHeight - list.scrollTop - list.clientHeight <= FOLLOW_SLACK_PX;
}
