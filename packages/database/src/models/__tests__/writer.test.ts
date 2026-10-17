import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  BRAIN_REQUEST_STATUS,
  BRAIN_RUN_EVENT,
  BRAIN_TURN_ORIGIN,
  BRAIN_TURN_TRIGGER,
  UI_PART_TYPE,
} from "@luke/features/brain";
import { wireValidatedTool } from "@luke/features/brain/tool-set";
import { sessionKey } from "@luke/runtime/vocabulary";
import { TURN_ORIGIN, UNKNOWN_ACTION_STATUS } from "@luke/wire";
import { TOOL_PART_STATE } from "@luke/wire/ui-messages";
import { Effect, Schema } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { conversations } from "../../schemas/storage.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB } from "../../testing/index.js";
import { readMessageByClientId } from "../message-reads.js";
import { storeWriter } from "../writer.js";

/**
 * The store writer's journal over a real dialect: as eve runs a step again,
 * the newest step told a second time settles the calls its abandoned
 * attempt asked for, and an older step told again changes nothing; and as a
 * turn fails, a coding agent's journal keeps the words it formed while a
 * brain's lets them go. Synthetic accounts and conversations throughout.
 */

/** The one tool the turn calls, whose input and output the journal takes as they come. */
const TOOLS = {
  bash: wireValidatedTool("Runs a command.", Schema.Struct({ command: Schema.String })),
};

const openConversation = (kind: (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND]) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
    const conversationId = randomUUID();
    yield* db.insert(conversations).values({ id: conversationId, userId, kind });
    return { userId, conversationId };
  });

/** A turn that formed words and asked for a call in its one step, then failed before the call answered; its journal as the store then holds it. */
const failedTurnJournal = (kind: (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND]) =>
  Effect.gen(function* () {
    const target = yield* openConversation(kind);
    const writer = yield* storeWriter({ tools: TOOLS });
    const turnId = randomUUID();
    const turn = { conversationId: sessionKey(target.conversationId), turnId };
    yield* writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, eveTurnId: "turn_0" });
    const bodies = [
      {
        kind: BRAIN_RUN_EVENT.TURN_STARTED,
        origin: BRAIN_TURN_ORIGIN.TYPED,
        trigger: BRAIN_TURN_TRIGGER.ASK,
        at: 0,
      },
      { kind: BRAIN_RUN_EVENT.STEP_STARTED, step: 1 },
      { kind: BRAIN_RUN_EVENT.TEXT_DRAFTED, step: 1, text: "I will look at the tests first." },
      {
        kind: BRAIN_RUN_EVENT.TOOL_CALL_STARTED,
        callId: "call-unanswered",
        name: "bash",
        input: { command: "pwd" },
      },
      {
        kind: BRAIN_RUN_EVENT.TURN_ENDED,
        status: BRAIN_REQUEST_STATUS.FAILED,
        responseIds: [],
        at: 1,
      },
    ] as const;
    for (const [index, body] of bodies.entries()) {
      yield* writer.consume(target, { ...turn, ...body, sequence: index + 1 });
    }
    const read = yield* readMessageByClientId(target.userId, target.conversationId, TOOLS, turnId);
    assert.ok(read.ok);
    const journal = read.value[0];
    assert.notEqual(journal?.finishedAt, undefined);
    return journal?.message.parts ?? [];
  });

const openTarget = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const conversationId = randomUUID();
  yield* db
    .insert(conversations)
    .values({ id: conversationId, userId, kind: CONVERSATION_KIND.CODING_AGENT });
  return { userId, conversationId };
});

