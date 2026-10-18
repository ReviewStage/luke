import assert from "node:assert/strict";
import { TASKS_READ } from "@luke/features/tasks-view";
import {
  type TaskTranscript,
  TRANSCRIPT_PART_TYPE,
  type TranscriptMessage,
} from "@luke/features/transcript-wire";
import { LIVE_CLOSE_REASON, LIVE_DEFAULTS, TRANSCRIPT_SPEAKER } from "@luke/live";
import { test } from "vitest";
import {
  callEndedLine,
  type HeardCall,
  heardCalls,
  messageText,
  TRANSCRIPT_REGION,
  transcriptRegion,
} from "./transcript-model.js";

/** Synthetic task, calls, and words throughout. */
const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const EARLIER_CALL = "5d2c8f61-3a7e-4b19-8c0d-2e9f4a6b7c81";
const LIVE_CALL = "9e4b1a2c-6d3f-4e8a-b7c5-1f2a3b4c5d6e";
const NEXT_CALL = "2a4c6e8f-0b1d-4f3a-a5c7-9e1b3d5f7a9c";

/** One line as the record answers it: its place on the call, the speaker as the role, the words as one text part. */
function spoken(index: number, role: TranscriptMessage["role"], text: string): TranscriptMessage {
  return { id: String(index), role, parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text }] };
}

const STORED: TaskTranscript = {
  calls: [
    {
      id: EARLIER_CALL,
      startedAt: 1_000,
      messages: [
        spoken(0, TRANSCRIPT_SPEAKER.USER, " Invites  should\nexpire. "),
        spoken(1, TRANSCRIPT_SPEAKER.ASSISTANT, "   "),
        spoken(2, TRANSCRIPT_SPEAKER.ASSISTANT, "After how many days?"),
      ],
    },
  ],
  earlierOmitted: false,
};

function liveReport(voiceSessionId: string, words: string) {
  return {
    callTaskId: TASK,
    callTranscript: {
      voiceSessionId,
      lines: [
        { rowId: "row-1", speaker: TRANSCRIPT_SPEAKER.USER, words, startMs: 0, endMs: 1_000 },
      ],
    },
  };
}

const NO_CALL = { callTaskId: undefined, callTranscript: undefined };

test("the stored calls are drawn oldest first as messages with their words settled, and blank lines left out", () => {
  const region = transcriptRegion({
    transcript: { status: TASKS_READ.READY, transcript: STORED },
    heard: [],
  });

  assert.equal(region.kind, TRANSCRIPT_REGION.READY);
  assert.deepEqual(
    region.kind === TRANSCRIPT_REGION.READY ? region.calls.map((call) => call.messages) : [],
    [
      [
        spoken(0, TRANSCRIPT_SPEAKER.USER, "Invites should expire."),
        spoken(2, TRANSCRIPT_SPEAKER.ASSISTANT, "After how many days?"),
      ],
    ],
  );
});

test("a plan with nothing said is empty, a read out is reading, and a read that failed is failed", () => {
  const empty = { calls: [], earlierOmitted: false };
  assert.deepEqual(
    transcriptRegion({
      transcript: { status: TASKS_READ.READY, transcript: empty },
      heard: [],
    }),
    { kind: TRANSCRIPT_REGION.EMPTY },
  );
  assert.deepEqual(transcriptRegion({ transcript: { status: TASKS_READ.READING }, heard: [] }), {
    kind: TRANSCRIPT_REGION.READING,
  });
  assert.deepEqual(transcriptRegion({ transcript: { status: TASKS_READ.FAILED }, heard: [] }), {
    kind: TRANSCRIPT_REGION.FAILED,
  });
});

/** The calls drawn, each as its key, whether it is live, and its first line's words. */
function drawn(region: ReturnType<typeof transcriptRegion>) {
  return region.kind === TRANSCRIPT_REGION.READY
    ? region.calls.map((call) => {
        const [first] = call.messages;
        return [call.key, call.live, first === undefined ? undefined : messageText(first)];
      })
    : [];
}

/** The stored transcript with the live call recorded as saying `text`. */
function recordedSaying(text: string): TaskTranscript {
  return {
    ...STORED,
    calls: [
      ...STORED.calls,
      { id: LIVE_CALL, startedAt: 4_000, messages: [spoken(0, TRANSCRIPT_SPEAKER.USER, text)] },
    ],
  };
}

