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
  pinCodingAgentCommitted,
  recordCodingAgentPublished,
  renameCodingAgentCommitted,
} from "@luke/database/models/coding-agent-store";
import { linkTaskIssue, unlinkTaskIssue } from "@luke/database/models/task-issue-store";
import {
  deleteTaskCommitted,
  listTasks,
  updateTask,
  updateTaskCommitted,
} from "@luke/database/models/task-store";
import { readAccountNames } from "@luke/database/models/workspace-store";
import { user } from "@luke/database/schemas/auth";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { messages, turns } from "@luke/database/schemas/storage";
import {
  getTestDB,
  joinWorkspace,
  linearIssueLink,
  mutableFunctionsOf,
  openWorkspace,
  startTask,
} from "@luke/database/testing";
import { LINE_GRACE_MILLIS, STARTING_GRACE_MILLIS } from "@luke/features/coding-agent-status";
import {
  CHECK_SUMMARY,
  CODING_AGENT_ARCHIVER,
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import {
  taskAgentsOfLiveRows,
  taskListLiveRowsSchema,
  taskListOfLiveRows,
} from "@luke/features/task-list-live";
import {
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TURN_ORIGIN,
  TURN_STATUS,
  type TurnStatus,
} from "@luke/wire";
import { eq } from "drizzle-orm";
import { Clock, Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { codingAgentSummary, summaryAccounts } from "../agents/coder-host/status.js";
import { standingsOf } from "../agents/coder-host/stop.js";
import { listTasklessAgents, withTaskAgents } from "../agents/task-agents.js";
import { BRAIN_REQUEST_FAILURE } from "../core.js";
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
  place: { readonly taskId: string; readonly blank?: boolean } | { readonly workspaceId: string },
  ago: number,
) =>
  Effect.gen(function* () {
    const started = yield* createCodingAgent(userId, {
      ...("taskId" in place
        ? place.blank === true
          ? { taskId: place.taskId, planSnapshot: null, prompt: null }
          : { taskId: place.taskId, planSnapshot: "# Invitations\n", prompt: null }
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
  options: {
    readonly cancelled?: boolean;
    readonly settled?: boolean;
    readonly failure?: string;
  } = {},
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
        ...(options.failure === undefined ? undefined : { failure: options.failure }),
      })
      .returning({ id: turns.id });
    return row?.id ?? "";
  });

/** A line of the developer's to the agent, taken into the turn named or awaiting one, written `ago` before the list is read. */
const lineOf = (
  agent: { readonly userId: string; readonly conversationId: string },
  seq: number,
  text: string,
  turnId: string | null,
  ago = 1000,
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
      placedAt: new Date(NOW - ago),
      createdAt: new Date(NOW - ago),
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
      issues: yield* runLive(statements.issues),
    });
  });

/** The list as the desktop builds it from the live rows, at `now`. */
const liveListOf = (userId: string, now: number) =>
  Effect.map(liveRowsOf(userId), (rows) => taskListOfLiveRows(rows, now));

