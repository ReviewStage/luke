import { randomUUID } from "node:crypto";
import type { Agent } from "@repo/database/models/agent-store";
import { storeWriter } from "@repo/database/models/writer";
import {
  AssistantMessageBuilder,
  RUN_EVENT,
  RUN_STATUS,
  RUN_TURN_ORIGIN,
  type RunStatus,
  TURN_FAILURE,
  TURN_TRIGGER,
} from "@repo/features/turn-run";
import { sessionKey } from "@repo/runtime/vocabulary";
import { TURN_ORIGIN } from "@repo/wire";
import { Effect } from "effect";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";

export const endedAt = (agent: Agent, status: RunStatus, at: number, said?: string) =>
  Effect.gen(function* () {
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const target = { userId: agent.userId, conversationId: agent.conversationId };
    const turnId = randomUUID();
    const turn = { conversationId: sessionKey(agent.conversationId), turnId };
    yield* writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, eveTurnId: "turn_0" });
    yield* writer.consume(target, {
      ...turn,
      kind: RUN_EVENT.TURN_STARTED,
      sequence: 1,
      origin: RUN_TURN_ORIGIN.TYPED,
      trigger: TURN_TRIGGER.ASK,
      at: at - 1,
    });
    if (said !== undefined) {
      const answer = new AssistantMessageBuilder();
      answer.stepStart();
      answer.text("Reading the description first.");
      answer.stepStart();
      answer.text(said);
      yield* writer.consume(target, {
        ...turn,
        kind: RUN_EVENT.MESSAGE_COMPLETED,
        sequence: 2,
        message: answer.finish(randomUUID()),
      });
    }
    yield* writer.consume(target, {
      ...turn,
      kind: RUN_EVENT.TURN_ENDED,
      sequence: 3,
      status,
      ...(status === RUN_STATUS.FAILED ? { failure: TURN_FAILURE.MODEL } : undefined),
      responseIds: [],
      at,
    });
    return turnId;
  });
