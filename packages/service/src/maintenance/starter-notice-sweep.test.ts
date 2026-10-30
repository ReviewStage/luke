import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { type Agent, createAgent } from "@luke/database/models/agent-store";
import { claimRuntimeSession } from "@luke/database/models/recorded-session";
import { createTask } from "@luke/database/models/task-store";
import { storeWriter } from "@luke/database/models/writer";
import { user } from "@luke/database/schemas/auth";
import { task } from "@luke/database/schemas/task";
import { getTestDB, openWorkspace } from "@luke/database/testing";
import { TASK_MODE } from "@luke/features/task-wire";
import {
  RUN_EVENT,
  RUN_STATUS,
  RUN_TURN_ORIGIN,
  type RunStatus,
  TURN_TRIGGER,
} from "@luke/features/turn-run";
import { sessionKey } from "@luke/runtime/vocabulary";
import { TURN_ORIGIN } from "@luke/wire";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { connectAgentApiKeys } from "../testing/agent-credentials.js";
import { githubReaching } from "../testing/github-app-fake.js";
import { recordingEve, sentTo } from "../testing/recording-eve.js";
import { sweepStarterNotices } from "./starter-notice-sweep.js";

/**
 * The line to an agent's starter when the agent it started ends without
 * finishing, where the starter, which takes a turn only when a message
 * reaches it, would otherwise wait on a report that never comes. Over a real
 * dialect, eve a fake at the client's boundary. The read of the endings due
 * is the deployment's, so the test reads back only the messages its own
 * starter was sent. Synthetic accounts and agents.
 */

const T0 = new Date("2026-10-28T12:00:00Z").getTime();

/**
 * A member of a fresh workspace, their orchestrating agent with its eve
 * session recorded, and an agent it started, both on the task `taskOf` makes
 * in that workspace, or on none.
 */
const openStartedOn = <E, R>(
  taskOf: (member: string, organizationId: string) => Effect.Effect<string | null, E, R>,
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const member = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: member, name: "Test User", email: `${member}@luke.test` });
    yield* connectAgentApiKeys(member);
    const organizationId = yield* openWorkspace(member);
    const taskId = yield* taskOf(member, organizationId);
    const start =
      taskId === null
        ? ({ taskId: null, organizationId, planSnapshot: null, repository: null } as const)
        : ({ taskId, planSnapshot: null, repository: null } as const);
    const choice = { model: "anthropic/claude-opus-5.5", effort: "high" };
    const starter = Option.getOrThrow(
      yield* createAgent(member, {
        ...start,
        prompt: "Orchestrate the rollout.",
        idempotencyKey: randomUUID(),
        ...choice,
      }),
    ).agent;
    const agent = Option.getOrThrow(
      yield* createAgent(member, {
        ...start,
        prompt: "Record the starter.",
        title: "Record the starter",
        idempotencyKey: randomUUID(),
        startedByAgentId: starter.id,
        ...choice,
      }),
    ).agent;
    const sessionId = `wrun_${randomUUID()}`;
    yield* claimRuntimeSession(
      { userId: member, conversationId: starter.conversationId },
      sessionId,
      new Date(T0 - 60_000),
    );
    return { agent, sessionId };
  });

/** {@link openStartedOn} no task, as most are. */
const openStarted = openStartedOn(() => Effect.succeed(null));

/** One turn of the agent's, begun just before `at` and ended in the run status given at `at`. */
const endedAt = (agent: Agent, status: RunStatus, at: number) =>
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
      status,
      responseIds: [],
      at,
    });
  });

/** One sweep at the instant given, over the eve given. */
const sweepAt = (at: number, eve: ReturnType<typeof recordingEve>) =>
  sweepStarterNotices(eve.eveFor, new Date(at)).pipe(Effect.provide(githubReaching([]).layer));

it.layer(getTestDB())("the line to an agent's starter when the agent it started ends", (it) => {
  it.effect(
    "a failed turn tells the starter once, naming the agent, and a completed turn tells it nothing",
    () =>
      Effect.gen(function* () {
        const eve = recordingEve();
        const { agent, sessionId } = yield* openStarted;

        yield* endedAt(agent, RUN_STATUS.SUCCEEDED, T0);
        yield* sweepAt(T0 + 1_000, eve);
        assert.deepEqual(sentTo(eve, sessionId), []);

        yield* endedAt(agent, RUN_STATUS.FAILED, T0 + 2_000);
        yield* sweepAt(T0 + 3_000, eve);
        yield* sweepAt(T0 + 63_000, eve);
        const told = sentTo(eve, sessionId);
        assert.equal(told.length, 1, told.join("\n"));
        assert.ok(told[0]?.includes("[@Record the starter]"), told.join("\n"));
        assert.ok(told[0]?.includes("failed its turn"), told.join("\n"));
      }),
  );

  it.effect(
    "a failed turn under a starter on a child task of a pilot tree whose Running switch is off tells nothing while it is off, and tells the starter once Running is on",
    () =>
      Effect.gen(function* () {
        const eve = recordingEve();
        const { agent, sessionId } = yield* openStartedOn((member, organizationId) =>
          Effect.gen(function* () {
            const top = yield* createTask(member, { organizationId, mode: TASK_MODE.PILOT });
            const child = yield* createTask(member, { organizationId, parentTaskId: top.id });
            return child.id;
          }),
        );

        yield* endedAt(agent, RUN_STATUS.FAILED, T0);
        yield* sweepAt(T0 + 1_000, eve);
        assert.deepEqual(sentTo(eve, sessionId), [], "a stopped tree's starter is told nothing");
        // The child's own switch is never read, so turning on the workspace's is turning on the top's.
        yield* Database.use((db) =>
          db
            .update(task)
            .set({ running: true })
            .where(eq(task.organizationId, agent.organizationId)),
        );
        yield* sweepAt(T0 + 61_000, eve);

        const told = sentTo(eve, sessionId);
        assert.equal(told.length, 1, told.join("\n"));
        assert.ok(told[0]?.includes("failed its turn"), told.join("\n"));
      }),
  );
});
