import assert from "node:assert/strict";
import { TRANSCRIPT_PART_TYPE } from "@sidecar/hosted/transcript-wire";
import { TRANSCRIPT_SPEAKER, type TranscriptSpeaker } from "@sidecar/live";
import type { UIMessage } from "ai";
import { test } from "vitest";
import { type CallTurn, callThread, THREAD_ITEM, type ThreadSection } from "./call-thread";
import {
  type HeardCall,
  TRANSCRIPT_REGION,
  type TranscriptCallRow,
  transcriptRegion,
} from "./transcript-model";

/** Synthetic calls, lines, and turns throughout. */
const MINUTE = 60_000;
const FIRST_CALL = 1_000 * MINUTE;
const SECOND_CALL = 2_000 * MINUTE;

/** A line said on a call, naming its rows where the record holds any. */
function line(id: string, role: TranscriptSpeaker, text: string, ...rowIds: string[]): UIMessage {
  return {
    id,
    role,
    parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text }],
    ...(rowIds.length === 0 ? undefined : { metadata: { rowIds } }),
  };
}

function call(
  key: string,
  startedAt: number,
  messages: readonly UIMessage[],
  endedAt?: number,
): TranscriptCallRow {
  return {
    key,
    startedAt,
    live: endedAt === undefined,
    lukeEnded: false,
    messages,
    ...(endedAt === undefined ? undefined : { record: { endedAt } }),
  };
}

function turn(
  key: string,
  startedAt: number,
  asked: readonly string[] = [],
  askedAt: CallTurn<string>["askedAt"] = [],
): CallTurn<string> {
  return { key, startedAt, asked, askedAt, turn: key };
}

/** The thread as a reader takes it in: each call's lines by their words and each turn's work by its key, marked spoken where a line asked for it. */
function read(sections: readonly ThreadSection<string>[]) {
  const said = (entry: ThreadSection<string>) =>
    entry.kind === THREAD_ITEM.WORK
      ? `work ${entry.turn.key}${entry.spoken ? " (spoken)" : ""}`
      : "";
  return sections.map((section) =>
    section.kind === THREAD_ITEM.CALL
      ? [
          section.call.key,
          section.entries.map((entry) =>
            entry.kind === THREAD_ITEM.LINE
              ? `${entry.line.role}: ${entry.line.parts[0]?.type === "text" ? entry.line.parts[0].text : ""}`
              : said(entry),
          ),
        ]
      : said(section),
  );
}

const { USER, ASSISTANT } = TRANSCRIPT_SPEAKER;

test("a turn's work stands right under the line that asked for it, Luke's answer after it, and a turn whose ask spans two lines stands under the later", () => {
  const thread = callThread(
    [
      call(
        "call-1",
        FIRST_CALL,
        [
          line("0", USER, "Who can withdraw an invite?", "row-who"),
          line("1", ASSISTANT, "Either the sender or an admin.", "row-either"),
          line("2", USER, "Is there a library for invites?", "row-library"),
          line("3", USER, "And start an agent on accepting them.", "row-agent"),
          line("4", ASSISTANT, "On it.", "row-on-it"),
        ],
        FIRST_CALL + 10 * MINUTE,
      ),
    ],
    [
      turn("turn-library", FIRST_CALL + 3 * MINUTE, ["row-agent", "row-library"]),
      turn("turn-who", FIRST_CALL + MINUTE, ["row-who"]),
    ],
  );
  assert.deepEqual(read(thread), [
    [
      "call-1",
      [
        "user: Who can withdraw an invite?",
        "work turn-who (spoken)",
        "assistant: Either the sender or an admin.",
        "user: Is there a library for invites?",
        "user: And start an agent on accepting them.",
        "work turn-library (spoken)",
        "assistant: On it.",
      ],
    ],
  ]);
});

test("a turn no line on screen asked for stands where it started: in its call after the lines, between calls once its call had ended, or ahead of every call", () => {
  const thread = callThread(
    [
      call("call-1", FIRST_CALL, [line("0", USER, "Invites expire.")], FIRST_CALL + MINUTE),
      call("call-2", SECOND_CALL, [line("0", USER, "Seven days.", "row-seven")]),
    ],
    [
      turn("typed-early", FIRST_CALL - MINUTE),
      turn("during-first", FIRST_CALL + 30_000, ["row-not-read"]),
      turn("after-first", FIRST_CALL + 5 * MINUTE),
      turn("during-live", SECOND_CALL + MINUTE),
    ],
  );
  assert.deepEqual(read(thread), [
    "work typed-early",
    ["call-1", ["user: Invites expire.", "work during-first"]],
    "work after-first",
    ["call-2", ["user: Seven days.", "work during-live"]],
  ]);
});

