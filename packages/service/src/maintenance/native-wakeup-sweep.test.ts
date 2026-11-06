import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent, readAgent } from "@repo/database/models/agent-store";
import { replaceAgentWakeups } from "@repo/database/models/agent-wakeups";
import { claimRuntimeSession } from "@repo/database/models/recorded-session";
import { storeWriter } from "@repo/database/models/writer";
import { user } from "@repo/database/schemas/auth";
import { messages } from "@repo/database/schemas/storage";
import { CONVERSATION_RUNTIME, MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { getTestDB, startTask } from "@repo/database/testing";
import { AGENT_PAYER } from "@repo/features/agent-wire";
import { and, eq, isNotNull } from "drizzle-orm";
import { Duration, Effect, Option } from "effect";
import { canceledTurn } from "../agents/coder-host/stop.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import {
  type AgentSessions,
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  EveUnreachable,
} from "../agents/eve-host/eve-sessions.js";
import { connectAgentApiKeys } from "../testing/agent-credentials.js";
import { githubReaching } from "../testing/github-app-fake.js";
import { NATIVE_WAKEUP_SWEEP, sweepNativeWakeups } from "./native-wakeup-sweep.js";

const DUE = new Date("2026-10-21T12:17:00Z");
const RETRY_MS = Duration.toMillis(NATIVE_WAKEUP_SWEEP.RETRY);

function fakeEve(refusing = false) {
  const sent: { readonly sessionId: string; readonly message: EveMessage }[] = [];
  const sessions: AgentSessions = {
    open: () =>
      Effect.succeed({ outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: `wrun_${randomUUID()}` }),
    send: (sessionId, message) =>
      refusing
        ? Effect.fail(
            new EveUnreachable({
              cause: {
                _tag: "RequestError",
                reason: { _tag: "TransportError" },
                message: "refused",
              } as never,
            }),
          )
        : Effect.sync(() => {
            sent.push({ sessionId, message });
            return {
              outcome: EVE_SEND_OUTCOME.ACCEPTED,
              sessionId,
              deliveryId: randomUUID(),
            } as const;
          }),
    cancel: () => Effect.succeed({ outcome: EVE_CANCEL_OUTCOME.ACCEPTED }),
    reset: () => Effect.succeed({ outcome: EVE_RESET_OUTCOME.RESET }),
  };
  return { sent, sessionsFor: () => Effect.succeed(sessions) };
}

function sentText(message: EveMessage["message"]): string {
  if (!Array.isArray(message)) return message;
  return message.map((part) => (part.type === "text" ? part.text : "")).join("\n");
}

const openAgent = Effect.gen(function* () {
  const db = yield* Database;
  const owner = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: owner, name: "Test User", email: `${owner}@app.test` });
  yield* connectAgentApiKeys(owner);
  const task = yield* startTask(owner, { name: "Invitations" });
  const started = yield* createAgent(owner, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    descriptionSnapshot: "# Invitations\n",
    prompt: null,
    repository: null,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    payer: AGENT_PAYER.API_KEY,
  });
  const { agent } = Option.getOrThrow(started);
  const sessionId = `wrun_${randomUUID()}`;
  yield* claimRuntimeSession(
    { userId: owner, conversationId: agent.conversationId },
    sessionId,
    new Date(DUE.getTime() - 3_600_000),
  );
  return { owner, agentId: agent.id, conversationId: agent.conversationId, sessionId };
});

const sweepAt = (at: Date, eve: ReturnType<typeof fakeEve>) =>
  sweepNativeWakeups(eve.sessionsFor, at).pipe(Effect.provide(githubReaching([]).layer));

const sentTo = (eve: ReturnType<typeof fakeEve>, sessionId: string) =>
  eve.sent
    .filter((each) => each.sessionId === sessionId)
    .map((each) => sentText(each.message.message));

it.layer(getTestDB())("the delivery of a released wait's wakeups", (it) => {
  it.effect(
    "a wakeup is told to its agent once it is due, and never again, as the agent's own line",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { agentId, conversationId, sessionId } = yield* openAgent;
        yield* replaceAgentWakeups(agentId, [{ at: DUE, prompt: "Check CI on #42." }]);

        yield* sweepAt(new Date(DUE.getTime() - 1_000), eve);
        assert.deepEqual(sentTo(eve, sessionId), [], "not yet due");
        yield* sweepAt(DUE, eve);
        yield* sweepAt(new Date(DUE.getTime() + RETRY_MS), eve);
        assert.deepEqual(sentTo(eve, sessionId), ["Check CI on #42."]);
        const db = yield* Database;
        const lines = yield* db
          .select({ sender: messages.sender, senderAgentId: messages.senderAgentId })
          .from(messages)
          .where(and(eq(messages.conversationId, conversationId), isNotNull(messages.sender)));
        assert.deepEqual(lines, [{ sender: MESSAGE_SENDER.AGENT, senderAgentId: agentId }]);
      }),
  );

  it.effect("a wakeup whose delivery fails is tried again past the retry, then given up", () =>
    Effect.gen(function* () {
      const refusing = fakeEve(true);
      const eve = fakeEve();
      const { agentId, sessionId } = yield* openAgent;
      yield* replaceAgentWakeups(agentId, [{ at: DUE, prompt: "Check the deploy." }]);

      yield* sweepAt(DUE, refusing);
      yield* sweepAt(new Date(DUE.getTime() + 1_000), eve);
      assert.deepEqual(sentTo(eve, sessionId), [], "not before the retry");
      yield* sweepAt(new Date(DUE.getTime() + RETRY_MS), eve);
      assert.deepEqual(sentTo(eve, sessionId), ["Check the deploy."]);

      const given = yield* openAgent;
      yield* replaceAgentWakeups(given.agentId, [{ at: DUE, prompt: "Never lands." }]);
      let at = DUE.getTime();
      for (let attempt = 0; attempt < NATIVE_WAKEUP_SWEEP.MAX_ATTEMPTS; attempt += 1) {
        yield* sweepAt(new Date(at), refusing);
        at += RETRY_MS;
      }
      yield* sweepAt(new Date(at), eve);
      assert.deepEqual(sentTo(eve, given.sessionId), [], "given up past the bound");
    }),
  );

  it.effect(
    "a Stop after a released wait, with no turn running to cancel, deletes its wakeups so none is told",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, agentId, sessionId } = yield* openAgent;
        yield* replaceAgentWakeups(agentId, [{ at: DUE, prompt: "Check CI on #42." }]);
        const agent = Option.getOrThrow(yield* readAgent(owner, agentId));

        const canceled = yield* canceledTurn(
          Effect.succeed({ cancel: () => Effect.die("no turn runs, so nothing is canceled") }),
          storeWriter({ tools: CODER_TOOL_SET }),
          agent,
        ).pipe(Effect.provide(githubReaching([]).layer));
        yield* sweepAt(DUE, eve);
        assert.equal(canceled, false);
        assert.deepEqual(sentTo(eve, sessionId), []);
      }),
  );
});
