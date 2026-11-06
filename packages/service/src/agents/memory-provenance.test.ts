import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { writeAccountPreferences } from "@repo/database/models/account-store";
import { type Agent, createAgent } from "@repo/database/models/agent-store";
import { listMemories, MEMORY_OUTCOME } from "@repo/database/models/memory-store";
import type { StoredAutomationOrigin } from "@repo/database/schemas/agent";
import { user } from "@repo/database/schemas/auth";
import { messages, turns } from "@repo/database/schemas/storage";
import { CONVERSATION_RUNTIME, MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { getTestDB, openWorkspace } from "@repo/database/testing";
import { CLAUDE_CODE_TOOL } from "@repo/features/agent-tools";
import { AUTOMATION_FIRING } from "@repo/features/automation-wire";
import { EXPERIMENT } from "@repo/settings";
import { Effect, Option } from "effect";
import {
  ACTION_RESULT_STATUS,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TURN_ORIGIN,
  TURN_STATUS,
} from "../core.js";
import { recordingEve } from "../testing/recording-eve.js";
import { AGENT_TOOL } from "./agent-runtime/tools.js";
import { AGENT_CALLER, type AgentCall } from "./agent-tools.js";
import { MEMORY_PROVENANCE_REFUSAL } from "./memory-provenance.js";
import { runAgentRemember } from "./memory-tools.js";

const FACT = "The web server's store tests run on PGlite through test:store.";

const openAgent = (automationOrigin?: StoredAutomationOrigin) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
    yield* writeAccountPreferences(userId, { experiments: { [EXPERIMENT.MEMORY]: true } });
    const workspaceId = yield* openWorkspace(userId);
    const started = yield* createAgent(userId, {
      taskId: null,
      organizationId: workspaceId,
      descriptionSnapshot: null,
      prompt: "Tidy the docs.",
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: null,
      automationOrigin,
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    });
    assert.ok(Option.isSome(started));
    return { agent: started.value.agent, workspaceId };
  });

type Opener =
  | { readonly sender: undefined }
  | { readonly sender: typeof MESSAGE_SENDER.MEMBER }
  | { readonly sender: typeof MESSAGE_SENDER.AUTOMATION; readonly name: string };

const writeTurn = (
  agent: Agent,
  opener: Opener,
  called: readonly string[],
  status: typeof TURN_STATUS.RUNNING | typeof TURN_STATUS.SETTLED = TURN_STATUS.RUNNING,
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const now = new Date();
    const own = { userId: agent.userId, conversationId: agent.conversationId };
    const [turn] = yield* db
      .insert(turns)
      .values({ ...own, origin: TURN_ORIGIN.TYPED, status, queuedAt: now, startedAt: now })
      .returning({ id: turns.id });
    assert.ok(turn !== undefined);
    yield* db.insert(messages).values({
      ...own,
      seq: 1,
      turnId: turn.id,
      clientId: randomUUID(),
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: "Look over what changed today." }],
      metadata: { channel: MESSAGE_CHANNEL.TYPED },
      placedAt: now,
      finishedAt: now,
      ...(opener.sender === undefined
        ? undefined
        : opener.sender === MESSAGE_SENDER.AUTOMATION
          ? { sender: opener.sender, senderName: opener.name }
          : { sender: opener.sender, senderUserId: agent.userId }),
    });
    yield* db.insert(messages).values({
      ...own,
      seq: 2,
      turnId: turn.id,
      clientId: turn.id,
      role: MESSAGE_ROLE.ASSISTANT,
      parts: called.map((tool, index) => ({
        type: `tool-${tool}`,
        toolCallId: `call-${index}`,
        state: "output-available",
        input: { url: "https://example.com/" },
        output: "Example Domain",
      })) as never,
      metadata: { author: MESSAGE_AUTHOR.MODEL },
      placedAt: now,
    });
  });

const remember = (agent: Agent) => {
  const { sessions } = recordingEve();
  const call: AgentCall = {
    caller: { kind: AGENT_CALLER.AGENT, agent },
    eve: sessions,
    eveAs: () => sessions,
    writer: Effect.die(new Error("a memory call writes no line")),
    clientKey: randomUUID(),
  };
  return runAgentRemember(call, { text: FACT });
};

it.layer(getTestDB())("a remember's provenance", (it) => {
  it.effect("a turn an automation's run opened keeps nothing", () =>
    Effect.gen(function* () {
      const { agent, workspaceId } = yield* openAgent();
      yield* writeTurn(agent, { sender: MESSAGE_SENDER.AUTOMATION, name: "Nightly triage" }, []);

      const answer = yield* remember(agent);

      assert.equal(answer.status, ACTION_RESULT_STATUS.REJECTED);
      assert.equal(answer.reason, MEMORY_PROVENANCE_REFUSAL.AUTOMATION);
      assert.deepEqual(yield* listMemories(workspaceId), []);
    }),
  );

  it.effect(
    "an eve agent's first turn, whose line the relay wrote with no sender, keeps nothing where an automation started the agent",
    () =>
      Effect.gen(function* () {
        const origin = {
          name: "Nightly triage",
          firing: { kind: AUTOMATION_FIRING.MANUAL },
          prompt: "Triage the overnight errors.",
        };
        const { agent, workspaceId } = yield* openAgent(origin);
        yield* writeTurn(agent, { sender: undefined }, []);

        assert.equal((yield* remember(agent)).reason, MEMORY_PROVENANCE_REFUSAL.AUTOMATION);
        assert.deepEqual(yield* listMemories(workspaceId), []);
      }),
  );

  it.effect(
    "a turn that read the web, through Vespin's page read or Claude Code's search, keeps nothing",
    () =>
      Effect.gen(function* () {
        for (const read of [AGENT_TOOL.READ_WEB_PAGE, CLAUDE_CODE_TOOL.WEB_SEARCH]) {
          const { agent, workspaceId } = yield* openAgent();
          yield* writeTurn(agent, { sender: MESSAGE_SENDER.MEMBER }, [AGENT_TOOL.BASH, read]);

          const answer = yield* remember(agent);

          assert.equal(answer.reason, MEMORY_PROVENANCE_REFUSAL.WEB_READ, read);
          assert.deepEqual(yield* listMemories(workspaceId), []);
        }
      }),
  );

  it.effect("a turn a member's line opened, which read nothing of the web, keeps the memory", () =>
    Effect.gen(function* () {
      const { agent, workspaceId } = yield* openAgent();
      yield* writeTurn(agent, { sender: MESSAGE_SENDER.MEMBER }, [AGENT_TOOL.BASH]);

      const answer = yield* remember(agent);

      assert.equal(answer.outcome, MEMORY_OUTCOME.KEPT);
      assert.deepEqual(
        (yield* listMemories(workspaceId)).map((kept) => kept.text),
        [FACT],
      );
    }),
  );

  it.effect("a turn that settled refuses nothing, whatever opened it", () =>
    Effect.gen(function* () {
      const { agent } = yield* openAgent();
      yield* writeTurn(
        agent,
        { sender: MESSAGE_SENDER.AUTOMATION, name: "Nightly triage" },
        [AGENT_TOOL.READ_WEB_PAGE],
        TURN_STATUS.SETTLED,
      );

      assert.equal((yield* remember(agent)).outcome, MEMORY_OUTCOME.KEPT);
    }),
  );
});
