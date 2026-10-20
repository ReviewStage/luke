import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { listMessagesPast, type MessageCursor } from "@luke/database/models/message-reads";
import { storeWriter } from "@luke/database/models/writer";
import { user } from "@luke/database/schemas/auth";
import { conversations } from "@luke/database/schemas/storage";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { getTestDB } from "@luke/database/testing";
import { Clock, Effect, Schema } from "effect";
import { TestClock } from "effect/testing";
import type { MessageStreamEvent } from "eve/client";
import { TOOL_PART_STATE, UNKNOWN_ACTION_STATUS } from "../../core.js";
import { HOSTED_TOOL_SET } from "../../tasks/brain-tool-set.js";
import { stampedEveEvent } from "../../testing/eve-events.js";
import { REPOSITORY_SHELL_STATUS, RUN_IN_REPOSITORY_TOOL } from "../repository-shell.js";
import { BRAIN_HOST_TURN } from "./bounds.js";
import {
  foldedQuietly,
  JOURNAL_WRITE_INTERVAL_MS,
  memoryRelayState,
  type RelayStanding,
  StreamRelay,
} from "./relay.js";

/**
 * A running turn's journal written in batches: what only grows it, told
 * inside the interval since it was last written, waits in the relay's state
 * and lands with the stream's next event past the interval, or at once with
 * the turn's end. The clock is the relay's own seam, read off the test clock;
 * the events are eve's shapes for one synthetic coding agent's turn.
 */

const TURN = { turnId: "turn_0", sequence: 0 } as const;
const STEP = { ...TURN, stepIndex: 0 } as const;
const CALLS = Array.from({ length: 10 }, (_, index) => `call-${index}`);

/** A coding agent's conversation and the relay over the writer, its clock the test clock's last reading. */
const setUp = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const conversationId = randomUUID();
  yield* db
    .insert(conversations)
    .values({ id: conversationId, userId, kind: CONVERSATION_KIND.CODING_AGENT });
  const writer = yield* storeWriter({ tools: HOSTED_TOOL_SET });
  let at = yield* Clock.currentTimeMillis;
  const refusals: string[] = [];
  const relay = new StreamRelay({
    writer,
    now: () => at,
    report: (message) => refusals.push(message),
  });
  const standing: RelayStanding = {
    sessionId: `wrun_${randomUUID()}`,
    target: { userId, conversationId },
    turn: BRAIN_HOST_TURN.TYPED,
    model: "scripted-model",
    state: memoryRelayState(),
  };
  /** One event as the store hook takes it: folded quietly where it may be, relayed otherwise. */
  const relayed = (event: Omit<MessageStreamEvent, "meta">) =>
    Effect.suspend(() => {
      const stamped = stampedEveEvent(event, at);
      return foldedQuietly(stamped, standing.state, at)
        ? Effect.void
        : relay.handle(stamped, standing);
    });
  const tick = (millis: number) =>
    Effect.gen(function* () {
      yield* TestClock.adjust(millis);
      at = yield* Clock.currentTimeMillis;
    });
  const past = (cursor: MessageCursor) =>
    listMessagesPast(userId, conversationId, HOSTED_TOOL_SET, cursor);
  return { relayed, tick, past, refusals };
});

type Relayed = Effect.Success<typeof setUp>["relayed"];

/** The turn opened, its first step asking for ten calls in one request. */
const tenCallsAsked = (relayed: Relayed) =>
  Effect.gen(function* () {
    yield* relayed({ type: "turn.started", data: TURN });
    yield* relayed({ type: "message.received", data: { ...TURN, message: "run the ten checks" } });
    yield* relayed({ type: "step.started", data: { ...STEP, modelId: "m" } });
    yield* relayed({
      type: "actions.requested",
      data: {
        ...STEP,
        actions: CALLS.map((callId) => ({
          kind: "tool-call",
          callId,
          toolName: RUN_IN_REPOSITORY_TOOL.name,
          input: { command: `check ${callId}` },
        })),
      },
    });
  });

/** One call's answer as eve emits it. */
const answered = (callId: string): Omit<MessageStreamEvent, "meta"> => ({
  type: "action.result",
  data: {
    ...STEP,
    status: "completed",
    result: {
      kind: "tool-result",
      callId,
      toolName: RUN_IN_REPOSITORY_TOOL.name,
      output: { status: REPOSITORY_SHELL_STATUS.RAN, exitCode: 0, stdout: callId, stderr: "" },
    },
  },
});

const readsUnknownOutcome = Schema.is(
  Schema.Struct({ status: Schema.Literal(UNKNOWN_ACTION_STATUS) }),
);

/** Each call of the journal by id, with the state it stands in and whether its answer is the envelope of an unknown outcome. */
const callsOf = (parts: readonly object[]) =>
  parts.flatMap((part) =>
    "toolCallId" in part && "state" in part
      ? [
          {
            callId: part.toolCallId,
            state: part.state,
            unknown: "output" in part && readsUnknownOutcome(part.output),
          },
        ]
      : [],
  );

it.layer(getTestDB())("a running turn's journal written in batches", (it) => {
  it.effect(
    "ten answers inside the interval move the journal nothing until the stream's next event past it, which lands all ten at one revision a reader from the revision before reads whole",
    () =>
      Effect.gen(function* () {
        const { relayed, tick, past, refusals } = yield* setUp;
        yield* tenCallsAsked(relayed);
        const asked = yield* past({ seq: 0, revision: 0 });

        for (const callId of CALLS) {
          yield* tick(JOURNAL_WRITE_INTERVAL_MS / CALLS.length / 2);
          yield* relayed(answered(callId));
        }
        const held = yield* past(asked.cursor);
        assert.equal(held.cursor.revision, asked.cursor.revision);
        assert.deepEqual(held.read.ok ? held.read.value : undefined, []);

        // A fragment of reasoning, which the hook folds quietly while nothing waits, is the next event past the interval.
        yield* tick(JOURNAL_WRITE_INTERVAL_MS);
        yield* relayed({
          type: "reasoning.appended",
          data: { ...STEP, reasoningDelta: "All ten" },
        });
        const landed = yield* past(asked.cursor);
        assert.equal(landed.cursor.revision, asked.cursor.revision + 1);
        assert.ok(landed.read.ok);
        assert.equal(landed.read.value.length, 1);
        assert.deepEqual(
          callsOf(landed.read.value[0]?.message.parts ?? []),
          CALLS.map((callId) => ({
            callId,
            state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
            unknown: false,
          })),
        );
        assert.deepEqual(refusals, []);
      }),
  );

  it.effect(
    "the turn's end, inside the interval, lands the answers it held ahead of settling the journal, so no call the turn answered reads as an unknown outcome",
    () =>
      Effect.gen(function* () {
        const { relayed, tick, past, refusals } = yield* setUp;
        yield* tenCallsAsked(relayed);
        for (const callId of CALLS) {
          yield* tick(1);
          yield* relayed(answered(callId));
        }
        yield* tick(1);
        yield* relayed({
          type: "turn.failed",
          data: { ...TURN, code: "MODEL_CALL_FAILED", message: "upstream failed" },
        });

        const read = yield* past({ seq: 0, revision: 0 });
        assert.ok(read.read.ok);
        const journal = read.read.value.find((record) => record.message.role === "assistant");
        assert.notEqual(journal?.finishedAt, undefined);
        assert.deepEqual(
          callsOf(journal?.message.parts ?? []),
          CALLS.map((callId) => ({
            callId,
            state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
            unknown: false,
          })),
        );
        assert.deepEqual(refusals, []);
      }),
  );
});
