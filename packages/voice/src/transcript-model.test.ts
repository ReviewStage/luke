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
  callPlaces,
  type HeardCall,
  heardCalls,
  messageText,
  TRANSCRIPT_REGION,
  transcriptRegion,
} from "./transcript-model.js";

/** Synthetic task, calls, and words throughout. */
const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT = "0b5f8c1e-4d3a-4e6b-8f2c-9a1d7e3b5c40";
const CALL = { taskId: TASK, agentId: AGENT } as const;
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
    call: CALL,
    callTranscript: {
      voiceSessionId,
      lines: [
        { rowId: "row-1", speaker: TRANSCRIPT_SPEAKER.USER, words, startMs: 0, endMs: 1_000 },
      ],
    },
  };
}

const NO_CALL = { call: undefined, callTranscript: undefined };

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
    agentId: AGENT,
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
  const ended = heardCalls({ held: live, voice: NO_CALL, agentId: AGENT, now: 9_000 });
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
    agentId: AGENT,
    now: 5_000,
  });
  const region = transcriptRegion({ transcript: { status: TASKS_READ.READING }, heard });
  assert.equal(region.kind, TRANSCRIPT_REGION.READY);
});

test("the same call keeps when it was first heard, a call begun at once keeps the last one's words, and another agent's call is not this tab's", () => {
  const first = heardCalls({
    held: [],
    voice: liveReport(LIVE_CALL, "Seven"),
    agentId: AGENT,
    now: 5_000,
  });
  const grown = heardCalls({
    held: first,
    voice: liveReport(LIVE_CALL, "Seven days."),
    agentId: AGENT,
    now: 6_000,
  });
  assert.deepEqual(
    grown.map((call) => [call.heardAt, call.transcript.lines[0]?.words]),
    [[5_000, "Seven days."]],
  );

  const ended = heardCalls({ held: grown, voice: NO_CALL, agentId: AGENT, now: 7_000 });
  const next = heardCalls({
    held: ended,
    voice: liveReport(NEXT_CALL, "Back again."),
    agentId: AGENT,
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
      voice: {
        ...liveReport(LIVE_CALL, "Seven days."),
        call: { taskId: TASK, agentId: "another-agent" },
      },
      agentId: AGENT,
      now: 5_000,
    }),
    [],
  );
  assert.deepEqual(
    heardCalls({ held: grown, voice: NO_CALL, agentId: "another-agent", now: 9_000 }),
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
    agentId: AGENT,
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
      agentId: AGENT,
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
    call: CALL,
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
  const heard = heardCalls({ held: [], voice, agentId: AGENT, now: 9_000 });
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
    agentId: AGENT,
    now: 5_000,
  });
  const ended = heardCalls({ held: live, voice: NO_CALL, agentId: AGENT, now: 9_000 });
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

/** A row of an agent's transcript said on the call given, as the record holds it, its words as given. */
function spokenRow(id: string, call: string, words = "Words said.") {
  return {
    id,
    metadata: { channel: "voice", voice_session_id: call },
    parts: [{ type: "text", text: words }],
  };
}

/** The words of a call standing, as the voice window reports its lines. */
function standing(session: string, said: readonly string[]) {
  return {
    call: CALL,
    callTranscript: {
      voiceSessionId: session,
      lines: said.map((words, index) => ({
        rowId: `row-${index}`,
        speaker: index % 2 === 0 ? TRANSCRIPT_SPEAKER.USER : TRANSCRIPT_SPEAKER.ASSISTANT,
        words,
        startMs: index * 1_000,
        endMs: index * 1_000 + 900,
      })),
    },
  };
}

/** The calls a region over the held heard calls draws, the record holding none. */
function heardOnly(heard: readonly HeardCall[]) {
  const region = transcriptRegion({
    transcript: { status: TASKS_READ.READY, transcript: { calls: [], earlierOmitted: false } },
    heard,
  });
  return region.kind === TRANSCRIPT_REGION.READY ? region.calls : [];
}

