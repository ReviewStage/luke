import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { createAgent } from "@repo/database/models/agent-store";
import { storeWriter } from "@repo/database/models/writer";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, openWorkspace } from "@repo/database/testing";
import { AGENT_PAYER } from "@repo/features/agent-wire";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import { TOOL_CALL_SETTLEMENT } from "@repo/features/turn-run";
import { sessionKey } from "@repo/runtime/vocabulary";
import { isToolUIPart } from "ai";
import { Effect, Option } from "effect";
import {
  ACTION_RESULT_STATUS,
  AssistantMessageBuilder,
  RUN_EVENT,
  RUN_STATUS,
  RUN_TURN_ORIGIN,
  TOOL_PART_STATE,
  TURN_ORIGIN,
  TURN_TRIGGER,
  unparsedWire,
} from "../../core.js";
import { modelCatalogOf } from "../../providers/model-catalog.js";
import { openGithubUser } from "../../testing/github-app-fake.js";
import { CODER_TOOL_SET } from "./tool-set.js";
import { CURSOR_START, transcriptPast } from "./transcript.js";

/**
 * transcript.test.ts -- an agent's transcript reads every call it ever made, those of tools no agent is offered now among them.
 *
 * Over the real migrations on PGlite, a turn journaled by the store writer
 * as a transcript from before the inbox moved to threads holds it, read
 * back as the panel reads an agent's page. Synthetic accounts and words
 * throughout.
 */

const CATALOG = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "medium", "high", "max"],
  },
];

it.layer(getTestDB())("a coding agent's transcript", (it) => {
  it.effect(
    "a transcript written before the inbox moved to threads still reads its close_inbox_item and reply_inbox calls, which no agent is offered now",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const started = yield* createAgent(owner, {
          taskId: null,
          organizationId: yield* openWorkspace(owner),
          planSnapshot: null,
          prompt: "Answer the open asks.",
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: null,
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
          payer: AGENT_PAYER.CLAUDE_SUBSCRIPTION,
        });
        const agent = Option.getOrThrow(started).agent;
        const target = { userId: owner, conversationId: agent.conversationId };
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        const turnId = randomUUID();
        const turn = { conversationId: sessionKey(target.conversationId), turnId };
        const answer = new AssistantMessageBuilder();
        answer.stepStart();
        for (const [callId, name, input] of [
          ["call-reply", "reply_inbox", { key: "k", text: "Done." }],
          ["call-close", "close_inbox_item", { key: "k", reason: "Done." }],
        ] as const) {
          answer.toolCall({ callId, name, argumentsJson: "{}" }, unparsedWire(input));
          answer.toolResult(callId, {
            state: TOOL_CALL_SETTLEMENT.OUTPUT_AVAILABLE,
            output: unparsedWire({ status: ACTION_RESULT_STATUS.ACCEPTED, inbox: [] }),
          });
        }
        yield* writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, eveTurnId: turnId });
        yield* writer.consume(target, {
          ...turn,
          kind: RUN_EVENT.TURN_STARTED,
          sequence: 1,
          origin: RUN_TURN_ORIGIN.TYPED,
          trigger: TURN_TRIGGER.ASK,
          at: 0,
        });
        yield* writer.consume(target, {
          ...turn,
          kind: RUN_EVENT.MESSAGE_COMPLETED,
          sequence: 2,
          message: answer.finish(randomUUID()),
        });
        yield* writer.consume(target, {
          ...turn,
          kind: RUN_EVENT.TURN_ENDED,
          sequence: 3,
          status: RUN_STATUS.SUCCEEDED,
          responseIds: [],
          at: 0,
        });

        const page = yield* transcriptPast(target, CODER_TOOL_SET, CURSOR_START, agent).pipe(
          Effect.provide(modelCatalogOf(CATALOG)),
        );

        const parts = page.messages.flatMap((message) => message.parts).filter(isToolUIPart);
        assert.deepEqual(
          parts.map((part) => [part.type, part.state]),
          [
            ["tool-reply_inbox", TOOL_PART_STATE.OUTPUT_AVAILABLE],
            ["tool-close_inbox_item", TOOL_PART_STATE.OUTPUT_AVAILABLE],
          ],
        );
      }),
  );
});
