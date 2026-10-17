import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { LiveStatement } from "@luke/database/core/live-statement";
import { Database } from "@luke/database/core/query";
import {
  archiveCodingAgent,
  createCodingAgent,
  listCodingAgents,
  pinCodingAgent,
  recordCodingAgentPublished,
} from "@luke/database/models/coding-agent-store";
import { listTasks, updateTask } from "@luke/database/models/task-store";
import { readAccountNames } from "@luke/database/models/workspace-store";
import { user } from "@luke/database/schemas/auth";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { messages, turns } from "@luke/database/schemas/storage";
import { getTestDB, joinWorkspace, openWorkspace, startTask } from "@luke/database/testing";
import { STARTING_GRACE_MILLIS } from "@luke/features/coding-agent-status";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import {
  planAgentsOfLiveRows,
  taskListLiveRowsSchema,
  taskListOfLiveRows,
} from "@luke/features/task-list-live";
import { MESSAGE_ROLE, TURN_ORIGIN, TURN_STATUS, type TurnStatus } from "@luke/wire";
import { eq } from "drizzle-orm";
import { Clock, Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { codingAgentSummary, summaryAccounts } from "../agents/coder-host/status.js";
import { standingsOf } from "../agents/coder-host/stop.js";
import { listTasklessAgents, withTaskAgents } from "../agents/task-agents.js";
import { taskListLiveStatements } from "./task-list-live.js";

/**
 * The plan list's live statements against the held read it stands in for:
 * run as raw SQL as Realtime runs them, decoded as the desktop decodes the
 * rows, and built into the list at the instant the held read was read, they
 * answer what the held read answers, for every member and for no one else.
 *
 * Synthetic accounts, plans, and words throughout.
 */

/** The instant the list is read at. */
const NOW = Date.parse("2026-10-15T09:00:00Z");

const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** An agent the account starts on the plan, or with no plan in the workspace, started `ago` before the list is read. */
const openAgent = (
  userId: string,
  place: { readonly taskId: string } | { readonly workspaceId: string },
  ago: number,
) =>
  Effect.gen(function* () {
    const started = yield* createCodingAgent(userId, {
      ...("taskId" in place
        ? { taskId: place.taskId, planSnapshot: "# Invitations\n", prompt: null }
        : {
            taskId: null,
            organizationId: place.workspaceId,
            planSnapshot: null,
            prompt: "Sweep the flaky tests.",
          }),
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "acme/relay",
    });
    const { agent } = Option.getOrThrow(started);
    const db = yield* Database;
    yield* db
      .update(codingAgent)
      .set({ createdAt: new Date(NOW - ago) })
      .where(eq(codingAgent.id, agent.id));
    return agent;
  });

/** A turn of the agent's conversation, queued `ago` before the list is read. */
const turnOf = (
  agent: { readonly userId: string; readonly conversationId: string },
  status: TurnStatus,
  ago: number,
  options: { readonly cancelled?: boolean; readonly settled?: boolean } = {},
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [row] = yield* db
      .insert(turns)
      .values({
        userId: agent.userId,
        conversationId: agent.conversationId,
        origin: TURN_ORIGIN.TYPED,
        status,
        queuedAt: new Date(NOW - ago),
        startedAt: new Date(NOW - ago + 1000),
        settledAt: options.settled === true ? new Date(NOW - ago + 60_000) : null,
        cancelRequestedAt: options.cancelled === true ? new Date(NOW - ago + 2000) : null,
      })
      .returning({ id: turns.id });
    return row?.id ?? "";
  });

/** A line of the developer's to the agent, taken into the turn named or awaiting one. */
const lineOf = (
  agent: { readonly userId: string; readonly conversationId: string },
  seq: number,
  text: string,
  turnId: string | null,
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* db.insert(messages).values({
      userId: agent.userId,
      conversationId: agent.conversationId,
      seq,
      clientId: randomUUID(),
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text }],
      placedAt: new Date(NOW - 1000),
      turnId,
    });
  });

const runLive = (statement: LiveStatement) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) => sql.unsafe(statement.sql, [...statement.params]));

/** The rows the live statements deliver to the account, decoded as the desktop decodes them. */
const liveRowsOf = (userId: string) =>
  Effect.gen(function* () {
    const statements = Option.getOrThrow(taskListLiveStatements(userId));
    return yield* Schema.decodeUnknownEffect(taskListLiveRowsSchema)({
      plans: yield* runLive(statements.plans),
      agents: yield* runLive(statements.agents),
    });
  });

/** The list as the desktop builds it from the live rows, at `now`. */
const liveListOf = (userId: string, now: number) =>
  Effect.map(liveRowsOf(userId), (rows) => taskListOfLiveRows(rows, now));

/** A plan's agents as its own list answers them at `now`, as the service's endpoint builds them. */
const heldPlanAgentsOf = (userId: string, taskId: string, now: number) =>
  Effect.gen(function* () {
    const agents = yield* listCodingAgents(userId, taskId);
    const standing = yield* standingsOf(agents.map((agent) => agent.conversationId));
    const names = yield* readAccountNames(agents.flatMap(summaryAccounts));
    return agents.map((agent) =>
      codingAgentSummary(agent, standing(agent.conversationId), now, names),
    );
  });

/**
 * A clock reading `now` for the held read alone, sleeping as the test's own
 * does. Note that the test's clock is not moved there, because a store test
 * on Postgres shares its connection pool with that clock.
 */
const clockAt = (now: number) =>
  Effect.map(
    Clock.Clock,
    (running): Clock.Clock => ({
      currentTimeMillisUnsafe: () => now,
      currentTimeMillis: Effect.succeed(now),
      currentTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
      currentTimeNanos: Effect.succeed(BigInt(now) * 1_000_000n),
      monotonicTimeNanosUnsafe: () => running.monotonicTimeNanosUnsafe(),
      monotonicTimeNanos: running.monotonicTimeNanos,
      sleep: (duration) => running.sleep(duration),
    }),
  );