test("the live call follows the stored calls, and its words outlast the call until the record catches up", () => {
  const live = heardCalls({
    held: [],
    voice: liveReport(LIVE_CALL, "Seven days, then."),
    taskId: TASK,
    now: 5_000,
  });
  const ready = (transcript: TaskTranscript, heard: readonly HeardCall[]) =>
    transcriptRegion({ transcript: { status: TASKS_READ.READY, transcript }, heard });
  assert.deepEqual(drawn(ready(STORED, live)), [
    [EARLIER_CALL, false, "Invites should expire."],
    [LIVE_CALL, true, "Seven days, then."],
  ]);
  // A read mid-call that already holds some of the call still draws it live, as heard.
  assert.deepEqual(drawn(ready(recordedSaying("Seven"), live)), [
    [EARLIER_CALL, false, "Invites should expire."],
    [LIVE_CALL, true, "Seven days, then."],
  ]);

  // Hung up: the heard words stay until the record has as many.
  const ended = heardCalls({ held: live, voice: NO_CALL, taskId: TASK, now: 9_000 });
  assert.deepEqual(drawn(ready(STORED, ended)), [
    [EARLIER_CALL, false, "Invites should expire."],
    [LIVE_CALL, false, "Seven days, then."],
  ]);
  assert.deepEqual(drawn(ready(recordedSaying("Seven"), ended)), [
    [EARLIER_CALL, false, "Invites should expire."],
    [LIVE_CALL, false, "Seven days, then."],
  ]);
  assert.deepEqual(drawn(ready(recordedSaying("Seven days, then, okay."), ended)), [
    [EARLIER_CALL, false, "Invites should expire."],
    [LIVE_CALL, false, "Seven days, then, okay."],
  ]);
});

test("the live call is drawn while the stored transcript is still being read", () => {
  const heard = heardCalls({
    held: [],
    voice: liveReport(LIVE_CALL, "Seven days."),
    taskId: TASK,
    now: 5_000,
  });
  const region = transcriptRegion({ transcript: { status: TASKS_READ.READING }, heard });
  assert.equal(region.kind, TRANSCRIPT_REGION.READY);
});

test("the same call keeps when it was first heard, a call begun at once keeps the last one's words, and another plan's call is not this tab's", () => {
  const first = heardCalls({
    held: [],
    voice: liveReport(LIVE_CALL, "Seven"),
    taskId: TASK,
    now: 5_000,
  });
  const grown = heardCalls({
    held: first,
    voice: liveReport(LIVE_CALL, "Seven days."),
    taskId: TASK,
    now: 6_000,
  });
  assert.deepEqual(
    grown.map((call) => [call.heardAt, call.transcript.lines[0]?.words]),
    [[5_000, "Seven days."]],
  );

  const ended = heardCalls({ held: grown, voice: NO_CALL, taskId: TASK, now: 7_000 });
  const next = heardCalls({
    held: ended,
    voice: liveReport(NEXT_CALL, "Back again."),
    taskId: TASK,
    now: 8_000,
  });
  assert.deepEqual(
    drawn(
      transcriptRegion({
        transcript: { status: TASKS_READ.READY, transcript: STORED },
        heard: next,
      }),
    ),
    [
      [EARLIER_CALL, false, "Invites should expire."],
      [LIVE_CALL, false, "Seven days."],
      [NEXT_CALL, true, "Back again."],
    ],
  );

  assert.deepEqual(
    heardCalls({
      held: [],
      voice: { ...liveReport(LIVE_CALL, "Seven days."), callTaskId: "another-plan" },
      taskId: TASK,
      now: 5_000,
    }),
    [],
  );
  assert.deepEqual(
    heardCalls({ held: grown, voice: NO_CALL, taskId: "another-plan", now: 9_000 }),
    [],
  );
});

test("a call that ended closes with a line saying so, one Luke ended says he did, and the call standing closes with none", () => {
  const stored: TaskTranscript = {
    calls: [
      { id: EARLIER_CALL, startedAt: 1_000, messages: [spoken(0, TRANSCRIPT_SPEAKER.USER, "Hi.")] },
      { id: NEXT_CALL, startedAt: 2_000, messages: [spoken(0, TRANSCRIPT_SPEAKER.USER, "Bye.")] },
    ],
    earlierOmitted: false,
  };
  const heard = heardCalls({
    held: [],
    voice: liveReport(LIVE_CALL, "Hello again"),
    taskId: TASK,
    now: 3_000,
  });
  const region = transcriptRegion({
    transcript: { status: TASKS_READ.READY, transcript: stored },
    heard,
    lukeEndedCall: NEXT_CALL,
  });

  assert.equal(region.kind, TRANSCRIPT_REGION.READY);
  assert.deepEqual(region.kind === TRANSCRIPT_REGION.READY ? region.calls.map(callEndedLine) : [], [
    "Call ended",
    "Luke ended the call",
    undefined,
  ]);
});

