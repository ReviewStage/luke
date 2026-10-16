import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { LiveStatement } from "@luke/database/core/live-statement";
import { Database } from "@luke/database/core/query";
import {
  createAutomation,
  ownFailedRunsLiveStatement,
} from "@luke/database/models/automation-store";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { updateTask } from "@luke/database/models/task-store";
import { organization, user } from "@luke/database/schemas/auth";
import { automation as automationTable } from "@luke/database/schemas/automation";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { inboxItem } from "@luke/database/schemas/inbox";
import { getTestDB, joinWorkspace, openWorkspace, startTask } from "@luke/database/testing";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
} from "@luke/features/automation-wire";
import {
  INBOX_CURSOR_START,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  type InboxPost,
} from "@luke/features/inbox-wire";
import {
  accountInboxLiveRowSchemas,
  accountInboxOfLiveRows,
  inboxOfLiveRows,
  scopeInboxLiveRowsSchema,
} from "@luke/features/live-wire";
import { eq } from "drizzle-orm";
import { Effect, Option, Result, Schema } from "effect";
import { SqlClient } from "effect/sql";
import {
  accountInboxLiveStatements,
  accountInboxTasks,
  accountWaitingItems,
  answerInboxItem,
  closeInboxItem,
  type InboxAgent,
  memberAgentInboxItems,
  memberAgentInboxLiveStatements,
  postInboxItem,
  readInboxItem,
  taskInboxItems,
  taskInboxLiveStatements,
  withdrawInboxAnswer,
} from "../../inbox/inbox-store.js";
import { accountInboxPast } from "./inbox-page.js";

/**
 * The developer's inbox as the store keeps it, through its public functions
 * against a real dialect: a post under a key is one item, a post under the
 * same key writes it again and opens it, a close takes it back, an answer
 * is taken only at the revision it names while the item is open and can be
 * withdrawn under its key, a read keeps every open item however many others
 * changed, every member of the plan's workspace reads and answers the items
 * of an agent any of them started, an agent with no plan posts to its
 * workspace's members as one on a plan does to its plan's, and nothing of
 * a workspace the account is not in is read or written.
 *
 * Synthetic accounts, plans, and words throughout.
 */

const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** An account with one plan and one agent started on it, and the workspace the plan is in. */
const openAgentIn = Effect.gen(function* () {
  const userId = yield* openUser;
  const task = yield* startTask(userId, { name: "Teammate invitations" });
  const started = yield* createCodingAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    repository: "acme/relay",
    planSnapshot: "# Teammate invitations\n",
    prompt: null,
  });
  assert.ok(Option.isSome(started));
  const agent = { userId, taskId: task.id, agentId: started.value.agent.id };
  return { agent, workspaceId: task.workspaceId };
});

const openAgent = Effect.map(openAgentIn, ({ agent }) => agent);

const SETTINGS: InboxPost = {
  key: "branch-protection",
  title: "Require a review on main",
  response: { type: INBOX_RESPONSE.TODO },
  needsReply: false,
};

/** The reply a task takes: done. */
const DONE = { reply: INBOX_REPLY.DONE } as const;

/** A workspace automation of the account's on a plan of the workspace, which its runs start agents beside. */
const openAutomation = (userId: string, workspaceId: string) =>
  Effect.gen(function* () {
    const task = yield* startTask(userId, { name: "Flaky tests" });
    yield* updateTask(userId, task.id, { organizationId: workspaceId });
    const made = yield* createAutomation(userId, {
      taskId: task.id,
      name: "Flaky-test sweep",
      scope: AUTOMATION_SCOPE.WORKSPACE,
      trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * 1-5", timezone: "UTC" },
      action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Fix the flakiest test." },
      guards: AUTOMATION_DEFAULT_GUARDS,
      nextRunAt: new Date("2026-10-15T09:00:00Z"),
      webhookSecretHash: null,
    });
    return Option.getOrThrow(made).id;
  });

