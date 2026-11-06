import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { writeAccountPreferences } from "@repo/database/models/account-store";
import { type Agent, createAgent } from "@repo/database/models/agent-store";
import { storeWriter } from "@repo/database/models/writer";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, startTask } from "@repo/database/testing";
import { AGENT_PAYER } from "@repo/features/agent-wire";
import { RUN_STATUS, RUN_TURN_ORIGIN, TURN_TRIGGER } from "@repo/features/turn-run";
import { sessionKey } from "@repo/runtime/vocabulary";
import { EXPERIMENT } from "@repo/settings";
import { Clock, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { ACTION_RESULT_STATUS, RUN_EVENT, TURN_ORIGIN, unparsedWire } from "../../core.js";
import { saveNotes } from "../../tasks/description-notes.js";
import { openGithubUser } from "../../testing/github-app-fake.js";
import { added } from "../../testing/task-contents.js";
import { EVE_HOST_TURN } from "../eve-host/bounds.js";
import type { AdmittedConversation } from "../eve-host/conversation.js";
import { runAgentEditDescription } from "./agent-doors.js";
import type { InboxSandboxDoor } from "./inbox-image.js";
import { CODER_TOOL_SET } from "./tool-set.js";
import { handedAfterCompaction, type TurnHanded, taskWithLead } from "./turn-context.js";
import { coderTurnMessage } from "./turn-message.js";

const DESCRIPTION_TEXT = "# Teammate invitations\n\n## Goal\n\nInvite a teammate by email.\n";

const TURN_STARTS_AT = 10 * 60_000;

const noSandbox: InboxSandboxDoor = () => Promise.reject(new Error("the sandbox was opened"));

const openAgent = Effect.gen(function* () {
  const userId = yield* openGithubUser();
  yield* writeAccountPreferences(userId, { experiments: { [EXPERIMENT.DESCRIPTIONS]: true } });
  const task = yield* startTask(userId, { name: "Teammate invitations", repository: "acme/relay" });
  const started = yield* createAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    descriptionSnapshot: DESCRIPTION_TEXT,
    prompt: null,
    repository: "acme/relay",
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    payer: AGENT_PAYER.CLAUDE_SUBSCRIPTION,
  });
  const agent: Agent = Option.getOrThrow(started).agent;
  const admitted: AdmittedConversation = {
    caller: userId,
    target: { userId, conversationId: agent.conversationId },
    runtimeSessionId: undefined,
    timeZone: undefined,
  };
  return { userId, agent, admitted };
});

const ranTurn = (admitted: AdmittedConversation, turnId: string, at: number) =>
  Effect.gen(function* () {
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const turn = { conversationId: sessionKey(admitted.target.conversationId), turnId };
    yield* writer.enqueueTurn(admitted.target, {
      turnId,
      origin: TURN_ORIGIN.TYPED,
      eveTurnId: turnId,
    });
    yield* writer.consume(admitted.target, {
      ...turn,
      kind: RUN_EVENT.TURN_STARTED,
      sequence: 1,
      origin: RUN_TURN_ORIGIN.TYPED,
      trigger: TURN_TRIGGER.ASK,
      at,
    });
    yield* writer.consume(admitted.target, {
      ...turn,
      kind: RUN_EVENT.TURN_ENDED,
      sequence: 2,
      status: RUN_STATUS.SUCCEEDED,
      responseIds: [],
      at,
    });
  });

