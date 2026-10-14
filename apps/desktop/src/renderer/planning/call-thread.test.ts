import assert from "node:assert/strict";
import { TRANSCRIPT_PART_TYPE } from "@sidecar/features/transcript-wire";
import { TRANSCRIPT_SPEAKER, type TranscriptSpeaker } from "@sidecar/live";
import type { UIMessage } from "ai";
import { test } from "vitest";
import { type CallTurn, callThread, THREAD_ITEM, type ThreadSection } from "./call-thread";
import { messageText, type TranscriptCallRow } from "./transcript-model";

/** Synthetic calls and lines throughout. */
const LIVE_CALL = "call-live";
const ENDED_CALL = "call-ended";

/** A line said on a call: its words, where on the call it began and ended where it says, and the rows the record holds it as where it says. */
function line(
  id: string,
  role: TranscriptSpeaker,
  text: string,
  ties: { span?: { startMs: number; endMs: number }; rowIds?: readonly string[] } = {},
): UIMessage {
  return { id, role, parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text }], metadata: ties };
}

/** A turn placed by its key alone, started at `startedAt`, with the ask and the voice's word on it `rest` gives it. */
function turn(
  key: string,
  startedAt: number,
  rest: Partial<Pick<CallTurn<string>, "asked" | "askedAt" | "spoken">> = {},
): CallTurn<string> {
  return { key, startedAt, asked: [], askedAt: [], spoken: false, ...rest, turn: key };
}

/** The thread as a reader scans it: each call's entries in order, a line by its words and a turn by its key with whether Luke says its words, and a turn between calls the same. */
function scanned(sections: readonly ThreadSection<string>[]): unknown[] {
  const work = (entry: { turn: CallTurn<string>; spoken: boolean }) => [
    entry.turn.key,
    entry.spoken,
  ];
  return sections.map((section) =>
    section.kind === THREAD_ITEM.CALL
      ? section.entries.map((entry) =>
          entry.kind === THREAD_ITEM.LINE ? messageText(entry.line) : work(entry),
        )
      : work(section),
  );
}

test("on the call standing, a turn no line asked for stands by time among the lines: the look around the call opened with at its top, a later one after the last line that began before it, and a turn a line asked for under that line, the turns under one line in the order they started, whichever the voice asked for folded as spoken", () => {
  const live: TranscriptCallRow = {
    key: LIVE_CALL,
    startedAt: 100_000,
    live: true,
    lukeEnded: false,
    messages: [
      line("r1", TRANSCRIPT_SPEAKER.USER, "Hello.", { span: { startMs: 5_000, endMs: 6_000 } }),
      line("r2", TRANSCRIPT_SPEAKER.ASSISTANT, "Hi.", { span: { startMs: 7_000, endMs: 8_000 } }),
      line("r3", TRANSCRIPT_SPEAKER.USER, "Look into invites.", {
        span: { startMs: 20_000, endMs: 22_000 },
      }),
    ],
  };
  const sections = callThread(
    [live],
    [
      turn("asked", 121_000, { askedAt: [{ voiceSessionId: LIVE_CALL, fromMs: 20_500 }] }),
      turn("woken", 110_000),
      turn("explore", 95_000, { spoken: true }),
      turn("woken-later", 120_500),
    ],
  );
  assert.deepEqual(scanned(sections), [
    [
      ["explore", true],
      "Hello.",
      "Hi.",
      ["woken", false],
      "Look into invites.",
      ["woken-later", false],
      ["asked", true],
    ],
  ]);
});

test("on a call that ended, a turn no line asked for stands by time among the recorded lines too, and after every line where the lines say no time, as a transcript read from an older service does", () => {
  const ended: TranscriptCallRow = {
    key: ENDED_CALL,
    startedAt: 200_000,
    live: false,
    lukeEnded: false,
    record: { endedAt: 260_000 },
    messages: [
      line("0", TRANSCRIPT_SPEAKER.USER, "Morning.", {
        span: { startMs: 3_000, endMs: 4_000 },
        rowIds: ["row-morning"],
      }),
      line("1", TRANSCRIPT_SPEAKER.USER, "Any news?", {
        span: { startMs: 30_000, endMs: 31_000 },
        rowIds: ["row-news"],
      }),
    ],
  };
  assert.deepEqual(
    scanned(
      callThread([ended], [turn("late", 210_000), turn("explore", 201_000, { spoken: true })]),
    ),
    [[["explore", true], "Morning.", ["late", false], "Any news?"]],
  );

  const untimed: TranscriptCallRow = {
    ...ended,
    messages: [
      line("0", TRANSCRIPT_SPEAKER.USER, "Morning.", { rowIds: ["row-morning"] }),
      line("1", TRANSCRIPT_SPEAKER.USER, "Any news?", { rowIds: ["row-news"] }),
    ],
  };
  assert.deepEqual(scanned(callThread([untimed], [turn("explore", 201_000, { spoken: true })])), [
    ["Morning.", "Any news?", ["explore", true]],
  ]);
});