test("a stored call carries what its record holds of how it ended, and the call standing, though the record holds it, carries none", () => {
  const record = {
    endedAt: 9_000,
    ending: LIVE_CLOSE_REASON.CONNECTION_LOST,
    usage: { seconds: 8, confirmed: true },
    model: LIVE_DEFAULTS.MODEL,
  };
  const stored: TaskTranscript = {
    calls: [
      {
        id: EARLIER_CALL,
        startedAt: 1_000,
        messages: [spoken(0, TRANSCRIPT_SPEAKER.USER, "Hi.")],
        ...record,
      },
      {
        id: LIVE_CALL,
        startedAt: 10_000,
        messages: [spoken(0, TRANSCRIPT_SPEAKER.USER, "Hello")],
        model: LIVE_DEFAULTS.MODEL,
      },
    ],
    earlierOmitted: false,
  };
  const region = transcriptRegion({
    transcript: { status: TASKS_READ.READY, transcript: stored },
    heard: heardCalls({
      held: [],
      voice: liveReport(LIVE_CALL, "Hello again"),
      taskId: TASK,
      now: 11_000,
    }),
  });

  assert.equal(region.kind, TRANSCRIPT_REGION.READY);
  assert.deepEqual(
    region.kind === TRANSCRIPT_REGION.READY ? region.calls.map((call) => call.record) : [],
    [record, undefined],
  );
});

test("the call standing is dated from when it was first heard, less how far into the call its first line began, so a turn begun before any line stands ahead of them all", () => {
  const voice = {
    callTaskId: TASK,
    callTranscript: {
      voiceSessionId: LIVE_CALL,
      lines: [
        {
          rowId: "row-1",
          speaker: TRANSCRIPT_SPEAKER.USER,
          words: "Seven days.",
          startMs: 4_000,
          endMs: 5_000,
        },
      ],
    },
  };
  const heard = heardCalls({ held: [], voice, taskId: TASK, now: 9_000 });
  const region = transcriptRegion({ transcript: { status: TASKS_READ.READING }, heard });
  assert.deepEqual(
    region.kind === TRANSCRIPT_REGION.READY ? region.calls.map((call) => call.startedAt) : [],
    [5_000],
  );
});

test("a teammate's call is named for the reader, the reader's own is not, and a call nobody can be named for is not", () => {
  const DEAN = { userId: "user-dean", name: "Dean Stratakos" };
  const CHARLES = { userId: "user-charles", name: "Charles Pan" };
  const [call] = STORED.calls;
  const transcript: TaskTranscript = {
    calls: [
      { ...call!, id: EARLIER_CALL, by: DEAN },
      { ...call!, id: NEXT_CALL, startedAt: 2_000, by: CHARLES },
      { ...call!, id: LIVE_CALL, startedAt: 3_000 },
    ],
    earlierOmitted: false,
  };
  const callers = (readerId: string) => {
    const region = transcriptRegion({
      transcript: { status: TASKS_READ.READY, transcript },
      heard: [],
      readerId,
    });
    return region.kind === TRANSCRIPT_REGION.READY ? region.calls.map((each) => each.caller) : [];
  };

  // Note that the caller keeps their account's id, which the window reads their face by.
  assert.deepEqual(callers(DEAN.userId), [undefined, CHARLES, undefined]);
  assert.deepEqual(callers(CHARLES.userId), [DEAN, undefined, undefined]);
});

test("a teammate's call drawn from what was heard, while its record holds fewer words, is still named for them", () => {
  const CHARLES = { userId: "user-charles", name: "Charles Pan" };
  const live = heardCalls({
    held: [],
    voice: liveReport(LIVE_CALL, "Seven days, then."),
    taskId: TASK,
    now: 5_000,
  });
  const ended = heardCalls({ held: live, voice: NO_CALL, taskId: TASK, now: 9_000 });
  const recorded = recordedSaying("Seven");
  const transcript: TaskTranscript = {
    ...recorded,
    calls: recorded.calls.map((call) => (call.id === LIVE_CALL ? { ...call, by: CHARLES } : call)),
  };
  const region = transcriptRegion({
    transcript: { status: TASKS_READ.READY, transcript },
    heard: ended,
    readerId: "user-dean",
  });

  assert.deepEqual(drawn(region).at(-1), [LIVE_CALL, false, "Seven days, then."]);
  assert.deepEqual(
    region.kind === TRANSCRIPT_REGION.READY ? region.calls.at(-1)?.caller : undefined,
    CHARLES,
  );
});