test("an agent's transcript begins each call before its first line and closes an ended one after its last, and a typed row between stays inside", () => {
  const rows = [
    { id: "typed-0", metadata: { channel: "typed" } },
    spokenRow("said-1", EARLIER_CALL),
    { id: "turn-2" },
    spokenRow("said-3", EARLIER_CALL),
    { id: "typed-4", metadata: { channel: "typed" } },
  ];
  const region = transcriptRegion({
    transcript: { status: TASKS_READ.READY, transcript: STORED },
    heard: [],
  });
  const calls = region.kind === TRANSCRIPT_REGION.READY ? region.calls : [];
  const places = callPlaces(rows, calls);

  assert.deepEqual([...places.opens.keys()], ["said-1"]);
  assert.deepEqual([...places.closes.keys()], ["said-3"]);
  assert.deepEqual(places.heard, []);
});

test("the call standing grows at the transcript's foot with the lines no row holds yet, under its divider only where no row of it stands above", () => {
  const voice = {
    call: CALL,
    callTranscript: {
      voiceSessionId: LIVE_CALL,
      lines: [
        {
          rowId: "row-1",
          speaker: TRANSCRIPT_SPEAKER.USER,
          words: "Walk me through it.",
          startMs: 0,
          endMs: 900,
        },
        {
          rowId: "row-2",
          speaker: TRANSCRIPT_SPEAKER.ASSISTANT,
          words: "It starts in the router.",
          startMs: 1_000,
          endMs: 2_000,
        },
      ],
    },
  };
  const heard = heardCalls({ held: [], voice, agentId: AGENT, now: 9_000 });
  const region = transcriptRegion({
    transcript: { status: TASKS_READ.READY, transcript: { calls: [], earlierOmitted: false } },
    heard,
  });
  const calls = region.kind === TRANSCRIPT_REGION.READY ? region.calls : [];

  const none = callPlaces([{ id: "typed-0" }], calls);
  assert.equal(
    none.heard[0]?.opened,
    false,
    "no row of the call stands, so its divider leads the lines heard",
  );
  assert.deepEqual(none.heard[0]?.lines.map(messageText), [
    "Walk me through it.",
    "It starts in the router.",
  ]);
  assert.equal(none.opens.size, 0);

  const one = callPlaces(
    [{ id: "typed-0" }, spokenRow("said-1", LIVE_CALL, "Walk me through")],
    calls,
  );
  assert.deepEqual([...one.opens.keys()], ["said-1"]);
  assert.equal(one.heard[0]?.opened, true);
  assert.deepEqual(
    one.heard[0]?.lines.map(messageText),
    ["It starts in the router."],
    "a row still growing holds the line it began",
  );
  assert.equal(one.closes.size, 0, "a call still standing has not closed");
});

test("a call whose lines reached a turn while it ran begins before, and ends after, the turn's row that draws them", () => {
  const [stored] = STORED.calls;
  assert.ok(stored);
  const region = transcriptRegion({
    transcript: {
      status: TASKS_READ.READY,
      transcript: { calls: [{ ...stored, id: EARLIER_CALL }], earlierOmitted: false },
    },
    heard: [],
  });
  const calls = region.kind === TRANSCRIPT_REGION.READY ? region.calls : [];
  const turn = {
    id: "turn-1",
    arrived: [spokenRow("said-1", EARLIER_CALL), spokenRow("said-2", EARLIER_CALL)],
  };
  const places = callPlaces([{ id: "typed-0" }, turn, { id: "typed-3" }], calls);

  assert.deepEqual([...places.opens.keys()], ["turn-1"]);
  assert.deepEqual([...places.closes.keys()], ["turn-1"]);
});