/** An account's workspace with one agent started in it on no plan, as an automation's run starts one, by an automation of the account's where asked. */
const openTasklessAgentOf = (byAutomation: boolean) =>
  Effect.gen(function* () {
    const userId = yield* openUser;
    const workspaceId = yield* openWorkspace(userId);
    const automationId = byAutomation ? yield* openAutomation(userId, workspaceId) : undefined;
    const started = yield* createCodingAgent(userId, {
      taskId: null,
      organizationId: workspaceId,
      automationId,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "acme/relay",
      planSnapshot: null,
      prompt: "Sweep the flaky tests.",
    });
    assert.ok(Option.isSome(started));
    const agent: InboxAgent = { userId, taskId: null, agentId: started.value.agent.id };
    return { agent, workspaceId, automationId };
  });

const openTasklessAgent = openTasklessAgentOf(false);

/** A live statement run as Realtime runs it, its SQL and its values as they are, and its rows read back under the schema the desktop decodes them with. */
const runLive = <Row, Encoded>(statement: LiveStatement, schema: Schema.Codec<Row, Encoded>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql.unsafe(statement.sql, [...statement.params]);
    return yield* Schema.decodeUnknownEffect(Schema.Array(schema))(rows);
  });

/** What waits across the account as the desktop builds it from the live rows, at the instant the held read was read. */
const liveAnswerOf = (userId: string, readAt: number) =>
  Effect.gen(function* () {
    const parts = Option.getOrThrow(accountInboxLiveStatements(userId));
    const failedRuns = Option.getOrThrow(ownFailedRunsLiveStatement(userId));
    return accountInboxOfLiveRows(
      {
        items: yield* runLive(parts.items, accountInboxLiveRowSchemas.items),
        planless: yield* runLive(parts.planless, accountInboxLiveRowSchemas.planless),
        plans: yield* runLive(parts.plans, accountInboxLiveRowSchemas.plans),
        automations: yield* runLive(parts.automations, accountInboxLiveRowSchemas.automations),
        failedRuns: yield* runLive(failedRuns, accountInboxLiveRowSchemas.failedRuns),
      },
      readAt,
    );
  });

