import assert from "node:assert/strict";
import { PLANNING_READ } from "@sidecar/hosted/planning-view";
import type { PlanTranscript } from "@sidecar/hosted/transcript-wire";
import { TRANSCRIPT_SPEAKER } from "@sidecar/live";
import { test } from "vitest";
import {
  callHeading,
  followsNewest,
  type HeardCall,
  heardCalls,
  TRANSCRIPT_REGION,
  transcriptRegion,
} from "./transcript-model";

/** Synthetic plan, calls, and words throughout. */
const PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const EARLIER_CALL = "5d2c8f61-3a7e-4b19-8c0d-2e9f4a6b7c81";
const LIVE_CALL = "9e4b1a2c-6d3f-4e8a-b7c5-1f2a3b4c5d6e";
const NEXT_CALL = "2a4c6e8f-0b1d-4f3a-a5c7-9e1b3d5f7a9c";

const STORED: PlanTranscript = {
  calls: [
    {
      id: EARLIER_CALL,
      startedAt: 1_000,
      lines: [
        { speaker: TRANSCRIPT_SPEAKER.USER, text: " Invites  should\nexpire. " },
        { speaker: TRANSCRIPT_SPEAKER.ASSISTANT, text: "   " },
        { speaker: TRANSCRIPT_SPEAKER.ASSISTANT, text: "After how many days?" },
      ],
    },
  ],
  earlierOmitted: false,
};

function liveReport(voiceSessionId: string, words: string) {
  return {
    callPlanId: PLAN,
    callTranscript: {
      voiceSessionId,
      lines: [{ rowId: "row-1", speaker: TRANSCRIPT_SPEAKER.USER, words }],
    },
  };
}

const NO_CALL = { callPlanId: undefined, callTranscript: undefined };

test("the stored calls are drawn oldest first with their words settled, and blank lines left out", () => {
  const region = transcriptRegion({
    transcript: { status: PLANNING_READ.READY, transcript: STORED },
    heard: [],
  });

  assert.equal(region.kind, TRANSCRIPT_REGION.READY);
  assert.deepEqual(
    region.kind === TRANSCRIPT_REGION.READY
      ? region.calls.map((call) => call.lines.map((line) => [line.speaker, line.text]))
      : [],
    [
      [
        [TRANSCRIPT_SPEAKER.USER, "Invites should expire."],
        [TRANSCRIPT_SPEAKER.ASSISTANT, "After how many days?"],
      ],
    ],
  );
});

test("a plan with nothing said is empty, a read out is reading, and a read that failed is failed", () => {
  const empty = { calls: [], earlierOmitted: false };
  assert.deepEqual(
    transcriptRegion({
      transcript: { status: PLANNING_READ.READY, transcript: empty },
      heard: [],
    }),
    { kind: TRANSCRIPT_REGION.EMPTY },
  );
  assert.deepEqual(transcriptRegion({ transcript: { status: PLANNING_READ.READING }, heard: [] }), {
    kind: TRANSCRIPT_REGION.READING,
  });
  assert.deepEqual(transcriptRegion({ transcript: { status: PLANNING_READ.FAILED }, heard: [] }), {
    kind: TRANSCRIPT_REGION.FAILED,
  });
});

/** The calls drawn, each as its key, whether it is live, and its first line's words. */
function drawn(region: ReturnType<typeof transcriptRegion>) {
  return region.kind === TRANSCRIPT_REGION.READY
    ? region.calls.map((call) => [call.key, call.live, call.lines[0]?.text])
    : [];
}

/** The stored transcript with the live call recorded as saying `text`. */
function recordedSaying(text: string): PlanTranscript {
  return {
    ...STORED,
    calls: [
      ...STORED.calls,
      { id: LIVE_CALL, startedAt: 4_000, lines: [{ speaker: TRANSCRIPT_SPEAKER.USER, text }] },
    ],
  };
}

test("the live call follows the stored calls, and its words outlast the call until the record catches up", () => {
  const live = heardCalls({
    held: [],
    voice: liveReport(LIVE_CALL, "Seven days, then."),
    planId: PLAN,
    now: 5_000,
  });
  const ready = (transcript: PlanTranscript, heard: readonly HeardCall[]) =>
    transcriptRegion({ transcript: { status: PLANNING_READ.READY, transcript }, heard });
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
  const ended = heardCalls({ held: live, voice: NO_CALL, planId: PLAN, now: 9_000 });
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
    planId: PLAN,
    now: 5_000,
  });
  const region = transcriptRegion({ transcript: { status: PLANNING_READ.READING }, heard });
  assert.equal(region.kind, TRANSCRIPT_REGION.READY);
});

test("the same call keeps when it was first heard, a call begun at once keeps the last one's words, and another plan's call is not this tab's", () => {
  const first = heardCalls({
    held: [],
    voice: liveReport(LIVE_CALL, "Seven"),
    planId: PLAN,
    now: 5_000,
  });
  const grown = heardCalls({
    held: first,
    voice: liveReport(LIVE_CALL, "Seven days."),
    planId: PLAN,
    now: 6_000,
  });
  assert.deepEqual(
    grown.map((call) => [call.heardAt, call.transcript.lines[0]?.words]),
    [[5_000, "Seven days."]],
  );

  const ended = heardCalls({ held: grown, voice: NO_CALL, planId: PLAN, now: 7_000 });
  const next = heardCalls({
    held: ended,
    voice: liveReport(NEXT_CALL, "Back again."),
    planId: PLAN,
    now: 8_000,
  });
  assert.deepEqual(
    drawn(
      transcriptRegion({
        transcript: { status: PLANNING_READ.READY, transcript: STORED },
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
      voice: { ...liveReport(LIVE_CALL, "Seven days."), callPlanId: "another-plan" },
      planId: PLAN,
      now: 5_000,
    }),
    [],
  );
  assert.deepEqual(
    heardCalls({ held: grown, voice: NO_CALL, planId: "another-plan", now: 9_000 }),
    [],
  );
});

test("a call's header names its day as today, yesterday, a weekday this week, or a date", () => {
  const now = new Date(2026, 9, 8, 18, 0).getTime();
  const at = (month: number, day: number, year = 2026) =>
    new Date(year, month, day, 15, 42).getTime();

  assert.equal(callHeading(at(9, 8), now, "en-US"), "Today, 3:42 PM");
  assert.equal(callHeading(at(9, 7), now, "en-US"), "Yesterday, 3:42 PM");
  assert.equal(callHeading(at(9, 5), now, "en-US"), "Monday, 3:42 PM");
  assert.equal(callHeading(at(8, 21), now, "en-US"), "Sep 21, 3:42 PM");
  assert.equal(callHeading(at(11, 30, 2025), now, "en-US"), "Dec 30, 2025, 3:42 PM");
});

test("the list follows the newest line only while it is scrolled to the bottom", () => {
  assert.equal(followsNewest({ scrollTop: 600, scrollHeight: 1_000, clientHeight: 400 }), true);
  assert.equal(followsNewest({ scrollTop: 590, scrollHeight: 1_000, clientHeight: 400 }), true);
  assert.equal(followsNewest({ scrollTop: 300, scrollHeight: 1_000, clientHeight: 400 }), false);
});
