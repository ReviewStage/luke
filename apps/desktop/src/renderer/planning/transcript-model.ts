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
 * already holds is drawn from the record once the record has caught up with
 * what was heard, so the live call and its stored copy are never drawn
 * twice. The heard words outlast the call itself until then, so hanging up,
 * or calling again at once, never blanks the words just said.
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
 * A call whose words the voice window reported, as the tab holds it: kept
 * past the call's end until the record's copy of it has caught up.
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

/** How many words a call's lines hold, which is how far its copy has got. */
function wordCount(texts: readonly string[]): number {
  return texts.reduce((count, text) => count + (text === "" ? 0 : text.split(" ").length), 0);
}

/**
 * The calls heard on the open plan, from the voice window's report and what
 * was held before: the call reported is live and grows in place, every other
 * is held no longer live, so a call ended just before the next began keeps
 * its words until the record has them. Another plan opening drops them all,
 * and a call about another plan than the one open is not this tab's.
 */
export function heardCalls(input: {
  held: readonly HeardCall[];
  voice: Pick<VoiceView, "callPlanId" | "callTranscript">;
  planId: string | undefined;
  now: number;
}): readonly HeardCall[] {
  const { voice, planId, now } = input;
  if (planId === undefined) return [];
  const held = input.held.filter((call) => call.planId === planId);
  const reported = voice.callPlanId === planId ? voice.callTranscript : undefined;
  const ended = (call: HeardCall): HeardCall => (call.live ? { ...call, live: false } : call);
  if (reported === undefined) return held.map(ended);
  // Note that a call reported again keeps its place and when it was first heard.
  const standing = held.find(
    (call) => call.live && call.transcript.voiceSessionId === reported.voiceSessionId,
  );
  const live = { planId, transcript: reported, heardAt: standing?.heardAt ?? now, live: true };
  const kept = held.map((call) => (call === standing ? live : ended(call)));
  return standing === undefined ? [...kept, live] : kept;
}

/** A heard call as a row of the list, or nothing where nothing was said on it. */
function heardRow(heard: HeardCall): TranscriptCallRow | undefined {
  const lines = heard.transcript.lines
    .map((line) => ({ key: line.rowId, speaker: line.speaker, text: settledText(line.words) }))
    .filter((line) => line.text !== "");
  const [first] = lines;
  if (first === undefined) return undefined;
  return {
    key: heard.transcript.voiceSessionId ?? first.key,
    startedAt: heard.heardAt,
    live: heard.live,
    lines,
  };
}

/**
 * The tab's state. A transcript held is drawn whatever a later read came to,
 * and the calls heard beside it: a heard call the record holds is drawn from
 * the record once the record's copy has as many words, and from what was
 * heard until then, in the record's place; one the record does not hold yet
 * follows the record's calls. With nothing held and nothing heard, the read's
 * own state is drawn.
 */
export function transcriptRegion(input: {
  transcript: PlanningView["transcript"];
  heard: readonly HeardCall[];
}): TranscriptRegion {
  const stored = input.transcript?.transcript;
  const heard = new Map<string, TranscriptCallRow>();
  const unrecorded: TranscriptCallRow[] = [];
  for (const call of input.heard) {
    const row = heardRow(call);
    if (row === undefined) continue;
    const id = call.transcript.voiceSessionId;
    const recorded = id !== undefined && stored?.calls.some((each) => each.id === id) === true;
    if (recorded) heard.set(id, row);
    else unrecorded.push(row);
  }
  const calls: TranscriptCallRow[] = (stored?.calls ?? []).flatMap((call) => {
    const lines = call.lines
      .map((line, index) => ({
        key: String(index),
        speaker: line.speaker,
        text: settledText(line.text),
      }))
      .filter((line) => line.text !== "");
    const ahead = heard.get(call.id);
    const behind =
      ahead !== undefined &&
      (ahead.live ||
        wordCount(lines.map((line) => line.text)) <
          wordCount(ahead.lines.map((line) => line.text)));
    if (ahead !== undefined && behind) return [{ ...ahead, startedAt: call.startedAt }];
    return lines.length === 0
      ? []
      : [{ key: call.id, startedAt: call.startedAt, live: false, lines }];
  });
  calls.push(...unrecorded);
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
