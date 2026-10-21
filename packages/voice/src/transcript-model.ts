import type { PlanEditor } from "@luke/features/task-wire";
import { TASKS_READ } from "@luke/features/tasks-view";
import {
  type TaskTranscript,
  TRANSCRIPT_PART_TYPE,
  type TranscriptCall,
} from "@luke/features/transcript-wire";
import { MESSAGE_CHANNEL } from "@luke/wire";
import type { UIMessage } from "ai";
import type { VoiceCallTranscript, VoiceView } from "./voice-view.js";

/**
 * transcript-model.ts -- the calls into an agent as its tab draws them, decided from the record of its calls and the call standing now.
 *
 * Two sources make one list. The window reads the agent's calls from the
 * record whenever its tab opens and whenever a call into it ends; the call
 * standing now is not on record yet, so its words come from
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

/** The quiet line a call that has ended closes with, and the one for a call Luke ended himself. */
const CALL_ENDED_LINE = {
  ENDED: "Call ended",
  LUKE_ENDED: "Luke ended the call",
} as const;

/** Where the read of an agent's calls stands, with what it holds. */
export const TRANSCRIPT_REGION = {
  READING: "reading",
  /** The read failed and nothing is held. */
  FAILED: "failed",
  /** No call into the agent was made. */
  EMPTY: "empty",
  READY: "ready",
} as const;

/**
 * What was said on an agent's calls as last read: where the read stands, and
 * the calls it read, kept through a later read that failed.
 */
export interface CallsRead {
  readonly status: (typeof TASKS_READ)[keyof typeof TASKS_READ];
  readonly transcript?: TaskTranscript | undefined;
}

/** What a call's record says of the call itself, as far as it says it: when and why it ended, what it metered, and its model. */
export type CallRecord = Pick<TranscriptCall, "endedAt" | "ending" | "usage" | "model">;

/** One call as the tab draws it: when it started, whether it stands now, its lines, each a message with its words settled, and its record. */
export interface TranscriptCallRow {
  readonly key: string;
  /** Epoch milliseconds the call started; for the call standing, when this window first heard it, less how far into the call its first line began. */
  readonly startedAt: number;
  readonly live: boolean;
  /** Whether Luke ended the call himself, as far as this window saw it end. */
  readonly lukeEnded: boolean;
  readonly messages: readonly UIMessage[];
  /** What the record says of the call; nothing for a call the record does not hold yet, or one still standing. */
  readonly record?: CallRecord | undefined;
  /** The teammate whose call it was, by the account the record names, so the window can draw their face; none for the reader's own, a call heard on this Mac, or one nobody can be named for. */
  readonly caller?: PlanEditor | undefined;
}

