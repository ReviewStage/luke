import assert from "node:assert/strict";
import { TRANSCRIPT_PART_TYPE } from "@sidecar/hosted/transcript-wire";
import { TRANSCRIPT_SPEAKER, type TranscriptSpeaker } from "@sidecar/live";
import type { UIMessage } from "ai";
import { test } from "vitest";
import { type CallTurn, callThread, THREAD_ITEM, type ThreadSection } from "./call-thread";
import { TRANSCRIPT_REGION, type TranscriptCallRow, transcriptRegion } from "./transcript-model";

/** Synthetic calls, lines, and turns throughout. */
const MINUTE = 60_000;
const FIRST_CALL = 1_000 * MINUTE;
const SECOND_CALL = 2_000 * MINUTE;

/** A line said on a call, naming its row where the record holds one. */
function line(id: string, role: TranscriptSpeaker, text: string, rowId?: string): UIMessage {
  return {
    id,
    role,
    parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text }],
    ...(rowId === undefined ? undefined : { metadata: { rowId } }),
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

function turn(key: string, startedAt: number, asked: readonly string[] = []): CallTurn<string> {
  return { key, startedAt, asked, turn: key };
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

test("a line heard on the call standing now names its row as a line on record does, so the work it asked for stands under it", () => {
  const region = transcriptRegion({
    transcript: undefined,
    heard: [
      {
        planId: "plan-1",
        heardAt: FIRST_CALL,
        live: true,
        transcript: {
          voiceSessionId: "call-live",
          lines: [
            { rowId: "row-heard", speaker: USER, words: "Check how removal works." },
            { rowId: "row-reply", speaker: ASSISTANT, words: "Checking." },
          ],
        },
      },
    ],
  });
  assert.equal(region.kind, TRANSCRIPT_REGION.READY);
  if (region.kind !== TRANSCRIPT_REGION.READY) return;
  const thread = callThread(region.calls, [turn("turn-removal", FIRST_CALL, ["row-heard"])]);
  assert.deepEqual(read(thread), [
    [
      "call-live",
      ["user: Check how removal works.", "work turn-removal (spoken)", "assistant: Checking."],
    ],
  ]);
});
