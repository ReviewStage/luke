import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { BRAIN_RUN_EVENT, BRAIN_TURN_ORIGIN, BRAIN_TURN_TRIGGER } from "@luke/features/brain";
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
 * The store writer's journal as eve runs a step again, over a real dialect:
 * the newest step told a second time settles the calls its abandoned
 * attempt asked for, and an older step told again changes nothing.
 * Synthetic accounts and conversations throughout.
 */

/** The one tool the turn calls, whose input and output the journal takes as they come. */
const TOOLS = {
  bash: wireValidatedTool("Runs a command.", Schema.Struct({ command: Schema.String })),
};

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
