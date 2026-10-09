import { PLANNING_READ, type PlanningView } from "@sidecar/hosted/planning-view";
import { TRANSCRIPT_PART_TYPE } from "@sidecar/hosted/transcript-wire";
import { TRANSCRIPT_SPEAKER } from "@sidecar/live";
import type { UIMessage } from "ai";
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
 * or calling again at once, never blanks the words just said. Both sources
 * are drawn as the AI SDK's `UIMessage`, the shape the record answers and
 * the one the tab's components take, so a line heard is a message exactly as
 * a line on record is.
 */

/** What the tab says before anything was said on any call about the plan. */
export const TRANSCRIPT_EMPTY_LINE =
  "Nothing said yet — start a call and the transcript appears here.";

/** Which state the tab draws. */
export const TRANSCRIPT_REGION = {
  READING: "reading",
  /** The read failed and nothing is held: the failure and Try again. */
  FAILED: "failed",
  /** Nothing was said on any call about the plan. */
  EMPTY: "empty",
  READY: "ready",
} as const;

/** One call as the tab draws it: when it started, whether it stands now, and its lines, each a message with its words settled. */
export interface TranscriptCallRow {
  readonly key: string;
  /** Epoch milliseconds the call started; for the call standing, when this window first heard it. */
  readonly startedAt: number;
  readonly live: boolean;
  readonly messages: readonly UIMessage[];
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

/** Who said a message, on the tab: the developer, or Luke. */
export function speakerLabel(role: UIMessage["role"]): string {
  return role === TRANSCRIPT_SPEAKER.USER ? "You" : "Luke";
}

/** A run of consecutive lines from one speaker, drawn as one turn under the speaker's name. */
export interface SpeakerTurn {
  /** The first line's id, which is the turn's place on the call. */
  readonly key: string;
  readonly role: UIMessage["role"];
  readonly messages: readonly UIMessage[];
}

/** A call's lines grouped into turns: each run of lines from one speaker is one turn, in the call's order. */
export function speakerTurns(messages: readonly UIMessage[]): readonly SpeakerTurn[] {
  const turns: SpeakerTurn[] = [];
  for (const message of messages) {
    const last = turns.at(-1);
    if (last !== undefined && last.role === message.role) {
      turns[turns.length - 1] = { ...last, messages: [...last.messages, message] };
      continue;
    }
    turns.push({ key: message.id, role: message.role, messages: [message] });
  }
  return turns;
}

/** What a copy of a turn carries: its lines' words, one paragraph each. */
export function turnText(messages: readonly UIMessage[]): string {
  return messages.map(messageText).join("\n\n");
}

/** A message's words: its text parts, run together. */
export function messageText(message: UIMessage): string {
  return message.parts
    .flatMap((part) => (part.type === TRANSCRIPT_PART_TYPE.TEXT ? [part.text] : []))
    .join(" ");
}

/** Words as the tab draws them: runs of whitespace one space, the ends trimmed. */
function settledText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/**
 * A message as the tab draws it, its words settled into one text part, or
 * nothing where it holds no words. A line on record is one of the SDK's
 * messages already, so this is also where the wire's shape is held to the
 * SDK's: a call's messages are taken as they are.
 */
function settledMessage(message: UIMessage): UIMessage | undefined {
  const text = settledText(messageText(message));
  if (text === "") return undefined;
  return { ...message, parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text }] };
}

/** How many words a call's messages hold, which is how far its copy has got. */
function wordCount(messages: readonly UIMessage[]): number {
  return messages.reduce((count, message) => count + messageText(message).split(" ").length, 0);
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

/** A heard call as a row of the list, or nothing where nothing was said on it: each line a message under the ledger's row id. */
function heardRow(heard: HeardCall): TranscriptCallRow | undefined {
  const messages = heard.transcript.lines.flatMap((line) => {
    const message = settledMessage({
      id: line.rowId,
      role: line.speaker,
      parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text: line.words }],
    });
    return message === undefined ? [] : [message];
  });
  const [first] = messages;
  if (first === undefined) return undefined;
  return {
    key: heard.transcript.voiceSessionId ?? first.id,
    startedAt: heard.heardAt,
    live: heard.live,
    messages,
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
    const messages = call.messages.flatMap((message) => {
      const settled = settledMessage(message);
      return settled === undefined ? [] : [settled];
    });
    const ahead = heard.get(call.id);
    const behind =
      ahead !== undefined && (ahead.live || wordCount(messages) < wordCount(ahead.messages));
    if (ahead !== undefined && behind) return [{ ...ahead, startedAt: call.startedAt }];
    return messages.length === 0
      ? []
      : [{ key: call.id, startedAt: call.startedAt, live: false, messages }];
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