it.layer(getTestDB())("a coding agent's turn message", (it) => {
  it.effect(
    "the turn after one spoken on a call says the call's words no longer hold, as it does after a compaction kept only that, and the turn after it says nothing of them",
    () =>
      Effect.gen(function* () {
        const { agent, admitted } = yield* openAgent;
        const typedOn = (handed: TurnHanded) =>
          coderTurnMessage(
            admitted,
            agent,
            { kind: EVE_HOST_TURN.TYPED, turnId: undefined },
            handed,
            TURN_STARTS_AT,
          );

        const after = yield* typedOn({ spoken: true });
        assert.ok(after.text?.startsWith("This turn is typed"), after.text ?? "");
        const next = yield* typedOn(after.handed);
        assert.ok(!next.text?.includes("This turn is"), next.text ?? "");
        const compacted = yield* typedOn(handedAfterCompaction({ spoken: true }));
        assert.ok(compacted.text?.startsWith("This turn is typed"), compacted.text ?? "");
      }),
  );

  it.effect(
    "a typed turn's message hands the task as it stands once after the agent's first turn, then only once someone other than the agent saved the description after its previous turn started, even where the agent then wrote over the same section, and never on its first turn, for its own notes, or once its starter turned Plans off",
    () =>
      Effect.gen(function* () {
        const { userId, agent, admitted } = yield* openAgent;
        assert.ok(agent.taskId !== null);
        const binding = { userId, taskId: agent.taskId };
        const firstTurn = randomUUID();
        const nextTurn = randomUUID();
        let handed: TurnHanded = {};
        const typedAt = (turnId: string) =>
          Effect.map(
            Effect.suspend(() =>
              coderTurnMessage(
                admitted,
                agent,
                { kind: EVE_HOST_TURN.TYPED, turnId },
                handed,
                TURN_STARTS_AT,
              ),
            ),
            (message) => {
              handed = message.handed;
              const text = message.text ?? "";
              return text.includes(taskWithLead("")) ? text : undefined;
            },
          );
        const agentNotes = (notes: Parameters<typeof saveNotes>[1]) =>
          Effect.map(
            runAgentEditDescription(
              admitted,
              unparsedWire({ taskId: binding.taskId, notes }),
              0,
              noSandbox,
            ),
            (answer) => answer.status,
          );

        yield* TestClock.adjust("1 minute");
        yield* saveNotes(binding, [added("Context", "Invites go by email.")]);
        assert.equal(yield* typedAt(firstTurn), undefined);
        yield* ranTurn(admitted, firstTurn, TURN_STARTS_AT);
        assert.ok(yield* typedAt(nextTurn));
        assert.equal(yield* typedAt(nextTurn), undefined);

        yield* TestClock.adjust("10 minutes");
        assert.equal(
          yield* agentNotes([added("Approach", "- Invites expire after 7 days.")]),
          ACTION_RESULT_STATUS.ACCEPTED,
        );
        assert.equal(yield* typedAt(nextTurn), undefined);

        yield* TestClock.adjust("1 minute");
        yield* saveNotes(binding, [added("Approach", "- A withdrawn invite never grants access.")]);
        yield* TestClock.adjust("1 minute");
        assert.equal(
          yield* agentNotes([added("Approach", "- Resending renews the link.")]),
          ACTION_RESULT_STATUS.ACCEPTED,
        );
        const changed = (yield* typedAt(nextTurn)) ?? "";
        assert.ok(changed.includes("A withdrawn invite never grants access."), changed);
        assert.ok(!changed.includes("## This turn is spoken"), changed);

        yield* writeAccountPreferences(userId, {
          experiments: { [EXPERIMENT.DESCRIPTIONS]: false },
        });
        yield* TestClock.adjust("1 minute");
        yield* saveNotes(binding, [added("Approach", "- Only admins withdraw invites.")]);
        assert.equal(yield* typedAt(nextTurn), undefined);

        yield* TestClock.adjust("1 minute");
        yield* ranTurn(admitted, nextTurn, yield* Clock.currentTimeMillis);
        yield* TestClock.adjust("1 minute");
        yield* writeAccountPreferences(userId, {
          experiments: { [EXPERIMENT.DESCRIPTIONS]: true },
        });
        const back = (yield* typedAt(randomUUID())) ?? "";
        assert.ok(back.includes("Only admins withdraw invites."), back);
      }),
  );
});