test("a line heard on the call standing now, under the voice window's own row id, takes the work asked by where it began, and keeps it as later lines are said and later work finishes", () => {
  const heard = (lines: NonNullable<HeardCall["transcript"]>["lines"]) =>
    transcriptRegion({
      transcript: undefined,
      heard: [
        {
          planId: "plan-1",
          heardAt: FIRST_CALL,
          live: true,
          transcript: { voiceSessionId: "call-live", lines },
        },
      ],
    });
  const said = (rowId: string, speaker: TranscriptSpeaker, words: string, startMs: number) => ({
    rowId,
    speaker,
    words,
    startMs,
    endMs: startMs + 2_000,
  });
  const region = heard([
    said("1", ASSISTANT, "Hi there! This plan looks new.", 0),
    said("2", USER, "Can you check the brain for page tools?", 4_000),
    said("3", ASSISTANT, "Hold on, I'm reading the repository.", 7_000),
    said("4", ASSISTANT, "Yes, it has a show_page tool.", 20_000),
    said("5", USER, "Make a fully interactive page.", 30_000),
    // Luke's reply overlaps the ask, which an ask's span must not reach.
    said("6", ASSISTANT, "Okay, I'll take a look.", 31_000),
  ]);
  assert.equal(region.kind, TRANSCRIPT_REGION.READY);
  if (region.kind !== TRANSCRIPT_REGION.READY) return;
  // The service names each ask by its own row ids, which no heard line carries, and by where each began.
  const thread = callThread(region.calls, [
    turn(
      "turn-page",
      FIRST_CALL + 31_000,
      ["service-row-make"],
      [{ voiceSessionId: "call-live", fromMs: 31_500 }],
    ),
    turn(
      "turn-brain",
      FIRST_CALL + 5_000,
      ["service-row-check"],
      [{ voiceSessionId: "call-live", fromMs: 4_000 }],
    ),
    turn(
      "turn-elsewhere",
      FIRST_CALL + 9_000,
      ["service-row-other"],
      [{ voiceSessionId: "call-earlier", fromMs: 4_000 }],
    ),
  ]);
  assert.deepEqual(read(thread), [
    [
      "call-live",
      [
        "assistant: Hi there! This plan looks new.",
        "user: Can you check the brain for page tools?",
        "work turn-brain (spoken)",
        "assistant: Hold on, I'm reading the repository.",
        "assistant: Yes, it has a show_page tool.",
        "user: Make a fully interactive page.",
        "work turn-page (spoken)",
        "assistant: Okay, I'll take a look.",
        "work turn-elsewhere",
      ],
    ],
  ]);
});

test("a line read back as one though the call wrote it as two rows takes the work either row asked for", () => {
  const thread = callThread(
    [
      call("call-1", FIRST_CALL, [
        line("0", USER, "Check how removal works.", "row-check", "row-check-again"),
        line("1", ASSISTANT, "It checks for an admin.", "row-admin"),
      ]),
    ],
    [turn("turn-removal", FIRST_CALL + MINUTE, ["row-check-again"])],
  );
  assert.deepEqual(read(thread), [
    [
      "call-1",
      [
        "user: Check how removal works.",
        "work turn-removal (spoken)",
        "assistant: It checks for an admin.",
      ],
    ],
  ]);
});

test("a call that ended with no end on record holds no turn no line asked for, which stands after it, and the call standing now holds one begun a little before it was first heard", () => {
  const unrecorded: TranscriptCallRow = {
    ...call("call-1", FIRST_CALL, [line("0", USER, "Invites expire.")], FIRST_CALL + MINUTE),
    record: {},
  };
  const live = call("call-2", SECOND_CALL, [line("0", USER, "Seven days.")]);
  const thread = callThread(
    [unrecorded, live],
    [turn("typed-after", FIRST_CALL + 30_000), turn("begun-early", SECOND_CALL - 5_000)],
  );
  assert.deepEqual(read(thread), [
    ["call-1", ["user: Invites expire."]],
    "work typed-after",
    ["call-2", ["user: Seven days.", "work begun-early"]],
  ]);
});