/** The line a call closes with: none while it stands, and who ended it where this window saw Luke do it. */
export function callEndedLine(
  call: Pick<TranscriptCallRow, "live" | "lukeEnded">,
): string | undefined {
  if (call.live) return undefined;
  return call.lukeEnded ? CALL_ENDED_LINE.LUKE_ENDED : CALL_ENDED_LINE.ENDED;
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
  readonly agentId: string;
  readonly transcript: VoiceCallTranscript;
  /** When this window first heard the call, which its header shows. */
  readonly heardAt: number;
  /** Whether the call still stands. */
  readonly live: boolean;
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
 * The calls heard into the agent, from the voice window's report and what
 * was held before: the call reported is live and grows in place, every other
 * is held no longer live, so a call ended just before the next began keeps
 * its words until the record has them. A call into another agent is not
 * this tab's.
 */
export function heardCalls(input: {
  held: readonly HeardCall[];
  /** The call standing, and its transcript as the document holds it (`voice.callTranscript`). */
  voice: Pick<VoiceView, "call"> & { callTranscript: VoiceCallTranscript | undefined };
  agentId: string;
  now: number;
}): readonly HeardCall[] {
  const { voice, agentId, now } = input;
  const held = input.held.filter((call) => call.agentId === agentId);
  const reported = voice.call?.agentId === agentId ? voice.callTranscript : undefined;
  const ended = (call: HeardCall): HeardCall => (call.live ? { ...call, live: false } : call);
  if (reported === undefined) return held.map(ended);
  // Note that a call reported again keeps its place and when it was first heard.
  const standing = held.find(
    (call) => call.live && call.transcript.voiceSessionId === reported.voiceSessionId,
  );
  const live = { agentId, transcript: reported, heardAt: standing?.heardAt ?? now, live: true };
  const kept = held.map((call) => (call === standing ? live : ended(call)));
  return standing === undefined ? [...kept, live] : kept;
}

/**
 * A heard call as a row of the list, or nothing where nothing was said on
 * it: each line a message under the window's own row id, which names no row
 * on record, so the line carries its span on the call instead, which is what
 * a turn that took it as its ask names it by (`call-thread.ts`). The call
 * is taken to have started as far before it was first heard as its first
 * line began into it, since the window hears a call at its first line,
 * which puts each line's start on the call near where it was and a turn
 * that began before any line ahead of them all.
 */
function heardRow(heard: HeardCall): TranscriptCallRow | undefined {
  const messages = heard.transcript.lines.flatMap((line) => {
    const message = settledMessage({
      id: line.rowId,
      role: line.speaker,
      parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text: line.words }],
      metadata: { span: { startMs: line.startMs, endMs: line.endMs } },
    });
    return message === undefined ? [] : [message];
  });
  const [first] = messages;
  if (first === undefined) return undefined;
  return {
    key: heard.transcript.voiceSessionId ?? first.id,
    startedAt: heard.heardAt - (heard.transcript.lines[0]?.startMs ?? 0),
    live: heard.live,
    lukeEnded: false,
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
  transcript: CallsRead | undefined;
  heard: readonly HeardCall[];
  /** The store's id for the session of the last call Luke ended himself, which closes with a line saying so. */
  lukeEndedCall?: string | undefined;
  /** The signed-in account's id, whose own calls are drawn as theirs; without one, every named caller is named. */
  readerId?: string | undefined;
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
    const { id, startedAt, messages: _messages, by, ...record } = call;
    const caller = by === undefined || by.userId === input.readerId ? undefined : by;
    const ahead = heard.get(id);
    const behind =
      ahead !== undefined && (ahead.live || wordCount(messages) < wordCount(ahead.messages));
    if (ahead !== undefined && behind) {
      // Note that the heard copy takes the record's caller, because a call heard here names nobody of its own.
      return [{ ...ahead, startedAt, caller, ...(ahead.live ? undefined : { record }) }];
    }
    return messages.length === 0
      ? []
      : [{ key: id, startedAt, live: false, lukeEnded: false, messages, record, caller }];
  });
  calls.push(...unrecorded);
  if (calls.length > 0) {
    return {
      kind: TRANSCRIPT_REGION.READY,
      calls: calls.map((call) => ({ ...call, lukeEnded: call.key === input.lukeEndedCall })),
      earlierOmitted: stored?.earlierOmitted ?? false,
    };
  }
  if (stored !== undefined) return { kind: TRANSCRIPT_REGION.EMPTY };
  if (input.transcript?.status === TASKS_READ.FAILED) return { kind: TRANSCRIPT_REGION.FAILED };
  return { kind: TRANSCRIPT_REGION.READING };
}

/**
 * How long before the call standing was first heard it is taken to have
 * started, in milliseconds. Note that a live call is dated from when this
 * window first heard its words, which can follow a turn the call began
 * with, so the call claims the code shown and the work begun a little
 * before it; the record's own start replaces the guess once the call is
 * read back.
 */
const LIVE_CALL_SLACK_MS = 30_000;

/** When a call started, as what it holds reads it: a live call a little before it was first heard. */
export function callStart(call: Pick<TranscriptCallRow, "startedAt" | "live">): number {
  return call.live ? call.startedAt - LIVE_CALL_SLACK_MS : call.startedAt;
}

/** The channels a line of a call arrives on: said, either speaker's, or typed into the composer while the call stood. */
const CALL_CHANNELS: ReadonlySet<unknown> = new Set([MESSAGE_CHANNEL.VOICE, MESSAGE_CHANNEL.TYPED]);

/**
 * The store's id for the call a line of an agent's transcript was said on,
 * read off the line's own metadata; none for a line said on no call. A line
 * typed while the call stood names its call too, so it stands inside it.
 */
export function callOfLine(message: { readonly metadata?: unknown }): string | undefined {
  const { metadata } = message;
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const channel: unknown = Reflect.get(metadata, "channel");
  const session: unknown = Reflect.get(metadata, "voice_session_id");
  return CALL_CHANNELS.has(channel) && typeof session === "string" ? session : undefined;
}

/** A line of an agent's transcript as the tab holds it: its id, its metadata, and its parts. */
interface TranscriptLine {
  readonly id: string;
  readonly metadata?: unknown;
  readonly parts?: readonly unknown[];
}

/** A row the transcript draws: a line, and the lines that reached it while it ran, which it draws inside it. */
interface TranscriptRow extends TranscriptLine {
  readonly arrived?: readonly TranscriptLine[];
}

/** The lines of a call heard here that no row holds yet, and whether the call's divider stands above already. */
export interface HeardTail {
  readonly call: TranscriptCallRow;
  readonly opened: boolean;
  readonly lines: readonly UIMessage[];
}

/**
 * Where an agent's transcript draws its calls: the checkpoint each begins at,
 * before the first row drawing one of its lines; the line each that ended
 * closes with, after the last such row; and the lines of each call heard
 * here that no row holds yet, which stand at its foot in the order the
 * calls began, each under its divider where none of its lines is held.
 */