/** A plan's agents as its own list answers them at `now`, as the service's endpoint builds them. */
const heldTaskAgentsOf = (userId: string, taskId: string, now: number) =>
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
    "a write that changes the task answers the transaction it committed in, and one that changes nothing answers none",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const plan = yield* startTask(owner, { name: "Teammate invitations" });

        const renamed = Option.getOrThrow(
          yield* updateTaskCommitted(owner, plan.id, { name: "Invitations" }),
        );
        const pinned = Option.getOrThrow(
          yield* updateTaskCommitted(owner, plan.id, { pinned: true }),
        );
        const again = Option.getOrThrow(
          yield* updateTaskCommitted(owner, plan.id, { pinned: true }),
        );

        assert.match(renamed.txid ?? "", /^[0-9]+$/u);
        assert.match(pinned.txid ?? "", /^[0-9]+$/u);
        assert.notEqual(renamed.txid, pinned.txid, "each write is its own transaction");
        assert.equal(again.txid, undefined, "a pin asked again writes nothing to wait for");
        assert.equal(renamed.task.name, "Invitations");
      }),
  );

  it.effect(
    "an agent's rename and pin answer the transaction they committed in, a pin asked again none, and a delete its own",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const plan = yield* startTask(owner, { name: "Teammate invitations" });
        const loose = yield* openAgent(owner, { workspaceId: plan.workspaceId }, 60_000);

        const renamed = Option.getOrThrow(
          yield* renameCodingAgentCommitted(owner, loose.id, "Sweep"),
        );
        const pinned = Option.getOrThrow(yield* pinCodingAgentCommitted(owner, loose.id, true));
        const again = Option.getOrThrow(yield* pinCodingAgentCommitted(owner, loose.id, true));
        const deleted = Option.getOrThrow(yield* deleteTaskCommitted(owner, plan.id));
        const missing = yield* deleteTaskCommitted(owner, plan.id);

        assert.match(renamed.txid ?? "", /^[0-9]+$/u);
        assert.equal(renamed.agent.title, "Sweep");
        assert.match(pinned.txid ?? "", /^[0-9]+$/u);
        assert.equal(again.txid, undefined, "a pin asked again writes nothing to wait for");
        assert.match(deleted.txid, /^[0-9]+$/u);
        assert.ok(Option.isNone(missing), "a task already gone is deleted by nothing");
      }),
  );

  it.effect("call only functions Postgres marks immutable, as Realtime requires", () =>
    Effect.gen(function* () {
      const { plans, agents, issues } = Option.getOrThrow(taskListLiveStatements("user-immutable"));
      assert.deepEqual(yield* mutableFunctionsOf(plans), []);
      assert.deepEqual(yield* mutableFunctionsOf(agents), []);
      assert.deepEqual(yield* mutableFunctionsOf(issues), []);
    }),
  );

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
        // A line no turn took past its grace, and a line after a turn whose session ended for good.
        const unanswered = yield* openAgent(owner, { taskId: plan.id }, 45 * 60_000);
        const answered = yield* turnOf(unanswered, TURN_STATUS.SETTLED, 44 * 60_000, {
          settled: true,
        });
        yield* lineOf(unanswered, 1, "Start the export.", answered);
        yield* lineOf(unanswered, 2, "Are you there?", null, LINE_GRACE_MILLIS + 60_000);
        const orphaned = yield* openAgent(owner, { taskId: plan.id }, 25 * 60_000);
        yield* turnOf(orphaned, TURN_STATUS.FAILED, 24 * 60_000, {
          settled: true,
          failure: BRAIN_REQUEST_FAILURE.SESSION_ENDED,
        });
        yield* lineOf(orphaned, 1, "Try again.", null, 60_000);

        // An archived plan the owner pinned, and an agent with no plan, pinned and archived.
        // An agent started blank, long past the starting grace: it reads completed, not failed.
        yield* openAgent(owner, { taskId: shelved.id, blank: true }, STARTING_GRACE_MILLIS * 3);
        yield* updateTask(owner, plan.id, { assigneeId: teammate });
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
          const taskAgents = taskAgentsOfLiveRows(yield* liveRowsOf(reader), NOW);
          assert.deepEqual(taskAgents, [
            ...(yield* heldTaskAgentsOf(reader, plan.id, NOW)),
            ...(yield* heldTaskAgentsOf(reader, shelved.id, NOW)),
          ]);
        }
        const read = yield* liveListOf(owner, NOW);
        const agents = read.plans.find((each) => each.id === plan.id)?.agents;
        assert.deepEqual([agents?.total, agents?.working, agents?.pullRequestTotal], [7, 2, 1]);
        assert.ok(
          (agents?.agents ?? []).every(
            (line) =>
              ![unanswered.id, orphaned.id].includes(line.id) ||
              line.status === CODING_AGENT_STATUS.FAILED,
          ),
          "a line unanswered past its grace, or after an ended session, reads failed",
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
    "deliver each plan's linked issues as its tags, oldest linked first, as the held list names them, to every member and to no one else, and a link let go goes",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const teammate = yield* openUser;
        const outsider = yield* openUser;
        yield* openWorkspace(outsider);
        const plan = yield* startTask(owner, { name: "Teammate invitations" });
        const bare = yield* startTask(owner, { name: "Billing export" });
        yield* joinWorkspace(plan.workspaceId, teammate);
        const link = (n: number) =>
          Effect.map(
            linkTaskIssue(
              owner,
              plan.id,
              linearIssueLink({
                identifier: `ENG-${n}`,
                title: `Issue ${n}`,
                url: `https://linear.app/acme/issue/ENG-${n}`,
                description: "",
              }),
            ),
            Option.getOrThrow,
          );
        const first = yield* link(7);
        yield* link(3);
        yield* link(12);

        for (const reader of [owner, teammate, outsider]) {
          assert.deepEqual(yield* liveListOf(reader, NOW), yield* heldListOf(reader, NOW));
        }
        const read = yield* liveListOf(teammate, NOW);
        assert.deepEqual(
          read.plans.find((each) => each.id === plan.id)?.issues?.map((tag) => tag.key),
          ["ENG-7", "ENG-3", "ENG-12"],
        );
        assert.equal(read.plans.find((each) => each.id === bare.id)?.issues, undefined);
        assert.deepEqual((yield* liveRowsOf(outsider)).issues, []);

        yield* unlinkTaskIssue(owner, plan.id, first.id);
        assert.deepEqual(
          (yield* liveListOf(owner, NOW)).plans
            .find((each) => each.id === plan.id)
            ?.issues?.map((tag) => tag.key),
          ["ENG-3", "ENG-12"],
        );
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

  it.effect(
    "a line awaiting its turn reads running inside its grace and failed once the grace ends, as the held read reads it then",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const plan = yield* startTask(owner, { name: "Teammate invitations" });
        const agent = yield* openAgent(owner, { taskId: plan.id }, 10 * 60_000);
        const ended = yield* turnOf(agent, TURN_STATUS.SETTLED, 9 * 60_000, { settled: true });
        yield* lineOf(agent, 1, "Fix the flaky test.", ended);
        yield* lineOf(agent, 2, "And the other one.", null);

        for (const [at, status] of [
          [NOW, CODING_AGENT_STATUS.RUNNING],
          [NOW - 1000 + LINE_GRACE_MILLIS + 1, CODING_AGENT_STATUS.FAILED],
        ] as const) {
          const read = yield* liveListOf(owner, at);
          assert.deepEqual(read, yield* heldListOf(owner, at));
          assert.deepEqual(
            read.plans[0]?.agents?.agents.map((line) => line.status),
            [status],
          );
        }
      }),
  );

  it.effect(
    "an agent with no task's pull request, the agent it continues, and its archive's task mark, a line a call spoke or took typed, and an agent only its starter sees read as the held read reads them",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const owner = yield* openUser;
        const teammate = yield* openUser;
        const plan = yield* startTask(owner, { name: "Teammate invitations" });
        yield* joinWorkspace(plan.workspaceId, teammate);

        // An agent with no task that opened a pull request, and one continuing it, archived as it left a task.
        const loose = yield* openAgent(owner, { workspaceId: plan.workspaceId }, 20 * 60_000);
        yield* recordCodingAgentPublished(owner, loose.id, PUBLISHED);
        const continued = yield* openAgent(owner, { workspaceId: plan.workspaceId }, 10 * 60_000);
        yield* db
          .update(codingAgent)
          .set({
            startedFrom: { agentId: loose.id, steps: 3, totalSteps: 5 },
            archivedAt: new Date(NOW - 60_000),
            archivedBy: { by: CODING_AGENT_ARCHIVER.MEMBER, userId: owner, withTask: true },
          })
          .where(eq(codingAgent.id, continued.id));

        // A line a call spoke after the agent's turn settled, which opens no turn of its own.
        const spoken = yield* openAgent(owner, { taskId: plan.id }, 30 * 60_000);
        const settled = yield* turnOf(spoken, TURN_STATUS.SETTLED, 25 * 60_000, { settled: true });
        yield* lineOf(spoken, 1, "Fix the flaky test.", settled);
        yield* db.insert(messages).values({
          userId: owner,
          conversationId: spoken.conversationId,
          seq: 2,
          clientId: randomUUID(),
          role: MESSAGE_ROLE.USER,
          parts: [{ type: "text", text: "Thanks, that's all." }],
          metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.VOICE },
          placedAt: new Date(NOW - 1000),
          createdAt: new Date(NOW - 1000),
          turnId: null,
        });
        // And a line typed into the agent's call, which the call answers without a turn of the agent's.
        yield* db.insert(messages).values({
          userId: owner,
          conversationId: spoken.conversationId,
          seq: 3,
          clientId: randomUUID(),
          role: MESSAGE_ROLE.USER,
          parts: [{ type: "text", text: "One more thing." }],
          metadata: {
            author: MESSAGE_AUTHOR.DEVELOPER,
            channel: MESSAGE_CHANNEL.TYPED,
            voice_session_id: "voice-session-1",
          },
          placedAt: new Date(NOW - 500),
          createdAt: new Date(NOW - 500),
          turnId: null,
        });

        // An agent on the shared task working through its starter's own token, which the teammate does not see.
        const hidden = yield* openAgent(owner, { taskId: plan.id }, 5 * 60_000);
        yield* db
          .update(codingAgent)
          .set({ githubAccess: GITHUB_ACCESS.TOKEN })
          .where(eq(codingAgent.id, hidden.id));

        for (const reader of [owner, teammate]) {
          assert.deepEqual(yield* liveListOf(reader, NOW), yield* heldListOf(reader, NOW));
        }
        const read = yield* liveListOf(owner, NOW);
        const byId = new Map((read.planlessAgents ?? []).map((agent) => [agent.id, agent]));
        assert.equal(byId.get(loose.id)?.pullRequest?.number, PUBLISHED.number);
        assert.equal(byId.get(continued.id)?.from?.agentId, loose.id);
        assert.equal(byId.get(continued.id)?.archivedBy?.withTask, true);
        const lines = read.plans.find((each) => each.id === plan.id)?.agents?.agents ?? [];
        assert.equal(
          lines.find((line) => line.id === spoken.id)?.status,
          CODING_AGENT_STATUS.COMPLETED,
          "a line a call spoke or took typed leaves a settled agent completed",
        );
        const seen = (yield* liveListOf(teammate, NOW)).plans.find((each) => each.id === plan.id);
        assert.ok(
          !(seen?.agents?.agents ?? []).some((line) => line.id === hidden.id),
          "the teammate's list leaves out the agent they do not see",
        );
      }),
  );
});
