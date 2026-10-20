import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  archiveCodingAgent,
  type CodingAgent,
  type CodingAgentBriefText,
  type CodingAgentPlace,
  type CodingAgentStarted,
  createCodingAgent,
  dispatchMentioningServers,
  listCodingAgents,
  listPublishedCodingAgents,
  type NewCodingAgent,
  readCodingAgent,
  readCodingAgentOfConversation,
  recordCodingAgentPublished,
  renameCodingAgent,
  takeCodingAgentMentionedServers,
  updateCodingAgentChoice,
} from "@luke/database/models/coding-agent-store";
import { listTasks } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { conversations } from "@luke/database/schemas/storage";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { getTestDB, joinWorkspace, startTask } from "@luke/database/testing";
import { AUTOMATION_FIRING } from "@luke/features/automation-wire";
import {
  CHECK_SUMMARY,
  CODING_AGENT_BRIEF,
  type CodingAgentPullRequest,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
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
const TASK_BRIEF: CodingAgentBriefText = {
  planSnapshot: "# Teammate invitations\n\nAny member may invite by email.\n",
  prompt: null,
};

function start(
  taskId: string,
  overrides: Partial<Omit<NewCodingAgent, keyof CodingAgentPlace>> = {},
  brief: CodingAgentBriefText = TASK_BRIEF,
): NewCodingAgent {
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
function started(answer: Option.Option<CodingAgentStarted>): CodingAgent {
  const start = Option.getOrElse(answer, () => assert.fail("the start answered no agent"));
  assert.equal(start.created, true);
  return start.agent;
}

/** The agent a Start answered and found already made, failing the test where it answered none or made one. */
function found(answer: Option.Option<CodingAgentStarted>): CodingAgent {
  const start = Option.getOrElse(answer, () => assert.fail("the start answered no agent"));
  assert.equal(start.created, false);
  return start.agent;
}

const agentRows = (userId: string) =>
  Effect.map(
    Database.use((db) =>
      db.select({ rows: count() }).from(codingAgent).where(eq(codingAgent.userId, userId)),
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
const PULL_REQUEST: CodingAgentPullRequest = {
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
function listedLine({
  planSnapshot: _planSnapshot,
  prompt,
  automationOrigin,
  ...row
}: CodingAgent) {
  return { ...row, automationName: automationOrigin?.name ?? null, handedPrompt: prompt !== null };
}

it.layer(getTestDB())("the coding agents of an account's plans", (it) => {
  it.effect(
    "the pull request an agent published reads back beside the agents of the plans named, as last recorded, and nothing of another account's is read or written",
    () =>
      Effect.gen(function* () {
        const { userId, taskId } = yield* openTask;
        const other = yield* openTask;
        const agent = started(yield* createCodingAgent(userId, start(taskId)));
        const theirs = started(yield* createCodingAgent(other.userId, start(other.taskId)));

        yield* recordCodingAgentPublished(userId, agent.id, PULL_REQUEST);
        // Another account's write names no agent of theirs, and another account's read names none of this one's.
        yield* recordCodingAgentPublished(userId, theirs.id, PULL_REQUEST);
        assert.deepEqual(yield* listPublishedCodingAgents(userId, [taskId, other.taskId]), [
          { agent: listedLine(agent), published: PULL_REQUEST },
        ]);
        assert.deepEqual(yield* listPublishedCodingAgents(other.userId, [other.taskId]), [
          { agent: listedLine(theirs), published: null },
        ]);

        yield* recordCodingAgentPublished(userId, agent.id, null);
        assert.deepEqual(yield* listPublishedCodingAgents(userId, [taskId]), [
          { agent: listedLine(agent), published: null },
        ]);
      }),
  );

  it.effect("an archived agent is left out of its plan's agents unless asked for", () =>
    Effect.gen(function* () {
      const { userId, taskId } = yield* openTask;
      const agent = started(yield* createCodingAgent(userId, start(taskId)));
      const archived = Option.getOrElse(yield* archiveCodingAgent(userId, agent.id, true), () =>
        assert.fail("the agent is archived"),
      );

      assert.deepEqual(yield* listPublishedCodingAgents(userId, [taskId]), []);
      assert.deepEqual(
        yield* listPublishedCodingAgents(userId, [taskId], { includeArchived: true }),
        [{ agent: listedLine(archived), published: null }],
      );
    }),
  );

  it.effect("a plan's listed pull request names the agent that opened it, whose tab it opens", () =>
    Effect.gen(function* () {
      const { userId, taskId } = yield* openTask;
      const agent = started(yield* createCodingAgent(userId, start(taskId)));
      yield* recordCodingAgentPublished(userId, agent.id, PULL_REQUEST);

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
        const agent = started(yield* createCodingAgent(userId, start(taskId)));
        yield* archiveCodingAgent(userId, agent.id, true);

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
          yield* createCodingAgent(
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
        const theirs = yield* takeCodingAgentMentionedServers(other.userId, agent.conversationId);
        const first = yield* takeCodingAgentMentionedServers(userId, agent.conversationId);
        const again = yield* takeCodingAgentMentionedServers(userId, agent.conversationId);

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

      const agent = started(yield* createCodingAgent(userId, asked));

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
      assert.deepEqual(yield* readCodingAgent(userId, agent.id), Option.some(agent));
    }),
  );

  it.effect("a plan another account owns starts nothing and reads as no agents", () =>
    Effect.gen(function* () {
      const { userId, taskId } = yield* openTask;
      const other = yield* openUser;
      const agent = started(yield* createCodingAgent(userId, start(taskId)));

      assert.deepEqual(yield* createCodingAgent(other, start(taskId)), Option.none());
      assert.equal(yield* agentRows(other), 0);
      assert.deepEqual(yield* listCodingAgents(other, taskId), []);
      assert.deepEqual(yield* readCodingAgent(other, agent.id), Option.none());
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
        const agent = started(yield* createCodingAgent(starter, asked));
        assert.equal(agent.userId, starter);

        assert.deepEqual(yield* listCodingAgents(teammate, task.id), [agent]);
        assert.deepEqual(yield* listPublishedCodingAgents(teammate, [task.id]), [
          { agent: listedLine(agent), published: null },
        ]);
        assert.deepEqual(yield* readCodingAgent(teammate, agent.id), Option.some(agent));
        assert.deepEqual(
          yield* readCodingAgentOfConversation(teammate, agent.conversationId),
          Option.some(agent),
        );
        const renamed = yield* renameCodingAgent(teammate, agent.id, "Invite emails");
        assert.equal(Option.getOrUndefined(renamed)?.title, "Invite emails");
        const chosen = yield* updateCodingAgentChoice(teammate, agent.id, {
          model: "openai/gpt-5.5",
          effort: "low",
        });
        assert.equal(Option.getOrUndefined(chosen)?.model, "openai/gpt-5.5");
        assert.equal(
          Option.getOrUndefined(yield* readCodingAgent(starter, agent.id))?.title,
          "Invite emails",
        );

        // The teammate's Start under the starter's key is a Start of their own, and the starter's retry still finds theirs.
        const theirs = started(
          yield* createCodingAgent(
            teammate,
            start(task.id, { idempotencyKey: asked.idempotencyKey }),
          ),
        );
        assert.notEqual(theirs.id, agent.id);
        assert.equal(theirs.userId, teammate);
        assert.equal(found(yield* createCodingAgent(starter, asked)).id, agent.id);

        assert.deepEqual(yield* listCodingAgents(stranger, task.id), []);
        assert.deepEqual(yield* listPublishedCodingAgents(stranger, [task.id]), []);
        assert.deepEqual(yield* readCodingAgent(stranger, agent.id), Option.none());
        assert.deepEqual(
          yield* readCodingAgentOfConversation(stranger, agent.conversationId),
          Option.none(),
        );
        assert.deepEqual(yield* renameCodingAgent(stranger, agent.id, "Taken"), Option.none());
        assert.deepEqual(
          yield* updateCodingAgentChoice(stranger, agent.id, { model: "x/y", effort: "low" }),
          Option.none(),
        );
        assert.deepEqual(yield* createCodingAgent(stranger, start(task.id)), Option.none());
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
          yield* createCodingAgent(
            userId,
            start(taskId, { title: "Invite emails" }, { planSnapshot: LARGE_TEXT, prompt: null }),
          ),
        );
        yield* TestClock.adjust("1 minute");
        const source = { agentId: snapshotted.id, steps: 3, totalSteps: 5, branch: "luke/invite" };
        const continued = started(
          yield* createCodingAgent(
            userId,
            start(taskId, { startedFrom: source }, { planSnapshot: null, prompt: LARGE_TEXT }),
          ),
        );
        yield* TestClock.adjust("1 minute");
        const workspaceId = snapshotted.organizationId;
        const taskless = started(
          yield* createCodingAgent(userId, {
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
              brief: CODING_AGENT_BRIEF.PROMPT,
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
