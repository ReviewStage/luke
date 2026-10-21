import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createCodingAgent, readCodingAgent } from "@luke/database/models/coding-agent-store";
import { replaceCodingAgentWakeups } from "@luke/database/models/coding-agent-wakeups";
import { claimRuntimeSession } from "@luke/database/models/recorded-session";
import { storeWriter } from "@luke/database/models/writer";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, startTask } from "@luke/database/testing";
import { Duration, Effect, Option, Stream } from "effect";
import {
  type AgentSessions,
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  EveUnreachable,
} from "../agents/brain-host/eve-sessions.js";
import { cancelledTurn } from "../agents/coder-host/stop.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { githubReaching } from "../testing/github-app-fake.js";
import { NATIVE_WAKEUP_SWEEP, sweepNativeWakeups } from "./native-wakeup-sweep.js";

/**
 * The delivery of the wakeups a native agent's released wait left: a
 * wakeup is handed to its agent as a message once due and never again, one
 * not yet due waits, and one whose delivery fails is tried again past the
 * retry, then given up. Over a real dialect, eve a fake at the client's
 * boundary. The claim is the deployment's, so each test reads back only
 * the messages its own agent was sent. Synthetic accounts and prompts.
 */

const DUE = new Date("2026-10-21T12:17:00Z");
const RETRY_MS = Duration.toMillis(NATIVE_WAKEUP_SWEEP.RETRY);

/** eve's coding-agent service, writing down every message sent, by session, or refusing every send. */
function fakeEve(refusing = false) {
  const sent: { readonly sessionId: string; readonly message: EveMessage }[] = [];
  const sessions: AgentSessions = {
    open: () =>
      Effect.succeed({ outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: `wrun_${randomUUID()}` }),
    send: (sessionId, message) =>
      refusing
        ? Effect.fail(
            new EveUnreachable({
              // SAFETY: the client's own error shape, built by the fake at the transport it stands for.
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
    stream: () => Stream.empty,
  };
  return { sent, eveFor: () => Effect.succeed(sessions) };
}

/** The words of a message sent to eve. */
function sentText(message: EveMessage["message"]): string {
  if (!Array.isArray(message)) return message;
  return message.map((part) => (part.type === "text" ? part.text : "")).join("\n");
}

/** An agent of a new account's, its eve session recorded, and the session's id. */
const openAgent = Effect.gen(function* () {
  const db = yield* Database;
  const owner = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: owner, name: "Test User", email: `${owner}@luke.test` });
  const task = yield* startTask(owner, { name: "Invitations" });
  const started = yield* createCodingAgent(owner, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    planSnapshot: "# Invitations\n",
    prompt: null,
    repository: null,
  });
  const { agent } = Option.getOrThrow(started);
  const sessionId = `wrun_${randomUUID()}`;
  yield* claimRuntimeSession(
    { userId: owner, conversationId: agent.conversationId },
    sessionId,
    new Date(DUE.getTime() - 3_600_000),
  );
  return { owner, agentId: agent.id, sessionId };
});

/** One sweep at the instant given, over the eve given. */
const sweepAt = (at: Date, eve: ReturnType<typeof fakeEve>) =>
  sweepNativeWakeups(eve.eveFor, at).pipe(Effect.provide(githubReaching([]).layer));

/** The words the session was sent, in order. */
const sentTo = (eve: ReturnType<typeof fakeEve>, sessionId: string) =>
  eve.sent
    .filter((each) => each.sessionId === sessionId)
    .map((each) => sentText(each.message.message));

it.layer(getTestDB())("the delivery of a released wait's wakeups", (it) => {
  it.effect("a wakeup is told to its agent once it is due, and never again", () =>
    Effect.gen(function* () {
      const eve = fakeEve();
      const { agentId, sessionId } = yield* openAgent;
      yield* replaceCodingAgentWakeups(agentId, [{ at: DUE, prompt: "Check CI on #42." }]);

      yield* sweepAt(new Date(DUE.getTime() - 1_000), eve);
      assert.deepEqual(sentTo(eve, sessionId), [], "not yet due");
      yield* sweepAt(DUE, eve);
      yield* sweepAt(new Date(DUE.getTime() + RETRY_MS), eve);
      assert.deepEqual(sentTo(eve, sessionId), ["Check CI on #42."]);
    }),
  );

  it.effect("a wakeup whose delivery fails is tried again past the retry, then given up", () =>
    Effect.gen(function* () {
      const refusing = fakeEve(true);
      const eve = fakeEve();
      const { agentId, sessionId } = yield* openAgent;
      yield* replaceCodingAgentWakeups(agentId, [{ at: DUE, prompt: "Check the deploy." }]);

      yield* sweepAt(DUE, refusing);
      yield* sweepAt(new Date(DUE.getTime() + 1_000), eve);
      assert.deepEqual(sentTo(eve, sessionId), [], "not before the retry");
      yield* sweepAt(new Date(DUE.getTime() + RETRY_MS), eve);
      assert.deepEqual(sentTo(eve, sessionId), ["Check the deploy."]);

      const given = yield* openAgent;
      yield* replaceCodingAgentWakeups(given.agentId, [{ at: DUE, prompt: "Never lands." }]);
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
        yield* replaceCodingAgentWakeups(agentId, [{ at: DUE, prompt: "Check CI on #42." }]);
        const agent = Option.getOrThrow(yield* readCodingAgent(owner, agentId));

        const cancelled = yield* cancelledTurn(
          Effect.succeed({ cancel: () => Effect.die("no turn runs, so nothing is cancelled") }),
          storeWriter({ tools: CODER_TOOL_SET }),
          agent,
        ).pipe(Effect.provide(githubReaching([]).layer));
        yield* sweepAt(DUE, eve);
        assert.equal(cancelled, false);
        assert.deepEqual(sentTo(eve, sessionId), []);
      }),
  );
});
