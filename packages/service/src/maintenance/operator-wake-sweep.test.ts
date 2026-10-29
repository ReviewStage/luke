import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { type Agent, createAgent } from "@luke/database/models/agent-store";
import { claimRuntimeSession } from "@luke/database/models/recorded-session";
import { storeWriter } from "@luke/database/models/writer";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, openWorkspace } from "@luke/database/testing";
import { AGENT_KIND } from "@luke/features/agent-wire";
import { RUN_EVENT, RUN_STATUS, RUN_TURN_ORIGIN, TURN_TRIGGER } from "@luke/features/turn-run";
import { sessionKey } from "@luke/runtime/vocabulary";
import { TURN_ORIGIN } from "@luke/wire";
import { Duration, Effect, Option } from "effect";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { connectAgentApiKeys } from "../testing/agent-credentials.js";
import { githubReaching } from "../testing/github-app-fake.js";
import { recordingEve, sentTo } from "../testing/recording-eve.js";
import { OPERATOR_WAKE_SWEEP, sweepOperatorWakes } from "./operator-wake-sweep.js";

/**
 * The wake of an operator whose member's agent failed: a failure wakes it
 * once, a second failure within the hour of the wake does not, one past the
 * hour does, and a wake eve refused holds no hour and is sent next minute.
 * Over a real dialect, eve a fake at the client's boundary. The read of the
 * failures due is the deployment's, so each test reads back only the
 * messages its own operator was sent. Synthetic accounts and agents.
 */

const T0 = new Date("2026-10-22T09:00:00Z").getTime();
const HOUR_MS = Duration.toMillis(OPERATOR_WAKE_SWEEP.HOLD);

/** A member of a fresh workspace, their operator with its eve session recorded, and one of their agents. */
const openMember = Effect.gen(function* () {
  const db = yield* Database;
  const member = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: member, name: "Test User", email: `${member}@luke.test` });
  yield* connectAgentApiKeys(member);
  const workspace = yield* openWorkspace(member);
  const operator = Option.getOrThrow(
    yield* createAgent(member, {
      taskId: null,
      organizationId: workspace,
      planSnapshot: null,
      prompt: null,
      kind: AGENT_KIND.OPERATOR,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: null,
    }),
  ).agent;
  const agent = Option.getOrThrow(
    yield* createAgent(member, {
      taskId: null,
      organizationId: workspace,
      planSnapshot: null,
      prompt: "Sweep the flaky tests.",
      title: "Flaky tests",
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "acme/api",
    }),
  ).agent;
  const sessionId = `wrun_${randomUUID()}`;
  yield* claimRuntimeSession(
    { userId: member, conversationId: operator.conversationId },
    sessionId,
    new Date(T0 - HOUR_MS),
  );
  return { agent, sessionId };
});

/** One turn of the agent's, begun and failed at `at`. */
const failedAt = (agent: Agent, at: number) =>
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
    yield* writer.consume(target, {
      ...turn,
      kind: RUN_EVENT.TURN_ENDED,
      sequence: 2,
      status: RUN_STATUS.FAILED,
      responseIds: [],
      at,
    });
  });

/** One sweep at the instant given, over the eve given. */
const sweepAt = (at: number, eve: ReturnType<typeof recordingEve>) =>
  sweepOperatorWakes(eve.eveFor, new Date(at)).pipe(Effect.provide(githubReaching([]).layer));

it.layer(getTestDB())("the wake of an operator whose member's agent failed", (it) => {
  it.effect(
    "a failure wakes the operator once, a second within the hour does not, and one past the hour does",
    () =>
      Effect.gen(function* () {
        const eve = recordingEve();
        const { agent, sessionId } = yield* openMember;

        yield* failedAt(agent, T0);
        yield* sweepAt(T0 + 1_000, eve);
        yield* sweepAt(T0 + 61_000, eve);
        const woken = sentTo(eve, sessionId);
        assert.equal(woken.length, 1, woken.join("\n"));
        assert.ok(woken[0]?.includes("[@Flaky tests]"), woken.join("\n"));

        yield* failedAt(agent, T0 + HOUR_MS / 2);
        yield* sweepAt(T0 + HOUR_MS / 2 + 1_000, eve);
        assert.equal(sentTo(eve, sessionId).length, 1, "within the hour of the wake");

        yield* failedAt(agent, T0 + HOUR_MS + 2_000);
        yield* sweepAt(T0 + HOUR_MS + 3_000, eve);
        assert.equal(sentTo(eve, sessionId).length, 2, "past the hour");
      }),
  );

  it.effect("a wake eve refused holds no hour, and is sent at the next sweep", () =>
    Effect.gen(function* () {
      const refusing = recordingEve(true);
      const eve = recordingEve();
      const { agent, sessionId } = yield* openMember;

      yield* failedAt(agent, T0);
      yield* sweepAt(T0 + 1_000, refusing);
      yield* sweepAt(T0 + 61_000, eve);
      assert.equal(sentTo(eve, sessionId).length, 1);
    }),
  );
});
