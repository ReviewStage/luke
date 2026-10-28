import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  type Agent,
  type AgentBriefText,
  type AgentPlace,
  type AgentStarted,
  archiveAgent,
  createAgent,
  dispatchMentioningServers,
  listAgents,
  listPublishedAgents,
  type NewAgent,
  readAgent,
  readAgentOfConversation,
  recordAgentPublished,
  renameAgent,
  takeAgentMentionedServers,
  updateAgentChoice,
} from "@luke/database/models/agent-store";
import { listTasks } from "@luke/database/models/task-store";
import { agentTable } from "@luke/database/schemas/agent";
import { user } from "@luke/database/schemas/auth";
import { conversations } from "@luke/database/schemas/storage";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { getTestDB, joinWorkspace, startTask } from "@luke/database/testing";
import {
  AGENT_BRIEF,
  type AgentPullRequest,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
} from "@luke/features/agent-wire";
import { AUTOMATION_FIRING } from "@luke/features/automation-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { listTasklessAgents, withTaskAgents } from "@luke/service/agents/task-agents";
import { count, eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { TestClock } from "effect/testing";

/**
 * The coding agents of an account's tasks, through the store's public
 * functions against a real dialect. What is held to is the shape a Start
 * relies on: one Start is one agent with one `coding_agent` conversation,
 * a retry carrying the same key is that agent and not a second, the tabs
 * read a task's agents in the order they were started, and nothing of a
 * task another account owns is read or written.
 *
 * Synthetic accounts, tasks, repositories, and keys throughout.
 */

const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** An account with one task started. */
const openTask = Effect.gen(function* () {
  const userId = yield* openUser;
  const task = yield* startTask(userId, { name: "Teammate invitations" });
  return { userId, taskId: task.id };
});

/** What a Start hands the agent where the test names nothing: the plan's text. */
const TASK_BRIEF: AgentBriefText = {
  planSnapshot: "# Teammate invitations\n\nAny member may invite by email.\n",
  prompt: null,
};

function start(
  taskId: string,
  overrides: Partial<Omit<NewAgent, keyof AgentPlace>> = {},
  brief: AgentBriefText = TASK_BRIEF,
): NewAgent {
  return {
    taskId: taskId,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    repository: "reviewstage/luke",
    ...overrides,
    ...brief,
  };
}

/** The agent a Start answered and made, failing the test where it answered none or found one. */
function started(answer: Option.Option<AgentStarted>): Agent {
  const start = Option.getOrElse(answer, () => assert.fail("the start answered no agent"));
  assert.equal(start.created, true);
  return start.agent;
}

/** The agent a Start answered and found already made, failing the test where it answered none or made one. */
function found(answer: Option.Option<AgentStarted>): Agent {
  const start = Option.getOrElse(answer, () => assert.fail("the start answered no agent"));
  assert.equal(start.created, false);
  return start.agent;
}

const agentRows = (userId: string) =>
  Effect.map(
    Database.use((db) =>
      db.select({ rows: count() }).from(agentTable).where(eq(agentTable.userId, userId)),
    ),
    (rows) => rows[0]?.rows ?? 0,
  );

const conversationKind = (conversationId: string) =>
  Effect.map(
    Database.use((db) =>
      db
        .select({ kind: conversations.kind, deletedAt: conversations.deletedAt })
        .from(conversations)
        .where(eq(conversations.id, conversationId)),
    ),
    (rows) => rows[0],
  );

/** A pull request as GitHub answered a read of it. */
const PULL_REQUEST: AgentPullRequest = {
  number: 41,
  title: "Teammate invitations",
  url: "https://github.com/reviewstage/luke/pull/41",
  state: PULL_REQUEST_STATE.DRAFT,
  checks: CHECK_SUMMARY.PENDING,
  additions: 120,
  deletions: 4,
  changedFiles: 3,
};

/** Text the size of a long plan, which an agent may be handed and no list line carries. */
const LARGE_TEXT = "Any member may invite a teammate by email, and the invite expires.\n".repeat(
  4_000,
);

/** What a list reads of an agent: its row without the text it was handed, whether that was a prompt, and its automation's name. */
function listedLine({ planSnapshot, prompt, automationOrigin, ...row }: Agent) {
  const brief =
    prompt !== null
      ? AGENT_BRIEF.PROMPT
      : planSnapshot !== null
        ? AGENT_BRIEF.PLAN
        : AGENT_BRIEF.BLANK;
  return { ...row, automationName: automationOrigin?.name ?? null, brief };
}

it.layer(getTestDB())("the coding agents of an account's plans", (it) => {
  it.effect(
    "the pull request an agent published reads back beside the agents of the plans named, as last recorded, and nothing of another account's is read or written",
    () =>
      Effect.gen(function* () {
        const { userId, taskId } = yield* openTask;
        const other = yield* openTask;
        const agent = started(yield* createAgent(userId, start(taskId)));
        const theirs = started(yield* createAgent(other.userId, start(other.taskId)));

        yield* recordAgentPublished(userId, agent.id, PULL_REQUEST);
        // Another account's write names no agent of theirs, and another account's read names none of this one's.
        yield* recordAgentPublished(userId, theirs.id, PULL_REQUEST);
        assert.deepEqual(yield* listPublishedAgents(userId, [taskId, other.taskId]), [
          { agent: listedLine(agent), published: PULL_REQUEST },
        ]);
        assert.deepEqual(yield* listPublishedAgents(other.userId, [other.taskId]), [
          { agent: listedLine(theirs), published: null },
        ]);

        yield* recordAgentPublished(userId, agent.id, null);
        assert.deepEqual(yield* listPublishedAgents(userId, [taskId]), [
          { agent: listedLine(agent), published: null },
        ]);
      }),
  );

  it.effect("an archived agent is left out of its plan's agents unless asked for", () =>
    Effect.gen(function* () {
      const { userId, taskId } = yield* openTask;
      const agent = started(yield* createAgent(userId, start(taskId)));
      const archived = Option.getOrElse(yield* archiveAgent(userId, agent.id, true), () =>
        assert.fail("the agent is archived"),
      );

      assert.deepEqual(yield* listPublishedAgents(userId, [taskId]), []);
      assert.deepEqual(yield* listPublishedAgents(userId, [taskId], { includeArchived: true }), [
        { agent: listedLine(archived), published: null },
      ]);
    }),
  );

  it.effect(
    "an agent with no plan carries the pull request it opened in its row, as a plan's row carries its agents'",
    () =>
      Effect.gen(function* () {
        const { userId, taskId } = yield* openTask;
        const workspaceId = started(yield* createAgent(userId, start(taskId))).organizationId;
        const taskless = (repository: string) =>
          Effect.map(
            createAgent(userId, {
              taskId: null,
              organizationId: workspaceId,
              planSnapshot: null,
              prompt: "Sweep the copy.",
              idempotencyKey: randomUUID(),
              model: "anthropic/claude-opus-5.5",
              effort: "high",
              repository,
            }),
            started,
          );
        const published = yield* taskless("reviewstage/luke");
        const quiet = yield* taskless("reviewstage/luke");
        yield* recordAgentPublished(userId, published.id, PULL_REQUEST);

        const rows = yield* listTasklessAgents(userId, { includeArchived: false });
        const { number, title, url, state, checks } = PULL_REQUEST;
        assert.deepEqual(rows.find((row) => row.id === published.id)?.pullRequest, {
          number,
          title,
          url,
          state,
          checks,
        });
        assert.equal(rows.find((row) => row.id === quiet.id)?.pullRequest, undefined);
      }),
  );

  it.effect("a plan's listed pull request names the agent that opened it, whose tab it opens", () =>
    Effect.gen(function* () {
      const { userId, taskId } = yield* openTask;
      const agent = started(yield* createAgent(userId, start(taskId)));
      yield* recordAgentPublished(userId, agent.id, PULL_REQUEST);

      const [listed] = yield* withTaskAgents(userId, yield* listTasks(userId));
      assert.deepEqual(
        listed?.agents?.pullRequests.map(({ url, agentId }) => ({ url, agentId })),
        [{ url: PULL_REQUEST.url, agentId: agent.id }],
      );
    }),
  );

  it.effect(
    "a plan whose agent was archived still reads that agent's activity, naming the agent no more",
    () =>
      Effect.gen(function* () {
        const { userId, taskId } = yield* openTask;
        yield* TestClock.adjust("1 hour");
        const agent = started(yield* createAgent(userId, start(taskId)));
        yield* archiveAgent(userId, agent.id, true);

        const [listed] = yield* withTaskAgents(userId, yield* listTasks(userId));
        assert.ok(listed, "the plan is listed");
        assert.equal(listed.agents?.activityAt, agent.createdAt.getTime());
        assert.ok(
          (listed.agents?.activityAt ?? 0) > listed.updatedAt,
          "later than the plan's save",
        );
        assert.equal(listed.agents?.total, 0);
        assert.deepEqual(listed.agents?.agents, []);
      }),
  );

  it.effect(
    "the servers a send eve took mentioned are taken once, each once, by the next turn, the task's among them, while a refused send's are put back as they stood, and another account adds or takes none",
    () =>
      Effect.gen(function* () {
        const { userId, taskId } = yield* openTask;
        const other = yield* openTask;
        const agent = started(
          yield* createAgent(
            userId,
            start(taskId, { mentionedServers: [INTEGRATION_PROVIDER.SENTRY] }),
          ),
        );
        const taken = Effect.succeed(true);
        const refused = Effect.succeed(false);

        yield* dispatchMentioningServers(userId, agent.id, [INTEGRATION_PROVIDER.LINEAR], taken);
        yield* dispatchMentioningServers(
          userId,
          agent.id,
          [INTEGRATION_PROVIDER.LINEAR, INTEGRATION_PROVIDER.NOTION],
          taken,
        );
        yield* dispatchMentioningServers(userId, agent.id, [INTEGRATION_PROVIDER.VERCEL], refused);
        yield* dispatchMentioningServers(
          other.userId,
          agent.id,
          [INTEGRATION_PROVIDER.SLACK],
          taken,
        );
        const theirs = yield* takeAgentMentionedServers(other.userId, agent.conversationId);
        const first = yield* takeAgentMentionedServers(userId, agent.conversationId);
        const again = yield* takeAgentMentionedServers(userId, agent.conversationId);

        assert.deepEqual(theirs, []);
        assert.deepEqual(
          [...first].sort(),
          [
            INTEGRATION_PROVIDER.LINEAR,
            INTEGRATION_PROVIDER.NOTION,
            INTEGRATION_PROVIDER.SENTRY,
          ].sort(),
        );
        assert.deepEqual(again, []);
      }),
  );

  it.effect("a Start is one agent on a conversation of its own, holding what it was handed", () =>
    Effect.gen(function* () {
      const { userId, taskId } = yield* openTask;
      const asked = start(taskId, { model: "openai/gpt-6.1-sol", effort: "xhigh" });

      const agent = started(yield* createAgent(userId, asked));

      assert.equal(agent.taskId, taskId);
      assert.equal(agent.model, asked.model);
      assert.equal(agent.effort, asked.effort);
      assert.equal(agent.planSnapshot, asked.planSnapshot);
      assert.equal(agent.prompt, null);
      assert.equal(agent.repository, asked.repository);
      assert.deepEqual(yield* conversationKind(agent.conversationId), {
        kind: CONVERSATION_KIND.CODING_AGENT,
        deletedAt: null,
      });
      assert.deepEqual(yield* readAgent(userId, agent.id), Option.some(agent));
    }),
  );

  it.effect("a plan another account owns starts nothing and reads as no agents", () =>
    Effect.gen(function* () {
      const { userId, taskId } = yield* openTask;
      const other = yield* openUser;
      const agent = started(yield* createAgent(userId, start(taskId)));

      assert.deepEqual(yield* createAgent(other, start(taskId)), Option.none());
      assert.equal(yield* agentRows(other), 0);
      assert.deepEqual(yield* listAgents(other, taskId), []);
      assert.deepEqual(yield* readAgent(other, agent.id), Option.none());
    }),
  );

  it.effect(
    "an agent one member started is listed, read, renamed, and re-chosen by another, a non-member reaches none, and a retry key is the starter's own",
    () =>
      Effect.gen(function* () {
        const starter = yield* openUser;
        const teammate = yield* openUser;
        const stranger = yield* openUser;
        const task = yield* startTask(starter, { name: "Teammate invitations" });
        yield* joinWorkspace(task.workspaceId, teammate);
        const asked = start(task.id);
        const agent = started(yield* createAgent(starter, asked));
        assert.equal(agent.userId, starter);

        assert.deepEqual(yield* listAgents(teammate, task.id), [agent]);
        assert.deepEqual(yield* listPublishedAgents(teammate, [task.id]), [
          { agent: listedLine(agent), published: null },
        ]);
        assert.deepEqual(yield* readAgent(teammate, agent.id), Option.some(agent));
        assert.deepEqual(
          yield* readAgentOfConversation(teammate, agent.conversationId),
          Option.some(agent),
        );
        const renamed = yield* renameAgent(teammate, agent.id, "Invite emails");
        assert.equal(Option.getOrUndefined(renamed)?.title, "Invite emails");
        const chosen = yield* updateAgentChoice(teammate, agent.id, {
          model: "openai/gpt-5.5",
          effort: "low",
        });
        assert.equal(Option.getOrUndefined(chosen)?.model, "openai/gpt-5.5");
        assert.equal(
          Option.getOrUndefined(yield* readAgent(starter, agent.id))?.title,
          "Invite emails",
        );

        // The teammate's Start under the starter's key is a Start of their own, and the starter's retry still finds theirs.
        const theirs = started(
          yield* createAgent(teammate, start(task.id, { idempotencyKey: asked.idempotencyKey })),
        );
        assert.notEqual(theirs.id, agent.id);
        assert.equal(theirs.userId, teammate);
        assert.equal(found(yield* createAgent(starter, asked)).id, agent.id);

        assert.deepEqual(yield* listAgents(stranger, task.id), []);
        assert.deepEqual(yield* listPublishedAgents(stranger, [task.id]), []);
        assert.deepEqual(yield* readAgent(stranger, agent.id), Option.none());
        assert.deepEqual(
          yield* readAgentOfConversation(stranger, agent.conversationId),
          Option.none(),
        );
        assert.deepEqual(yield* renameAgent(stranger, agent.id, "Taken"), Option.none());
        assert.deepEqual(
          yield* updateAgentChoice(stranger, agent.id, { model: "x/y", effort: "low" }),
          Option.none(),
        );
        assert.deepEqual(yield* createAgent(stranger, start(task.id)), Option.none());
      }),
  );
});

it.layer(getTestDB())("the plan list's agent lines", (it) => {
  it.effect(
    "agents handed a large plan or prompt are listed beside their task and with none, naming their brief, automation, and source, and carrying none of the text they were handed",
    () =>
      Effect.gen(function* () {
        const { userId, taskId } = yield* openTask;
        const snapshotted = started(
          yield* createAgent(
            userId,
            start(taskId, { title: "Invite emails" }, { planSnapshot: LARGE_TEXT, prompt: null }),
          ),
        );
        yield* TestClock.adjust("1 minute");
        const source = { agentId: snapshotted.id, steps: 3, totalSteps: 5, branch: "luke/invite" };
        const continued = started(
          yield* createAgent(
            userId,
            start(taskId, { startedFrom: source }, { planSnapshot: null, prompt: LARGE_TEXT }),
          ),
        );
        yield* TestClock.adjust("1 minute");
        const workspaceId = snapshotted.organizationId;
        const taskless = started(
          yield* createAgent(userId, {
            taskId: null,
            organizationId: workspaceId,
            planSnapshot: null,
            prompt: LARGE_TEXT,
            automationOrigin: {
              name: "Nightly triage",
              firing: { kind: AUTOMATION_FIRING.WEBHOOK, bytes: LARGE_TEXT.length },
              prompt: LARGE_TEXT,
              body: LARGE_TEXT,
            },
            startedFrom: source,
            idempotencyKey: randomUUID(),
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            repository: "reviewstage/luke",
          }),
        );

        const [listed] = yield* withTaskAgents(userId, yield* listTasks(userId));
        assert.deepEqual(
          listed?.agents?.agents.map(({ id, title, model }) => ({ id, title, model })),
          [
            { id: continued.id, title: null, model: continued.model },
            { id: snapshotted.id, title: "Invite emails", model: snapshotted.model },
          ],
        );
        const rows = yield* listTasklessAgents(userId, { includeArchived: false });
        assert.deepEqual(
          rows.map((row) => ({
            id: row.id,
            planId: row.planId,
            brief: row.brief,
            automationId: row.automationId,
            automationName: row.automationName,
            from: row.from,
            workspaceId: row.workspaceId,
            repository: row.repository,
          })),
          [
            {
              id: taskless.id,
              planId: null,
              brief: AGENT_BRIEF.PROMPT,
              automationId: null,
              automationName: "Nightly triage",
              from: source,
              workspaceId,
              repository: "reviewstage/luke",
            },
          ],
        );
        const answered = JSON.stringify([listed, rows]);
        assert.ok(!answered.includes(LARGE_TEXT.slice(0, 40)), "the list carries no text");
      }),
  );
});
