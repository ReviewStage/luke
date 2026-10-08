import assert from "node:assert/strict";
import { PLANNING_READ } from "@sidecar/hosted/planning-view";
import type { PlanTranscript } from "@sidecar/hosted/transcript-wire";
import { TRANSCRIPT_SPEAKER } from "@sidecar/live";
import { test } from "vitest";
import {
  callHeading,
  followsNewest,
  type HeardCall,
  heardCall,
  TRANSCRIPT_REGION,
  transcriptRegion,
} from "./transcript-model";

/** Synthetic plan, calls, and words throughout. */
const PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const EARLIER_CALL = "5d2c8f61-3a7e-4b19-8c0d-2e9f4a6b7c81";
const LIVE_CALL = "9e4b1a2c-6d3f-4e8a-b7c5-1f2a3b4c5d6e";

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
    heard: undefined,
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
      heard: undefined,
    }),
    { kind: TRANSCRIPT_REGION.EMPTY },
  );
  assert.deepEqual(
    transcriptRegion({ transcript: { status: PLANNING_READ.READING }, heard: undefined }),
    { kind: TRANSCRIPT_REGION.READING },
  );
  assert.deepEqual(
    transcriptRegion({ transcript: { status: PLANNING_READ.FAILED }, heard: undefined }),
    { kind: TRANSCRIPT_REGION.FAILED },
  );
});

test("the live call follows the stored calls, and its words outlast the call until the record holds it", () => {
  const live = heardCall({
    held: undefined,
    voice: liveReport(LIVE_CALL, "Seven days."),
    planId: PLAN,
    now: 5_000,
  });
  const during = transcriptRegion({
    transcript: { status: PLANNING_READ.READY, transcript: STORED },
    heard: live,
  });
  assert.deepEqual(
    during.kind === TRANSCRIPT_REGION.READY
      ? during.calls.map((call) => [call.key, call.live, call.startedAt])
      : [],
    [
      [EARLIER_CALL, false, 1_000],
      [LIVE_CALL, true, 5_000],
    ],
  );

  // Hung up: the words stay, no longer live, until the read with the call lands.
  const ended = heardCall({ held: live, voice: NO_CALL, planId: PLAN, now: 9_000 });
  const before = transcriptRegion({
    transcript: { status: PLANNING_READ.READY, transcript: STORED },
    heard: ended,
  });
  assert.deepEqual(
    before.kind === TRANSCRIPT_REGION.READY
      ? before.calls.map((call) => [call.key, call.live, call.lines[0]?.text])
      : [],
    [
      [EARLIER_CALL, false, "Invites should expire."],
      [LIVE_CALL, false, "Seven days."],
    ],
  );

  const recorded: PlanTranscript = {
    ...STORED,
    calls: [
      ...STORED.calls,
      {
        id: LIVE_CALL,
        startedAt: 4_000,
        lines: [{ speaker: TRANSCRIPT_SPEAKER.USER, text: "Seven days, then." }],
      },
    ],
  };
  const after = transcriptRegion({
    transcript: { status: PLANNING_READ.READY, transcript: recorded },
    heard: ended,
  });
  assert.deepEqual(
    after.kind === TRANSCRIPT_REGION.READY
      ? after.calls.map((call) => [call.key, call.live, call.lines[0]?.text])
      : [],
    [
      [EARLIER_CALL, false, "Invites should expire."],
      [LIVE_CALL, false, "Seven days, then."],
    ],
  );
});

test("the live call is drawn while the stored transcript is still being read", () => {
  const heard = heardCall({
    held: undefined,
    voice: liveReport(LIVE_CALL, "Seven days."),
    planId: PLAN,
    now: 5_000,
  });
  const region = transcriptRegion({ transcript: { status: PLANNING_READ.READING }, heard });
  assert.equal(region.kind, TRANSCRIPT_REGION.READY);
});

test("the same call keeps when it was first heard, a new call starts its own, and another plan's call is not this tab's", () => {
  const first = heardCall({
    held: undefined,
    voice: liveReport(LIVE_CALL, "Seven"),
    planId: PLAN,
    now: 5_000,
  });
  const grown = heardCall({
    held: first,
    voice: liveReport(LIVE_CALL, "Seven days."),
    planId: PLAN,
    now: 6_000,
  });
  assert.equal(grown?.heardAt, 5_000);
  assert.equal(grown?.transcript.lines[0]?.words, "Seven days.");

  const ended = heardCall({ held: grown, voice: NO_CALL, planId: PLAN, now: 7_000 });
  const next = heardCall({
    held: ended,
    voice: liveReport(EARLIER_CALL, "Back again."),
    planId: PLAN,
    now: 8_000,
  });
  assert.equal(next?.heardAt, 8_000);

  const elsewhere: HeardCall | undefined = heardCall({
    held: undefined,
    voice: { ...liveReport(LIVE_CALL, "Seven days."), callPlanId: "another-plan" },
    planId: PLAN,
    now: 5_000,
  });
  assert.equal(elsewhere, undefined);
  assert.equal(
    heardCall({ held: grown, voice: NO_CALL, planId: "another-plan", now: 9_000 }),
    undefined,
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