it.layer(getTestDB())("the inbox store", (it) => {
  it.effect(
    "the live statements of a plan's inbox and an agent's deliver the items their held reads answer, open, answered, and closed alike, to a member and to no one else",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const outsider = yield* openUser;
        yield* openWorkspace(outsider);
        const posted = yield* postInboxItem(agent, SETTINGS);
        assert.ok(Result.isSuccess(posted));
        assert.ok(Result.isSuccess(yield* postInboxItem(agent, { ...SETTINGS, key: "open" })));
        assert.ok(Result.isSuccess(yield* postInboxItem(agent, { ...SETTINGS, key: "closed" })));
        assert.ok(
          Option.isSome(yield* answerInboxItem(teammate, posted.success.id, 1, DONE, randomUUID())),
        );
        assert.ok(Option.isSome(yield* closeInboxItem(agent, "closed", "Not needed after all")));

        for (const reader of [agent.userId, teammate, outsider]) {
          const plan = Option.getOrThrow(taskInboxLiveStatements(reader, agent.taskId ?? ""));
          const ofAgent = Option.getOrThrow(memberAgentInboxLiveStatements(reader, agent.agentId));
          const liveOf = (statements: typeof plan) =>
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              const rows = yield* Effect.all({
                items: sql.unsafe(statements.items.sql, [...statements.items.params]),
              });
              return inboxOfLiveRows(
                yield* Schema.decodeUnknownEffect(scopeInboxLiveRowsSchema)(rows),
              );
            });
          assert.deepEqual(yield* liveOf(plan), yield* taskInboxItems(reader, agent.taskId ?? ""));
          assert.deepEqual(
            yield* liveOf(ofAgent),
            yield* memberAgentInboxItems(reader, agent.agentId),
          );
        }
        const read = yield* taskInboxItems(teammate, agent.taskId ?? "");
        assert.deepEqual(read.map((item) => item.status).toSorted(), [
          INBOX_STATUS.ANSWERED,
          INBOX_STATUS.CLOSED,
          INBOX_STATUS.OPEN,
        ]);
      }),
  );

  it.effect(
    "the live statements of the account's read deliver the rows its held read answers, under the keys the wire reads them by, to every member it answers and to no one else",
    () =>
      Effect.gen(function* () {
        const onPlan = yield* openAgentIn;
        const { agent: taskless, workspaceId } = yield* openTasklessAgentOf(true);
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        yield* joinWorkspace(onPlan.workspaceId, teammate);
        const outsider = yield* openUser;
        yield* openWorkspace(outsider);
        assert.ok(Result.isSuccess(yield* postInboxItem(onPlan.agent, SETTINGS)));
        assert.ok(
          Result.isSuccess(yield* postInboxItem(onPlan.agent, { ...SETTINGS, key: "second" })),
        );
        assert.ok(Result.isSuccess(yield* postInboxItem(taskless, SETTINGS)));

        for (const reader of [onPlan.agent.userId, taskless.userId, teammate, outsider]) {
          const held = yield* accountInboxPast(reader, INBOX_CURSOR_START);
          const live = yield* liveAnswerOf(reader, held.readAt);
          assert.deepEqual(live, { ...held, cursor: "" });
        }
        const read = yield* accountInboxPast(teammate, INBOX_CURSOR_START);
        assert.equal(read.items.length + (read.planless?.length ?? 0), 3);
      }),
  );

  it.effect(
    "the account's read carries an open item of an agent with no plan under its own keys, by its automation and repository, for every member of the workspace and no one else, never among the plans' items, and names a personal automation, by name or id, only to who may read it",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId, automationId } = yield* openTasklessAgentOf(true);
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const outsider = yield* openUser;
        yield* openWorkspace(outsider);
        const posted = yield* postInboxItem(agent, SETTINGS);
        assert.ok(Result.isSuccess(posted));

        const theirs = yield* accountInboxPast(teammate, INBOX_CURSOR_START);
        const others = yield* accountInboxPast(outsider, INBOX_CURSOR_START);

        assert.deepEqual(
          theirs.planless?.map((entry) => [
            entry.id,
            entry.automationId,
            entry.automationName,
            entry.repository,
            entry.workspaceId,
          ]),
          [[posted.success.id, automationId, "Flaky-test sweep", "acme/relay", workspaceId]],
        );
        assert.deepEqual(
          theirs.automations?.map((group) => [group.automationId, group.items]),
          [[automationId, 1]],
        );
        assert.deepEqual(
          theirs.planless?.map((entry) => entry.startedBy),
          [agent.userId],
          "the teammate's read names who started the agent, whom it asks",
        );
        assert.ok(!theirs.items.some((entry) => entry.id === posted.success.id));
        assert.deepEqual([others.planless, others.automations], [[], []]);

        // Made personal, the automation's runs stay the workspace's, and which automation it is its creator's.
        yield* Database.use((db) =>
          db
            .update(automationTable)
            .set({ scope: AUTOMATION_SCOPE.PERSONAL })
            .where(eq(automationTable.id, automationId ?? "")),
        );
        const teammateRead = yield* accountInboxPast(teammate, INBOX_CURSOR_START);
        const creatorRead = yield* accountInboxPast(agent.userId, INBOX_CURSOR_START);
        assert.deepEqual(
          teammateRead.planless?.map((entry) => [
            entry.id,
            entry.automationId,
            entry.automationName,
          ]),
          [[posted.success.id, null, null]],
        );
        assert.deepEqual(
          teammateRead.automations?.map((group) => [group.automationId, group.items]),
          [[null, 1]],
        );
        assert.deepEqual(
          creatorRead.planless?.map((entry) => [entry.automationId, entry.automationName]),
          [[automationId, "Flaky-test sweep"]],
        );
      }),
  );

  it.effect(
    "an agent with no plan posts to its workspace: a member who did not start it reads and answers the item, and an account outside the workspace does neither",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openTasklessAgent;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const outsider = yield* openUser;
        yield* openWorkspace(outsider);

        const posted = yield* postInboxItem(agent, SETTINGS);

        assert.ok(Result.isSuccess(posted));
        const { id } = posted.success;
        assert.ok(Option.isNone(yield* readInboxItem(outsider, id)));
        assert.ok(Option.isNone(yield* answerInboxItem(outsider, id, 1, DONE, randomUUID())));
        assert.equal(
          Option.getOrThrow(yield* readInboxItem(teammate, id)).item.agentId,
          agent.agentId,
        );
        const answered = yield* answerInboxItem(teammate, id, 1, DONE, randomUUID());
        assert.equal(Option.getOrUndefined(answered)?.status, INBOX_STATUS.ANSWERED);
      }),
  );

  it.effect(
    "an answer names the member who gave it, to every member, and an answer withdrawn or an item asked again names nobody",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openTasklessAgent;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const posted = yield* postInboxItem(agent, SETTINGS);
        assert.ok(Result.isSuccess(posted));
        const { id } = posted.success;
        const key = randomUUID();

        const answered = Option.getOrThrow(yield* answerInboxItem(teammate, id, 1, DONE, key));
        assert.deepEqual(answered.answeredBy, { userId: teammate, name: "Test User" });
        for (const reader of [agent.userId, teammate]) {
          assert.equal(
            Option.getOrThrow(yield* readInboxItem(reader, id)).item.answeredBy?.userId,
            teammate,
          );
        }

        const withdrawn = Option.getOrThrow(yield* withdrawInboxAnswer(teammate, id, key));
        assert.equal(withdrawn.answeredBy, undefined);
        yield* answerInboxItem(agent.userId, id, withdrawn.revision, DONE, randomUUID());
        const askedAgain = yield* postInboxItem(agent, SETTINGS);
        assert.ok(Result.isSuccess(askedAgain));
        assert.equal(askedAgain.success.answeredBy, undefined);
      }),
  );

  it.effect(
    "a plan moved to another workspace takes its agents and their items along, so deleting the workspace it left keeps them",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const posted = yield* postInboxItem(agent, SETTINGS);
        assert.ok(Result.isSuccess(posted));
        const destination = yield* openWorkspace(agent.userId);

        yield* updateTask(agent.userId, agent.taskId, { organizationId: destination });
        yield* Database.use((db) =>
          db.delete(organization).where(eq(organization.id, workspaceId)),
        );

        const agents = yield* Database.use((db) =>
          db
            .select({ organizationId: codingAgent.organizationId })
            .from(codingAgent)
            .where(eq(codingAgent.id, agent.agentId)),
        );
        const items = yield* Database.use((db) =>
          db
            .select({ organizationId: inboxItem.organizationId })
            .from(inboxItem)
            .where(eq(inboxItem.id, posted.success.id)),
        );
        assert.deepEqual(agents, [{ organizationId: destination }]);
        assert.deepEqual(items, [{ organizationId: destination }]);
      }),
  );

  it.effect(
    "an agent started on a plan, and the item it posts, belong to the plan's workspace, the agent working in its one repository as the list",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const posted = yield* postInboxItem(agent, SETTINGS);
        assert.ok(Result.isSuccess(posted));

        const [agentRow] = yield* Database.use((db) =>
          db
            .select({
              organizationId: codingAgent.organizationId,
              repositories: codingAgent.repositories,
            })
            .from(codingAgent)
            .where(eq(codingAgent.id, agent.agentId)),
        );
        const [itemRow] = yield* Database.use((db) =>
          db
            .select({ organizationId: inboxItem.organizationId })
            .from(inboxItem)
            .where(eq(inboxItem.id, posted.success.id)),
        );

        assert.deepEqual(agentRow, { organizationId: workspaceId, repositories: ["acme/relay"] });
        assert.deepEqual(itemRow, { organizationId: workspaceId });
      }),
  );

  it.effect(
    "an answer is taken only at the revision it names and only while the item is open, withdrawn only under its own key, and another account's finds nothing",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const other = yield* openUser;
        const posted = yield* postInboxItem(agent, SETTINGS);
        assert.ok(Result.isSuccess(posted));
        const { id } = posted.success;
        const done = { reply: INBOX_REPLY.DONE } as const;
        assert.ok(Option.isNone(yield* answerInboxItem(other, id, 1, done, randomUUID())));
        assert.ok(Option.isNone(yield* answerInboxItem(agent.userId, id, 2, done, randomUUID())));
        const key = randomUUID();
        assert.ok(Option.isSome(yield* answerInboxItem(agent.userId, id, 1, done, key)));
        assert.ok(Option.isNone(yield* withdrawInboxAnswer(agent.userId, id, randomUUID())));
        const reopened = yield* withdrawInboxAnswer(agent.userId, id, key);
        assert.equal(Option.getOrUndefined(reopened)?.status, INBOX_STATUS.OPEN);
        yield* closeInboxItem(agent, SETTINGS.key, "Did it myself.");
        assert.ok(
          Option.isNone(yield* answerInboxItem(agent.userId, id, 2, done, randomUUID())),
          "a closed item takes no answer",
        );
        assert.deepEqual(yield* taskInboxItems(other, agent.taskId), []);
      }),
  );

  it.effect(
    "a member reads and answers the items of an agent a teammate started, and a non-member reads and answers none",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        const stranger = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const posted = yield* postInboxItem(agent, SETTINGS);
        assert.ok(Result.isSuccess(posted));
        const { id } = posted.success;
        const done = { reply: INBOX_REPLY.DONE } as const;

        assert.deepEqual(
          (yield* taskInboxItems(teammate, agent.taskId)).map((each) => each.id),
          [id],
        );
        assert.ok(Option.isSome(yield* readInboxItem(teammate, id)));
        const key = randomUUID();
        assert.equal(
          Option.getOrUndefined(yield* answerInboxItem(teammate, id, 1, done, key))?.status,
          INBOX_STATUS.ANSWERED,
        );
        assert.equal(
          Option.getOrUndefined(yield* withdrawInboxAnswer(teammate, id, key))?.status,
          INBOX_STATUS.OPEN,
        );

        const posted2 = yield* postInboxItem(agent, { ...SETTINGS, key: "still-open" });
        assert.ok(Result.isSuccess(posted2));
        // The first item stands open again since its answer was withdrawn.
        assert.deepEqual(
          (yield* accountWaitingItems(teammate)).map((each) => each.id).sort(),
          [id, posted2.success.id].sort(),
        );
        assert.deepEqual(
          (yield* accountWaitingItems(teammate)).map((each) => each.startedBy),
          [agent.userId, agent.userId],
          "the teammate's read names who started the agent, whom it asks",
        );
        assert.deepEqual(
          (yield* accountInboxTasks(teammate)).map((each) => each.planId),
          [agent.taskId],
        );
        assert.deepEqual(yield* accountWaitingItems(stranger), []);
        assert.deepEqual(yield* accountInboxTasks(stranger), []);

        assert.deepEqual(yield* taskInboxItems(stranger, agent.taskId), []);
        assert.ok(Option.isNone(yield* readInboxItem(stranger, id)));
        assert.ok(Option.isNone(yield* answerInboxItem(stranger, id, 1, done, randomUUID())));
      }),
  );
});