it.layer(getTestDB())("the store writer's retried steps", (it) => {
  it.effect(
    "the newest step told again settles its unanswered calls as an unknown outcome while the turn runs, and an older step told again leaves the newest step's calls standing",
    () =>
      Effect.gen(function* () {
        const target = yield* openTarget;
        const writer = yield* storeWriter({ tools: TOOLS });
        const turnId = randomUUID();
        const turn = { conversationId: sessionKey(target.conversationId), turnId };
        let sequence = 0;
        const tell = (
          body:
            | { readonly kind: typeof BRAIN_RUN_EVENT.STEP_STARTED; readonly step: number }
            | {
                readonly kind: typeof BRAIN_RUN_EVENT.TOOL_CALL_STARTED;
                readonly callId: string;
                readonly name: string;
                readonly input: { readonly command: string };
              },
        ) => {
          sequence += 1;
          return writer.consume(target, { ...turn, ...body, sequence });
        };
        const callState = (callId: string) =>
          Effect.gen(function* () {
            const read = yield* readMessageByClientId(
              target.userId,
              target.conversationId,
              TOOLS,
              turnId,
            );
            assert.ok(read.ok);
            const journal = read.value[0];
            assert.equal(journal?.finishedAt, undefined);
            const part = journal?.message.parts.find(
              (each) => "toolCallId" in each && each.toolCallId === callId,
            );
            assert.ok(part !== undefined && "state" in part);
            return part;
          });
        const call = (callId: string) => ({
          kind: BRAIN_RUN_EVENT.TOOL_CALL_STARTED,
          callId,
          name: "bash",
          input: { command: "pwd" },
        });

        yield* writer.enqueueTurn(target, {
          turnId,
          origin: TURN_ORIGIN.TYPED,
          eveTurnId: "turn_0",
        });
        sequence += 1;
        yield* writer.consume(target, {
          ...turn,
          kind: BRAIN_RUN_EVENT.TURN_STARTED,
          sequence,
          origin: BRAIN_TURN_ORIGIN.TYPED,
          trigger: BRAIN_TURN_TRIGGER.ASK,
          at: 0,
        });
        yield* tell({ kind: BRAIN_RUN_EVENT.STEP_STARTED, step: 1 });
        yield* tell(call("call-abandoned"));
        yield* tell({ kind: BRAIN_RUN_EVENT.STEP_STARTED, step: 1 });
        const abandoned = yield* callState("call-abandoned");
        assert.equal(abandoned.state, TOOL_PART_STATE.OUTPUT_AVAILABLE);
        assert.partialDeepStrictEqual("output" in abandoned ? abandoned.output : undefined, {
          status: UNKNOWN_ACTION_STATUS,
        });

        yield* tell({ kind: BRAIN_RUN_EVENT.STEP_STARTED, step: 2 });
        yield* tell(call("call-running"));
        yield* tell({ kind: BRAIN_RUN_EVENT.STEP_STARTED, step: 1 });
        assert.equal((yield* callState("call-running")).state, TOOL_PART_STATE.INPUT_AVAILABLE);
      }),
  );
});

it.layer(getTestDB())("the store writer's failed turns", (it) => {
  it.effect(
    "a coding agent's failed turn keeps the words it formed beside its call, settled as an unknown outcome",
    () =>
      Effect.gen(function* () {
        const parts = yield* failedTurnJournal(CONVERSATION_KIND.CODING_AGENT);
        const text = parts.find((part) => part.type === UI_PART_TYPE.TEXT);
        assert.equal(
          text !== undefined && "text" in text ? text.text : undefined,
          "I will look at the tests first.",
        );
        const call = parts.find((part) => "toolCallId" in part);
        assert.ok(call !== undefined && "state" in call);
        assert.equal(call.state, TOOL_PART_STATE.OUTPUT_AVAILABLE);
        assert.partialDeepStrictEqual("output" in call ? call.output : undefined, {
          status: UNKNOWN_ACTION_STATUS,
        });
      }),
  );

  it.effect("a brain's failed turn lets its words go and keeps its call", () =>
    Effect.gen(function* () {
      const parts = yield* failedTurnJournal(CONVERSATION_KIND.MAIN);
      assert.equal(
        parts.some((part) => part.type === UI_PART_TYPE.TEXT),
        false,
      );
      assert.ok(parts.some((part) => "toolCallId" in part));
    }),
  );
});