export interface CallPlaces {
  /** The calls that begin before a transcript row, by the row, in the order they began: two calls whose lines reached one running turn begin at its one row. */
  readonly opens: ReadonlyMap<string, readonly TranscriptCallRow[]>;
  /** The ended calls that close after a transcript row, by the row, in the order they began. */
  readonly closes: ReadonlyMap<string, readonly TranscriptCallRow[]>;
  readonly heard: readonly HeardTail[];
}

/** A line's words as it reads, its text parts joined. */
function lineText(line: TranscriptLine): string {
  return (line.parts ?? [])
    .flatMap((part) => {
      if (typeof part !== "object" || part === null) return [];
      const text: unknown = Reflect.get(part, "text");
      return Reflect.get(part, "type") === TRANSCRIPT_PART_TYPE.TEXT && typeof text === "string"
        ? [text]
        : [];
    })
    .join(" ");
}

/** Words compared as said, whatever their case and spacing. */
function wordsOf(text: string): string {
  return text.toLowerCase().replace(/\s+/gu, " ").trim();
}

/** How many of a heard line's first words a row must hold for the line to count as held: a row grows in place, so its start is what lands first. */
const HELD_WORDS = 4;

/**
 * The lines heard on a call that its rows do not hold yet. Lines and rows
 * are matched in the order said, each row holding one line at most, so a
 * phrase said twice is held twice only where two rows hold it. A caption
 * line may be one row or several, a call that reconnected splitting it, and
 * a row grows in place, so a run of rows holds a line where it holds the
 * line's first words, or holds the start of it still growing; the rows the
 * run took are used up.
 */
function unheldLines(rows: readonly string[], lines: readonly UIMessage[]): UIMessage[] {
  let next = 0;
  return lines.filter((line) => {
    const said = wordsOf(messageText(line));
    const opening = said.split(" ").slice(0, HELD_WORDS).join(" ");
    if (opening === "") return false;
    for (let at = next; at < rows.length; at += 1) {
      const first = rows[at] ?? "";
      const holds = (run: string) => run.includes(opening) || (run !== "" && said.startsWith(run));
      let run = "";
      for (let end = at; end < rows.length; end += 1) {
        const row = rows[end] ?? "";
        run = run === "" ? row : `${run} ${row}`;
        if (holds(run)) {
          // The line takes every row after that its words run on into.
          let last = end;
          while (last + 1 < rows.length && said.startsWith(`${run} ${rows[last + 1] ?? ""}`)) {
            last += 1;
            run = `${run} ${rows[last] ?? ""}`;
          }
          next = last + 1;
          return false;
        }
        // A run longer than the opening past its first row needs that row no more.
        if (run.length > opening.length + first.length) break;
      }
    }
    return true;
  });
}

/**
 * The calls placed among an agent's transcript rows, matched by the store's
 * id for each call, which every line said on it carries. A line that reached
 * a turn while it ran is drawn inside that turn's row, so a call begins
 * before, and ends after, the row that draws its line. Only a call heard
 * here, standing or not yet on record, has lines the rows may not hold:
 * those the rows hold are drawn there, and the rest from what was heard.
 */
export function callPlaces(
  rows: readonly TranscriptRow[],
  calls: readonly TranscriptCallRow[],
): CallPlaces {
  const rowsOf = new Map<string, string[]>();
  const wordsHeld = new Map<string, string[]>();
  for (const row of rows) {
    for (const line of [row, ...(row.arrived ?? [])]) {
      const call = callOfLine(line);
      if (call === undefined) continue;
      const drawn = rowsOf.get(call) ?? [];
      if (drawn.at(-1) !== row.id) drawn.push(row.id);
      rowsOf.set(call, drawn);
      wordsHeld.set(call, [...(wordsHeld.get(call) ?? []), wordsOf(lineText(line))]);
    }
  }
  const opens = new Map<string, TranscriptCallRow[]>();
  const closes = new Map<string, TranscriptCallRow[]>();
  const heard: HeardTail[] = [];
  for (const call of calls) {
    const drawn = rowsOf.get(call.key) ?? [];
    const [first] = drawn;
    const last = drawn.at(-1);
    if (first !== undefined) opens.set(first, [...(opens.get(first) ?? []), call]);
    if (call.live || call.record === undefined) {
      const lines = unheldLines(wordsHeld.get(call.key) ?? [], call.messages);
      if (lines.length > 0) {
        heard.push({ call, opened: first !== undefined, lines });
        continue;
      }
    }
    if (!call.live && last !== undefined) closes.set(last, [...(closes.get(last) ?? []), call]);
  }
  return { opens, closes, heard };
}