test("each call heard here that the rows do not hold yet keeps its own tail, in the order the calls began, so a quick redial hides neither", () => {
  const first = heardCalls({
    held: [],
    voice: standing(EARLIER_CALL, ["Make them expire.", "After seven days."]),
    agentId: AGENT,
    now: 5_000,
  });
  const ended = heardCalls({ held: first, voice: NO_CALL, agentId: AGENT, now: 6_000 });
  const both = heardCalls({
    held: ended,
    voice: standing(LIVE_CALL, ["And withdrawn ones?"]),
    agentId: AGENT,
    now: 7_000,
  });
  const places = callPlaces([{ id: "typed-0" }], heardOnly(both));

  assert.deepEqual(
    places.heard.map((tail) => [tail.call.key, tail.lines.map(messageText)]),
    [
      [EARLIER_CALL, ["Make them expire.", "After seven days."]],
      [LIVE_CALL, ["And withdrawn ones?"]],
    ],
  );
});

test("a heard line the record wrote as two rows counts as held, and a later line no row holds stands at the foot", () => {
  const heard = heardCalls({
    held: [],
    voice: standing(LIVE_CALL, [
      "Walk me through how the job finds stale invites.",
      "It reads the oldest first.",
    ]),
    agentId: AGENT,
    now: 9_000,
  });
  const rows = [
    spokenRow("said-1", LIVE_CALL, "Walk me through how"),
    spokenRow("said-2", LIVE_CALL, "the job finds stale invites."),
  ];
  const places = callPlaces(rows, heardOnly(heard));

  assert.deepEqual(places.heard[0]?.lines.map(messageText), ["It reads the oldest first."]);
});

test("a phrase said twice on a call with one row holding it keeps its second saying at the foot", () => {
  const heard = heardCalls({
    held: [],
    voice: standing(LIVE_CALL, ["Yes.", "Seven days?", "Yes."]),
    agentId: AGENT,
    now: 9_000,
  });
  const rows = [
    spokenRow("said-1", LIVE_CALL, "Yes."),
    spokenRow("said-2", LIVE_CALL, "Seven days?"),
  ];
  const places = callPlaces(rows, heardOnly(heard));

  assert.deepEqual(places.heard[0]?.lines.map(messageText), ["Yes."]);
});

test("two calls whose lines reached one running turn both begin and end at that turn's row, in the order they began", () => {
  const [stored] = STORED.calls;
  assert.ok(stored);
  const region = transcriptRegion({
    transcript: {
      status: TASKS_READ.READY,
      transcript: {
        calls: [
          { ...stored, id: EARLIER_CALL, startedAt: 1_000 },
          { ...stored, id: NEXT_CALL, startedAt: 2_000 },
        ],
        earlierOmitted: false,
      },
    },
    heard: [],
  });
  const calls = region.kind === TRANSCRIPT_REGION.READY ? region.calls : [];
  const turn = {
    id: "turn-1",
    arrived: [spokenRow("said-1", EARLIER_CALL), spokenRow("said-2", NEXT_CALL)],
  };
  const places = callPlaces([turn], calls);

  assert.deepEqual(
    places.opens.get("turn-1")?.map((call) => call.key),
    [EARLIER_CALL, NEXT_CALL],
  );
  assert.deepEqual(
    places.closes.get("turn-1")?.map((call) => call.key),
    [EARLIER_CALL, NEXT_CALL],
  );
});

test("a heard line a reconnected call wrote over three rows counts as held, its rows used up, and the next line no row holds stands at the foot", () => {
  const heard = heardCalls({
    held: [],
    voice: standing(LIVE_CALL, ["Walk me through this now.", "Me through the rest, please."]),
    agentId: AGENT,
    now: 9_000,
  });
  const rows = [
    spokenRow("said-1", LIVE_CALL, "Walk"),
    spokenRow("said-2", LIVE_CALL, "me through"),
    spokenRow("said-3", LIVE_CALL, "this now."),
  ];
  const places = callPlaces(rows, heardOnly(heard));

  assert.deepEqual(places.heard[0]?.lines.map(messageText), ["Me through the rest, please."]);
});