/** The list as the service's collection answers it to the desktop at `now`, archived plans and agents among them. */
const heldListOf = (userId: string, now: number) =>
  Effect.gen(function* () {
    const clock = yield* clockAt(now);
    return yield* Effect.provideService(heldList(userId), Clock.Clock, clock);
  });

const heldList = (userId: string) =>
  Effect.gen(function* () {
    const tasks = yield* listTasks(userId, { includeArchived: true });
    return {
      plans: yield* withTaskAgents(userId, tasks),
      planlessAgents: yield* listTasklessAgents(userId, { includeArchived: true }),
    };
  });

const PUBLISHED = {
  number: 42,
  title: "Fix the refresh",
  url: "https://github.com/acme/relay/pull/42",
  state: PULL_REQUEST_STATE.OPEN,
  checks: CHECK_SUMMARY.PASSING,
  additions: 12,
  deletions: 3,
  changedFiles: 2,
};

it.layer(getTestDB())("the plan list's live statements", (it) => {
  it.effect(
    "deliver the rows the held list is built from, every status, pin, archive, and pull request alike, to every member and to no one else",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const teammate = yield* openUser;
        const outsider = yield* openUser;
        yield* openWorkspace(outsider);
        const plan = yield* startTask(owner, { name: "Teammate invitations" });
        const shelved = yield* startTask(owner, { name: "Billing export" });
        yield* joinWorkspace(plan.workspaceId, teammate);

        // A plan's agents in every standing the list says.
        const done = yield* openAgent(owner, { taskId: plan.id }, 60 * 60_000);
        yield* turnOf(done, TURN_STATUS.SETTLED, 50 * 60_000, { settled: true });
        yield* recordCodingAgentPublished(owner, done.id, PUBLISHED);
        const stopping = yield* openAgent(teammate, { taskId: plan.id }, 30 * 60_000);
        yield* turnOf(stopping, TURN_STATUS.RUNNING, 20 * 60_000, { cancelled: true });
        yield* openAgent(owner, { taskId: plan.id }, 60_000);
        yield* openAgent(owner, { taskId: plan.id }, STARTING_GRACE_MILLIS + 60_000);
        const messaged = yield* openAgent(owner, { taskId: plan.id }, 40 * 60_000);
        const ended = yield* turnOf(messaged, TURN_STATUS.SETTLED, 35 * 60_000, { settled: true });
        yield* lineOf(messaged, 1, "Fix the flaky test.", ended);
        yield* lineOf(messaged, 2, "And the other one.", null);
        const archived = yield* openAgent(owner, { taskId: plan.id }, 90 * 60_000);
        yield* turnOf(archived, TURN_STATUS.FAILED, 80 * 60_000, { settled: true });
        yield* archiveCodingAgent(owner, archived.id, true);

        // An archived plan the owner pinned, and an agent with no plan, pinned and archived.
        yield* updateTask(owner, shelved.id, { pinned: true });
        yield* updateTask(owner, shelved.id, { archived: true });
        const loose = yield* openAgent(owner, { workspaceId: plan.workspaceId }, 10 * 60_000);
        yield* turnOf(loose, TURN_STATUS.QUEUED, 5 * 60_000);
        yield* pinCodingAgent(owner, loose.id, true);
        const gone = yield* openAgent(teammate, { workspaceId: plan.workspaceId }, 2 * 60_000);
        yield* archiveCodingAgent(owner, gone.id, true);

        for (const reader of [owner, teammate, outsider]) {
          assert.deepEqual(yield* liveListOf(reader, NOW), yield* heldListOf(reader, NOW));
        }
        // Every plan's agents, as each plan's own list names them, for the desktop's ledger.
        for (const reader of [owner, teammate]) {
          const planAgents = planAgentsOfLiveRows(yield* liveRowsOf(reader), NOW);
          assert.deepEqual(planAgents, [
            ...(yield* heldPlanAgentsOf(reader, plan.id, NOW)),
            ...(yield* heldPlanAgentsOf(reader, shelved.id, NOW)),
          ]);
        }
        const read = yield* liveListOf(owner, NOW);
        const agents = read.plans.find((each) => each.id === plan.id)?.agents;
        assert.deepEqual([agents?.total, agents?.working, agents?.pullRequestTotal], [5, 2, 1]);
        assert.deepEqual(
          (agents?.agents ?? []).map((line) => line.status),
          [CODING_AGENT_STATUS.STARTING, CODING_AGENT_STATUS.RUNNING, CODING_AGENT_STATUS.FAILED],
        );
        assert.deepEqual(
          read.planlessAgents?.map((agent) => [agent.status, agent.pinnedAt !== undefined]),
          [
            [CODING_AGENT_STATUS.STARTING, false],
            [CODING_AGENT_STATUS.RUNNING, true],
          ],
        );
        assert.deepEqual((yield* liveListOf(outsider, NOW)).plans, []);
      }),
  );

  it.effect(
    "an agent with no turn reads failed once its grace ends, as the held read reads it then",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const plan = yield* startTask(owner, { name: "Teammate invitations" });
        yield* openAgent(owner, { taskId: plan.id }, 0);
        const later = NOW + STARTING_GRACE_MILLIS + 1;

        const read = yield* liveListOf(owner, later);

        assert.deepEqual(read, yield* heldListOf(owner, later));
        assert.deepEqual(
          read.plans[0]?.agents?.agents.map((line) => line.status),
          [CODING_AGENT_STATUS.FAILED],
        );
      }),
  );
});
