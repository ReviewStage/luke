import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { LiveStatement } from "@repo/database/core/live-statement";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import {
  createAutomation,
  ownFailedRunsLiveStatement,
  recordAutomationRun,
  settleAutomationRun,
} from "@repo/database/models/automation-store";
import { updateTask } from "@repo/database/models/task-store";
import { agentTable } from "@repo/database/schemas/agent";
import { organization, user } from "@repo/database/schemas/auth";
import { automationRun, automation as automationTable } from "@repo/database/schemas/automation";
import { inboxItem } from "@repo/database/schemas/inbox";
import { inboxItemRead } from "@repo/database/schemas/inbox-item-read";
import { task as taskTable } from "@repo/database/schemas/task";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, joinWorkspace, openWorkspace, startTask } from "@repo/database/testing";
import type { AccountInboxTask } from "@repo/features/account-inbox-wire";
import { AGENT_ATTACHMENT_TYPE, type AgentAttachment } from "@repo/features/agent-wire";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_RUN_REASON,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
} from "@repo/features/automation-wire";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_CURSOR_START,
  INBOX_IMAGE_TYPE,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_STATUS,
  type InboxItem,
  type InboxMessage,
} from "@repo/features/inbox-wire";
import {
  accountInboxItemsLiveRowsSchema,
  accountInboxLiveRowSchemas,
  accountInboxOfLiveRows,
  FAILED_RUN_WINDOW_MILLIS,
  inboxOfLiveRows,
  scopeInboxLiveRowsSchema,
} from "@repo/features/live-wire";
import { TASK_STATUS } from "@repo/features/task-wire";
import { eq } from "drizzle-orm";
import { Clock, DateTime, Duration, Effect, Option, Result, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import {
  accountInboxLiveStatements,
  accountInboxTasks,
  accountItemsLiveStatements,
  accountWaitingItems,
  accountWaitingStamps,
  acknowledgeInboxItem,
  agentInboxItems,
  answerInboxAsk,
  closeInboxItem,
  closeInboxItemAsMember,
  INBOX_ASK_ANSWER,
  INBOX_MESSAGE_OUTCOME,
  INBOX_POST_REFUSAL,
  type InboxAgent,
  type InboxFile,
  type InboxItemWritten,
  markInboxItemRead,
  markInboxItemUnread,
  markInboxRead,
  memberAgentInboxItems,
  memberAgentInboxLiveStatements,
  postInboxMessage,
  postInboxThread,
  readInboxAttachment,
  readInboxItem,
  replyInboxItem,
  snoozeInboxItem,
  taskInboxItems,
  taskInboxLiveStatements,
  withdrawInboxAnswer,
  withdrawInboxClose,
  withdrawInboxMessage,
} from "../../inbox/inbox-store.js";
import { wokenOnHub } from "../../testing/sync-woken.js";
import { accountInboxPast, agentInboxPast, taskInboxPast } from "./inbox-page.js";

/**
 * The developer's inbox as the store keeps it, through its public functions
 * against a real dialect: a post under a key is one item, a post under the
 * same key writes it again and opens it, a close takes it back, an answer
 * is taken only at the revision it names while the item is open and can be
 * withdrawn under its key, a read keeps every open item however many others
 * changed, every member of the task's workspace reads and answers the items
 * of an agent any of them started, an agent with no task posts to its
 * workspace's members as one on a task does to its task's, a member writes
 * on an item's thread whatever its status, which moves the item's last
 * change and nothing else of it, and nothing of a workspace the account is
 * not in is read or written. Over the sync hub, a task's, an agent's, and the account's held reads
 * each answer an agent's post within a coalesce window.
 *
 * Synthetic accounts, tasks, and words throughout.
 */

const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
  return userId;
});

/** An account with one task and one agent started on it, and the workspace the task is in. */
const openAgentIn = Effect.gen(function* () {
  const userId = yield* openUser;
  const task = yield* startTask(userId, { name: "Teammate invitations" });
  const started = yield* createAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    repository: "acme/relay",
    planSnapshot: "# Teammate invitations\n",
    prompt: null,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  });
  assert.ok(Option.isSome(started));
  const agent = { userId, taskId: task.id, agentId: started.value.agent.id };
  return { agent, workspaceId: task.workspaceId };
});

const openAgent = Effect.map(openAgentIn, ({ agent }) => agent);

/** A post as the agent's tool hands one to the store. */
type InboxThreadPost = Parameters<typeof postInboxThread>[1];

/** A post that asks the developer to do something by hand, and waits on no word back. */
const SETTINGS = {
  key: "branch-protection",
  title: "Require a review on main",
  body: "Turn on a required review for `main` in the repository's settings.",
  ask: { type: INBOX_ASK.DO, steps: [] },
  needsReply: false,
} as const satisfies InboxThreadPost;

/** A post that asks nothing: a notice, which waits on the developer's nod alone. */
const NOTICE = {
  key: "heads-up",
  title: "Main is protected now",
  body: "Pushes to `main` need a review from here on.",
} as const satisfies InboxThreadPost;

/** The agent's post written, the item it stands as. */
const post = (agent: InboxAgent, write: InboxThreadPost = SETTINGS) =>
  Effect.map(postInboxThread(agent, write), Result.getOrThrow);

/** The message whose ask the item holds open, by id; none where it holds none open. */
const openAskOf = (item: Pick<InboxItem, "thread">) =>
  item.thread?.find((message) => message.ask?.status === INBOX_ASK_STATUS.OPEN)?.id ?? "";

/**
 * A member's Done on the ask the item, as it was last shown to them, holds
 * open, under the key given: the item as the answer leaves it, with the
 * transaction it was taken in; nothing where the answer was not taken.
 */
const answerDone = (
  userId: string,
  item: Pick<InboxItem, "id" | "thread">,
  clientKey: string = randomUUID(),
  files?: readonly AgentAttachment[],
) =>
  Effect.map(
    answerInboxAsk(userId, item.id, {
      answers: { ask: openAskOf(item), reply: INBOX_REPLY.DONE },
      text: "",
      clientKey,
      files,
    }),
    Option.flatMap(({ item: answered, outcome, txid }) =>
      outcome === INBOX_ASK_ANSWER.TAKEN
        ? Option.some<InboxItemWritten>(txid === undefined ? answered : { ...answered, txid })
        : Option.none(),
    ),
  );

/** The member's messages on an item's thread, oldest first: the agent's left out. */
const memberMessages = (item: Pick<InboxItem, "thread">) =>
  (item.thread ?? []).filter((message) => message.author === INBOX_MESSAGE_AUTHOR.MEMBER);

/** Messages as a reader who wrote none of them is handed them: none carrying the key it was sent under. */
const unkeyed = (messages: readonly InboxMessage[] | undefined) =>
  messages?.map(({ clientKey: _clientKey, ...message }) => message);

/** The member's message on an item's thread that carries an answer. */
const answeringOf = (item: Pick<InboxItem, "thread">) =>
  item.thread?.find((message) => message.answers !== undefined);

/** A file as an answer carries it: its name, its type, and its bytes in base64. */
const attached = (
  name: string,
  mediaType: AgentAttachment["mediaType"],
  bytes: Uint8Array,
): AgentAttachment => ({ name, mediaType, data: Buffer.from(bytes).toString("base64") });

const TRACE = new TextEncoder().encode("TypeError: invite is undefined\n");
const SHOT = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** A workspace automation of the account's on a task of the workspace, which its runs start agents beside. */
const openAutomation = (userId: string, workspaceId: string) =>
  Effect.gen(function* () {
    const task = yield* startTask(userId, { name: "Flaky tests" });
    yield* updateTask(userId, task.id, { organizationId: workspaceId });
    const made = yield* createAutomation(userId, {
      organizationId: task.workspaceId,
      repositories: task.repository === null ? [] : [task.repository],
      name: "Flaky-test sweep",
      scope: AUTOMATION_SCOPE.WORKSPACE,
      trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * 1-5", timezone: "UTC" },
      action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Fix the flakiest test." },
      guards: AUTOMATION_DEFAULT_GUARDS,
      nextRunAt: new Date("2026-10-15T09:00:00Z"),
      webhookSecretHash: null,
    });
    return Option.getOrThrow(made).id;
  });

/** An account's workspace with one agent started in it on no task, as an automation's run starts one, by an automation of the account's where asked. */
const openTasklessAgentOf = (byAutomation: boolean) =>
  Effect.gen(function* () {
    const userId = yield* openUser;
    const workspaceId = yield* openWorkspace(userId);
    const automationId = byAutomation ? yield* openAutomation(userId, workspaceId) : undefined;
    const started = yield* createAgent(userId, {
      taskId: null,
      organizationId: workspaceId,
      automationId,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "acme/relay",
      planSnapshot: null,
      prompt: "Sweep the flaky tests.",
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
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
    const parts = Option.getOrThrow(accountInboxLiveStatements(userId, true));
    const failedRuns = Option.getOrThrow(ownFailedRunsLiveStatement(userId));
    return accountInboxOfLiveRows(
      {
        items: yield* runLive(parts.items, accountInboxLiveRowSchemas.items),
        planless: yield* runLive(parts.planless, accountInboxLiveRowSchemas.planless),
        plans: yield* runLive(parts.plans, accountInboxLiveRowSchemas.plans),
        automations: yield* runLive(parts.automations, accountInboxLiveRowSchemas.automations),
        agents: yield* runLive(parts.agents, accountInboxLiveRowSchemas.agents),
        failedRuns: yield* runLive(failedRuns, accountInboxLiveRowSchemas.failedRuns),
      },
      readAt,
    );
  });

/** The ids the account's items read carries as the desktop decodes its rows: those it stamps, and those it carries whole, read since the instants given. */
const accountItemIdsOf = (userId: string, since: number, settledSince: number) =>
  Effect.gen(function* () {
    const parts = Option.getOrThrow(
      accountItemsLiveStatements(userId, new Date(since), new Date(settledSince)),
    );
    const sql = yield* SqlClient.SqlClient;
    const rowsOf = (statement: LiveStatement) => sql.unsafe(statement.sql, [...statement.params]);
    const rows = yield* Schema.decodeUnknownEffect(accountInboxItemsLiveRowsSchema)(
      yield* Effect.all({
        stamps: rowsOf(parts.stamps),
        items: rowsOf(parts.items),
        messages: rowsOf(parts.messages),
        files: rowsOf(parts.files),
      }),
    );
    return {
      stamps: rows.stamps.map((stamp) => stamp.id).toSorted(),
      items: inboxOfLiveRows(rows)
        .map((item) => item.id)
        .toSorted(),
    };
  });

it.layer(getTestDB())("the inbox store", (it) => {
  it.effect(
    "the account's items read a teammate's item on a shared task and an agent's with no task in a shared workspace, and none of another workspace",
    () =>
      Effect.gen(function* () {
        const shared = yield* openAgentIn;
        const { agent: taskless, workspaceId } = yield* openTasklessAgent;
        const teammate = yield* openUser;
        yield* joinWorkspace(shared.workspaceId, teammate);
        yield* joinWorkspace(workspaceId, teammate);
        const outsider = yield* openAgentIn;
        const onTask = yield* post(shared.agent);
        const ofTaskless = yield* post(taskless);
        const elsewhere = yield* post(outsider.agent);

        const both = [onTask.id, ofTaskless.id].toSorted();
        assert.deepEqual(yield* accountItemIdsOf(teammate, 0, 0), { stamps: both, items: both });
        assert.deepEqual(yield* accountItemIdsOf(outsider.agent.userId, 0, 0), {
          stamps: [elsewhere.id],
          items: [elsewhere.id],
        });
      }),
  );

  it.effect(
    "the account's items stamp every open item, the settled ones of the last week, an old notice nodded to this week among them, and those the reader snoozed, and carry whole only those changed since the reader's instant",
    () =>
      Effect.gen(function* () {
        const { agent } = yield* openAgentIn;
        yield* post(agent, { ...SETTINGS, key: "stale" });
        assert.ok(Option.isSome(yield* closeInboxItem(agent, "stale", "Not needed after all")));
        const snoozed = yield* post(agent, { ...SETTINGS, key: "snoozed" });
        assert.ok(Option.isSome(yield* closeInboxItem(agent, "snoozed", "Done another way")));
        // The snooze is weighed on the database's clock, so it stands come due by the read.
        yield* snoozeInboxItem(agent.userId, snoozed.id, new Date("2001-01-01T09:00:00Z"));
        const waiting = yield* post(agent, { ...SETTINGS, key: "waiting" });
        const notice = yield* post(agent, { key: "merged", title: "Merged", body: "On main." });
        yield* TestClock.adjust(Duration.days(8));
        assert.ok(
          Option.isSome(
            yield* acknowledgeInboxItem(agent.userId, notice.id, notice.revision, randomUUID()),
          ),
        );
        const lately = yield* post(agent, { ...SETTINGS, key: "lately" });
        assert.ok(Option.isSome(yield* closeInboxItem(agent, "lately", "Done another way")));
        const fresh = yield* post(agent, { ...SETTINGS, key: "fresh" });
        const now = yield* Clock.currentTimeMillis;

        assert.deepEqual(
          yield* accountItemIdsOf(agent.userId, now, now - Duration.toMillis(Duration.days(7))),
          {
            stamps: [snoozed.id, waiting.id, notice.id, lately.id, fresh.id].toSorted(),
            items: [lately.id, fresh.id].toSorted(),
          },
        );
      }),
  );

  it.effect(
    "the live statements of a plan's inbox and an agent's deliver the items their held reads answer, open, answered, and closed alike, to a member and to no one else",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const outsider = yield* openUser;
        yield* openWorkspace(outsider);
        const posted = yield* post(agent);
        const open = yield* post(agent, { ...SETTINGS, key: "open" });
        yield* post(agent, { ...SETTINGS, key: "closed" });
        assert.ok(
          Option.isSome(
            yield* answerDone(teammate, posted, randomUUID(), [
              attached("first.txt", "text/plain", TRACE),
              attached("second.txt", "text/plain", TRACE),
            ]),
          ),
        );
        assert.ok(Option.isSome(yield* closeInboxItem(agent, "closed", "Not needed after all")));
        // The teammate's message on the open item, with a file, leaves it read for them and unread for its starter.
        yield* TestClock.adjust(Duration.seconds(1));
        assert.ok(
          Option.isSome(
            yield* postInboxMessage(teammate, open.id, {
              text: "Here is the trace.",
              clientKey: randomUUID(),
              files: [attached("trace.txt", "text/plain", TRACE)],
            }),
          ),
        );

        for (const reader of [agent.userId, teammate, outsider]) {
          const plan = Option.getOrThrow(taskInboxLiveStatements(reader, agent.taskId ?? ""));
          const ofAgent = Option.getOrThrow(memberAgentInboxLiveStatements(reader, agent.agentId));
          const liveOf = (statements: typeof plan) =>
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              const rows = yield* Effect.all({
                items: sql.unsafe(statements.items.sql, [...statements.items.params]),
                messages: sql.unsafe(statements.messages.sql, [...statements.messages.params]),
                files: sql.unsafe(statements.files.sql, [...statements.files.params]),
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
        const openOf = (items: typeof read) => items.find((item) => item.id === open.id);
        assert.equal(openOf(read)?.unread, false, "the teammate wrote on it last");
        assert.equal(openOf(yield* taskInboxItems(agent.userId, agent.taskId ?? ""))?.unread, true);
        assert.deepEqual(
          openOf(read)?.thread?.map((message) => [message.text, message.files?.length]),
          [
            [SETTINGS.body, undefined],
            ["Here is the trace.", 1],
          ],
        );
        const answered = read.find((item) => item.id === posted.id);
        assert.deepEqual(answered && answeringOf(answered)?.files?.map((file) => file.name), [
          "first.txt",
          "second.txt",
        ]);
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
        const onTask = yield* openAgentIn;
        const { agent: taskless, workspaceId } = yield* openTasklessAgentOf(true);
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        yield* joinWorkspace(onTask.workspaceId, teammate);
        const outsider = yield* openUser;
        yield* openWorkspace(outsider);
        const first = yield* post(onTask.agent);
        yield* post(onTask.agent, { ...SETTINGS, key: "second" });
        yield* post(taskless);
        // Read by the agent's starter and not by the teammate, so the two read it apart.
        assert.ok(yield* markInboxItemRead(onTask.agent.userId, first.id));
        // A second task of the starter's, settled, whose agent asks on it after, which the Inbox lists like any other.
        const shelved = yield* startTask(onTask.agent.userId, { name: "Billing export" });
        const shelvedAgent = yield* createAgent(onTask.agent.userId, {
          taskId: shelved.id,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: "acme/relay",
          planSnapshot: "# Billing export\n",
          prompt: null,
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
        });
        assert.ok(Option.isSome(shelvedAgent));
        yield* updateTask(onTask.agent.userId, shelved.id, { status: TASK_STATUS.DONE });
        yield* post({
          userId: onTask.agent.userId,
          taskId: shelved.id,
          agentId: shelvedAgent.value.agent.id,
        });

        const owner = onTask.agent.userId;
        for (const reader of [owner, taskless.userId, teammate, outsider]) {
          const held = yield* accountInboxPast(reader, INBOX_CURSOR_START);
          const live = yield* liveAnswerOf(reader, held.readAt);
          // Each read keeps a cursor of its own, which the other never reads.
          assert.deepEqual({ ...live, cursor: held.cursor }, held);
        }
        const shelvedRead = yield* liveAnswerOf(onTask.agent.userId, 0);
        assert.ok(
          shelvedRead.plans.some((plan) => plan.planId === shelved.id),
          "the settled task is listed",
        );
        assert.ok(
          shelvedRead.items.some((item) => item.planId === shelved.id),
          "its item waits like any other",
        );
        const read = yield* accountInboxPast(teammate, INBOX_CURSOR_START);
        assert.equal(read.items.length + (read.planless?.length ?? 0), 4);
        const unreadOf = (answer: typeof read) =>
          answer.items.find((item) => item.id === first.id)?.unread;
        assert.equal(unreadOf(read), true, "the teammate has not read it");
        assert.equal(unreadOf(yield* accountInboxPast(owner, INBOX_CURSOR_START)), false);
      }),
  );

  it.effect(
    "the live statements of the account's read keep level with its held read through threads with asks, an ask answered or closed, a notice, a member's message, and failed runs in and out of the last week",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse("2026-10-21T12:00:00Z"));
        const { agent, workspaceId } = yield* openAgentIn;
        const owner = agent.userId;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const decide = { type: INBOX_ASK.DECIDE, options: [{ label: "iad1" }, { label: "sfo1" }] };
        const thread = (key: string, ask?: typeof decide) =>
          Effect.map(
            postInboxThread(agent, {
              key,
              title: `About ${key}`,
              body: "Two regions are free.",
              ask,
            }),
            Result.getOrThrow,
          );
        const asking = yield* thread("deploy-region", decide);
        const notice = yield* thread("heads-up");
        const answered = yield* thread("preview-region", decide);
        const closed = yield* thread("staging-region", decide);
        const askOf = (item: typeof answered) => item.thread?.[0]?.id ?? "";
        assert.ok(
          Option.isSome(
            yield* answerInboxAsk(teammate, answered.id, {
              answers: { ask: askOf(answered), reply: INBOX_REPLY.CHOSE, choices: ["sfo1"] },
              text: "Closer to the team.",
              clientKey: randomUUID(),
            }),
          ),
        );
        assert.ok(
          Option.isSome(
            yield* closeInboxItemAsMember(owner, closed.id, closed.revision, randomUUID()),
          ),
        );
        yield* postInboxMessage(teammate, asking.id, {
          text: "Which is cheaper?",
          clientKey: randomUUID(),
        });
        // The agent writes on the thread again, asking nothing, under the asking item's key.
        yield* thread("deploy-region");

        // A run of each of two of the owner's automations failed: one now, one past the last week.
        const failedRun = (name: string) =>
          Effect.gen(function* () {
            const made = Option.getOrThrow(
              yield* createAutomation(owner, {
                organizationId: workspaceId,
                repositories: ["acme/relay"],
                name,
                trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
                action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Fix one flaky test." },
                guards: AUTOMATION_DEFAULT_GUARDS,
                nextRunAt: null,
                webhookSecretHash: null,
              }),
            );
            const run = Option.getOrThrow(
              yield* recordAutomationRun(made, {
                dedupeKey: randomUUID(),
                firing: { kind: AUTOMATION_FIRING.MANUAL },
                firedAt: yield* DateTime.nowAsDate,
              }),
            );
            yield* settleAutomationRun(run.id, {
              status: AUTOMATION_RUN_STATUS.FAILED,
              reason: AUTOMATION_RUN_REASON.REPOSITORY_UNREACHABLE,
            });
            return run.id;
          });
        const recent = yield* failedRun("Nightly flaky-test sweep");
        const old = yield* failedRun("Weekly dependency bump");
        const now = yield* DateTime.nowAsDate;
        yield* Database.use((db) =>
          db
            .update(automationRun)
            .set({ settledAt: new Date(now.getTime() - FAILED_RUN_WINDOW_MILLIS - 60_000) })
            .where(eq(automationRun.id, old)),
        );

        for (const reader of [owner, teammate]) {
          const held = yield* accountInboxPast(reader, INBOX_CURSOR_START);
          const live = yield* liveAnswerOf(reader, held.readAt);
          assert.deepEqual({ ...live, cursor: held.cursor }, held);
          assert.notEqual(live.cursor, "", "the live cursor is a digest");
        }
        const read = yield* accountInboxPast(owner, INBOX_CURSOR_START);
        assert.deepEqual(
          read.items.map((item) => item.id).toSorted(),
          [asking.id, notice.id].toSorted(),
          "the asking item and the notice wait; the answered and the closed do not",
        );
        assert.deepEqual(
          read.plans.map((plan) => plan.items),
          [4],
          "the task holds all four",
        );
        assert.deepEqual(
          read.failedRuns?.map((run) => run.id),
          [recent],
          "the run past the last week is carried by neither",
        );
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
        const posted = yield* post(agent);

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
          [[posted.id, automationId, "Flaky-test sweep", "acme/relay", workspaceId]],
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
        assert.ok(!theirs.items.some((entry) => entry.id === posted.id));
        assert.deepEqual([others.planless, others.automations, others.agents], [[], [], []]);

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
          [[posted.id, null, null]],
        );
        assert.deepEqual(
          teammateRead.automations?.map((group) => [group.automationId, group.items]),
          [[null, 1]],
        );
        assert.deepEqual(
          creatorRead.planless?.map((entry) => [entry.automationId, entry.automationName]),
          [[automationId, "Flaky-test sweep"]],
        );

        // Settled, the item waits no longer, and its agent is still listed as holding it, named as its open item was, to every member who may read it.
        assert.ok(Option.isSome(yield* answerDone(agent.userId, posted)));
        const settled = yield* accountInboxPast(teammate, INBOX_CURSOR_START);
        assert.deepEqual(settled.planless, []);
        assert.deepEqual(
          settled.agents?.map((held) => [
            held.agentId,
            held.items,
            held.toDo,
            held.automationName,
            held.repository,
            held.workspaceId,
          ]),
          [[agent.agentId, 1, 0, null, "acme/relay", workspaceId]],
        );
        assert.deepEqual((yield* accountInboxPast(outsider, INBOX_CURSOR_START)).agents, []);
        const live = yield* liveAnswerOf(teammate, settled.readAt);
        assert.deepEqual({ ...live, cursor: settled.cursor }, settled);
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

        const posted = yield* post(agent);

        const { id } = posted;
        assert.ok(Option.isNone(yield* readInboxItem(outsider, id)));
        assert.ok(Option.isNone(yield* answerDone(outsider, posted)));
        assert.equal(
          Option.getOrThrow(yield* readInboxItem(teammate, id)).item.agentId,
          agent.agentId,
        );
        const answered = yield* answerDone(teammate, posted);
        assert.equal(Option.getOrUndefined(answered)?.status, INBOX_STATUS.ANSWERED);
      }),
  );

  it.effect(
    "an item names the member whose agent asks it and an answer the member who gave it, to every member, and an answer withdrawn or an item asked again names nobody",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openTasklessAgent;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const posted = yield* post(agent);
        const { id } = posted;
        const key = randomUUID();

        const answered = Option.getOrThrow(yield* answerDone(teammate, posted, key));
        assert.deepEqual(answered.answeredBy, { userId: teammate, name: "Test User" });
        assert.equal(answered.startedBy?.userId, agent.userId, "the item names whose agent asks");
        for (const reader of [agent.userId, teammate]) {
          const read = Option.getOrThrow(yield* readInboxItem(reader, id)).item;
          assert.equal(read.answeredBy?.userId, teammate);
          assert.equal(read.startedBy?.userId, agent.userId);
        }

        const withdrawn = Option.getOrThrow(yield* withdrawInboxAnswer(teammate, id, key));
        assert.equal(withdrawn.answeredBy, undefined);
        assert.ok(Option.isSome(yield* answerDone(agent.userId, withdrawn)));
        const askedAgain = yield* post(agent);
        assert.equal(askedAgain.answeredBy, undefined);
      }),
  );

  it.effect(
    "an answer's files are kept on the message that carries it in the order attached, named by name and type, and served as their bytes to every member and nobody else; an answer not taken keeps none",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        const outsider = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const posted = yield* post(agent);
        const { id } = posted;
        const files = [
          attached("trace.txt", AGENT_ATTACHMENT_TYPE.TEXT, TRACE),
          attached("after.png", AGENT_ATTACHMENT_TYPE.PNG, SHOT),
        ];

        const elsewhere = { ...posted, thread: [] };
        assert.ok(Option.isNone(yield* answerDone(teammate, elsewhere, randomUUID(), files)));
        assert.equal(
          answeringOf(Option.getOrThrow(yield* readInboxItem(teammate, id)).item),
          undefined,
        );

        const answered = Option.getOrThrow(
          yield* answerDone(teammate, posted, randomUUID(), files),
        );
        const kept = answeringOf(answered)?.files;
        assert.deepEqual(
          kept?.map((file) => [file.name, file.mediaType]),
          [
            ["trace.txt", AGENT_ATTACHMENT_TYPE.TEXT],
            ["after.png", AGENT_ATTACHMENT_TYPE.PNG],
          ],
        );
        const [trace, shot] = kept ?? [];
        assert.ok(trace && shot);
        for (const reader of [agent.userId, teammate]) {
          const read = Option.getOrThrow(yield* readInboxItem(reader, id)).item;
          assert.deepEqual(answeringOf(read)?.files, kept);
          const found = yield* readInboxAttachment(reader, id, trace.attachmentId);
          const served: InboxFile = Option.getOrThrow(found);
          assert.equal(served.contentType, AGENT_ATTACHMENT_TYPE.TEXT);
          assert.deepEqual(new Uint8Array(served.bytes), TRACE);
        }
        assert.ok(Option.isNone(yield* readInboxAttachment(outsider, id, shot.attachmentId)));
      }),
  );

  it.effect(
    "an answer's file is held to a message's bound for its type rather than a picture's",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const posted = yield* post(agent);
        // Past the picture bound, inside a PDF's.
        const spec = new Uint8Array(2_000_000).fill(0x25);
        const answered = yield* answerDone(agent.userId, posted, randomUUID(), [
          attached("spec.pdf", AGENT_ATTACHMENT_TYPE.PDF, spec),
        ]);
        const [file] = answeringOf(Option.getOrThrow(answered))?.files ?? [];
        assert.ok(file);
        const served = yield* readInboxAttachment(agent.userId, posted.id, file.attachmentId);
        assert.equal(Option.getOrThrow(served).bytes.byteLength, spec.byteLength);
      }),
  );

  it.effect(
    "an answer taken back deletes the message that carried it with its files and keeps the agent's pictures, and a post that opens the item again leaves the message that answered with its files on the thread",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const posted = yield* Effect.map(
          postInboxThread(
            agent,
            { ...SETTINGS, body: "Like this:\n\n![The branch rule](shots/rule.png)" },
            [
              {
                path: "shots/rule.png",
                name: "rule.png",
                contentType: INBOX_IMAGE_TYPE.PNG,
                bytes: SHOT,
              },
            ],
          ),
          Result.getOrThrow,
        );
        const { id } = posted;
        const picture = posted.thread?.[0]?.files?.[0];
        assert.ok(picture);
        const files = [attached("trace.txt", AGENT_ATTACHMENT_TYPE.TEXT, TRACE)];
        const fileOf = (item: Pick<InboxItem, "thread">) =>
          answeringOf(item)?.files?.[0]?.attachmentId ?? "";

        const key = randomUUID();
        const first = Option.getOrThrow(yield* answerDone(agent.userId, posted, key, files));
        const withdrawn = Option.getOrThrow(yield* withdrawInboxAnswer(agent.userId, id, key));
        assert.equal(answeringOf(withdrawn), undefined);
        assert.ok(Option.isNone(yield* readInboxAttachment(agent.userId, id, fileOf(first))));
        assert.ok(
          Option.isSome(yield* readInboxAttachment(agent.userId, id, picture.attachmentId)),
          "taking an answer back keeps the agent's picture",
        );

        const second = Option.getOrThrow(
          yield* answerDone(agent.userId, withdrawn, randomUUID(), files),
        );
        const askedAgain = yield* post(agent);
        assert.equal(askedAgain.status, INBOX_STATUS.OPEN);
        assert.deepEqual(
          answeringOf(askedAgain)?.files?.map((file) => file.attachmentId),
          [fileOf(second)],
          "the message that answered keeps its files on the thread",
        );
        assert.ok(Option.isSome(yield* readInboxAttachment(agent.userId, id, fileOf(second))));
      }),
  );

  it.effect(
    "a plan moved to another workspace takes its agents and their items along, so deleting the workspace it left keeps them",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const posted = yield* post(agent);
        const destination = yield* openWorkspace(agent.userId);

        yield* updateTask(agent.userId, agent.taskId, { organizationId: destination });
        yield* Database.use((db) =>
          db.delete(organization).where(eq(organization.id, workspaceId)),
        );

        const agents = yield* Database.use((db) =>
          db
            .select({ organizationId: agentTable.organizationId })
            .from(agentTable)
            .where(eq(agentTable.id, agent.agentId)),
        );
        const items = yield* Database.use((db) =>
          db
            .select({ organizationId: inboxItem.organizationId })
            .from(inboxItem)
            .where(eq(inboxItem.id, posted.id)),
        );
        assert.deepEqual(agents, [{ organizationId: destination }]);
        assert.deepEqual(items, [{ organizationId: destination }]);
      }),
  );

  it.effect(
    "an agent started on a plan, and the item it posts, belong to the plan's workspace, the agent working in its one repository",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const posted = yield* post(agent);

        const [agentRow] = yield* Database.use((db) =>
          db
            .select({
              organizationId: agentTable.organizationId,
              repository: agentTable.repository,
            })
            .from(agentTable)
            .where(eq(agentTable.id, agent.agentId)),
        );
        const [itemRow] = yield* Database.use((db) =>
          db
            .select({ organizationId: inboxItem.organizationId })
            .from(inboxItem)
            .where(eq(inboxItem.id, posted.id)),
        );

        assert.deepEqual(agentRow, { organizationId: workspaceId, repository: "acme/relay" });
        assert.deepEqual(itemRow, { organizationId: workspaceId });
      }),
  );

  it.effect(
    "an answer is taken only while the item is open, withdrawn only under its own key, and another account's finds nothing",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const other = yield* openUser;
        const posted = yield* post(agent);
        const { id } = posted;
        assert.ok(Option.isNone(yield* answerDone(other, posted)));
        const key = randomUUID();
        assert.ok(Option.isSome(yield* answerDone(agent.userId, posted, key)));
        assert.ok(Option.isNone(yield* withdrawInboxAnswer(agent.userId, id, randomUUID())));
        const reopened = Option.getOrThrow(yield* withdrawInboxAnswer(agent.userId, id, key));
        assert.equal(reopened.status, INBOX_STATUS.OPEN);
        yield* closeInboxItem(agent, SETTINGS.key, "Did it myself.");
        assert.ok(
          Option.isNone(yield* answerDone(agent.userId, reopened)),
          "a closed item takes no answer",
        );
        assert.deepEqual(yield* taskInboxItems(other, agent.taskId), []);
      }),
  );

  it.effect(
    "a member closes an open item without an answer only at the revision they saw, the item naming them and taking no answer since, a close withdrawn only under its own key, the agent withdrawing nothing a member's close withdrew already, and the agent's post under the key opens it again",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        const stranger = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const posted = yield* post(agent);
        const { id } = posted;

        assert.ok(Option.isNone(yield* closeInboxItemAsMember(stranger, id, 1, randomUUID())));
        assert.ok(Option.isNone(yield* closeInboxItemAsMember(teammate, id, 2, randomUUID())));
        const key = randomUUID();
        const closed = Option.getOrUndefined(yield* closeInboxItemAsMember(teammate, id, 1, key));
        assert.equal(closed?.status, INBOX_STATUS.CLOSED);
        assert.deepEqual(closed?.closedBy, { userId: teammate, name: "Test User" });
        assert.equal(closed?.closedReason, undefined);
        assert.equal(closed?.unread, false, "the member's own close leaves it read for them");
        assert.ok(
          Option.isNone(yield* answerDone(agent.userId, posted)),
          "a closed item takes no answer",
        );
        assert.ok(Option.isNone(yield* closeInboxItemAsMember(agent.userId, id, 1, randomUUID())));

        assert.ok(Option.isNone(yield* withdrawInboxClose(teammate, id, randomUUID())));
        const reopened = Option.getOrUndefined(yield* withdrawInboxClose(teammate, id, key));
        assert.equal(reopened?.status, INBOX_STATUS.OPEN);
        assert.equal(reopened?.closedBy, undefined);

        const later = randomUUID();
        assert.ok(Option.isSome(yield* closeInboxItemAsMember(teammate, id, 1, later)));
        assert.ok(
          Option.isNone(yield* closeInboxItem(agent, SETTINGS.key, "Did it myself.")),
          "the agent withdraws no ask a member's close withdrew already",
        );
        assert.equal(
          Option.getOrUndefined(yield* withdrawInboxClose(teammate, id, later))?.status,
          INBOX_STATUS.OPEN,
        );
        yield* closeInboxItem(agent, SETTINGS.key, "Did it myself.");
        const again = yield* post(agent, { ...SETTINGS, title: "Require two reviews" });
        assert.equal(again.status, INBOX_STATUS.OPEN);
        assert.equal(again.closedBy, undefined);
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
        const posted = yield* post(agent);
        const { id } = posted;

        assert.deepEqual(
          (yield* taskInboxItems(teammate, agent.taskId)).map((each) => each.id),
          [id],
        );
        assert.ok(Option.isSome(yield* readInboxItem(teammate, id)));
        const key = randomUUID();
        assert.equal(
          Option.getOrUndefined(yield* answerDone(teammate, posted, key))?.status,
          INBOX_STATUS.ANSWERED,
        );
        assert.equal(
          Option.getOrUndefined(yield* withdrawInboxAnswer(teammate, id, key))?.status,
          INBOX_STATUS.OPEN,
        );

        const posted2 = yield* post(agent, { ...SETTINGS, key: "still-open" });
        // The first item stands open again since its answer was withdrawn.
        assert.deepEqual(
          (yield* accountWaitingItems(teammate)).map((each) => each.id).sort(),
          [id, posted2.id].sort(),
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
        assert.ok(Option.isNone(yield* answerDone(stranger, posted)));
      }),
  );

  it.effect(
    "an agent whose starter no longer sees its task still posts, and reads its own asks, addressed to no one who cannot see them, while that starter, whom an ask on a task assigned to nobody waits on, reads, counts, and answers none of them, in the Inbox, or the task's or the agent's read",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const teammate = yield* openUser;
        const task = yield* startTask(owner, {
          name: "Teammate invitations",
          repository: "acme/relay",
          githubAccess: GITHUB_ACCESS.APP,
        });
        yield* joinWorkspace(task.workspaceId, teammate);
        // The App reaches the agent for every member, so only its task's visibility keeps it from the teammate.
        const started = yield* createAgent(teammate, {
          taskId: task.id,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: "acme/relay",
          githubAccess: GITHUB_ACCESS.APP,
          planSnapshot: "# Teammate invitations\n",
          prompt: null,
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
        });
        // The task moves onto its owner's own token, which the teammate keeps none to read through.
        yield* Database.use((db) =>
          db
            .update(taskTable)
            .set({ githubAccess: GITHUB_ACCESS.TOKEN })
            .where(eq(taskTable.id, task.id)),
        );
        yield* updateTask(owner, task.id, { assigneeId: null });
        const agent = {
          userId: teammate,
          taskId: task.id,
          agentId: Option.getOrThrow(started).agent.id,
        };
        assert.deepEqual(
          yield* postInboxThread(agent, {
            ...SETTINGS,
            key: "for-teammate",
            addresseeId: teammate,
          }),
          Result.fail(INBOX_POST_REFUSAL.ADDRESSEE_CANNOT_SEE),
          "an ask is addressed to no one who cannot see its thread",
        );
        // Addressed to nobody on a task assigned to nobody, the ask waits on its starter all the same.
        const posted = yield* post(agent);
        assert.deepEqual(
          (yield* agentInboxItems(agent)).map((each) => each.id),
          [posted.id],
          "the agent reads its own ask, as it acts as itself",
        );
        const seen = (userId: string) =>
          Effect.gen(function* () {
            const account = yield* accountInboxPast(userId, INBOX_CURSOR_START);
            return {
              item: Option.isSome(yield* readInboxItem(userId, posted.id)),
              task: (yield* taskInboxItems(userId, task.id)).length,
              agent: (yield* memberAgentInboxItems(userId, agent.agentId)).length,
              account: account.items.length + account.plans.length,
              stamps: (yield* accountWaitingStamps(userId)).length,
            };
          });

        assert.deepEqual(yield* seen(owner), {
          item: true,
          task: 1,
          agent: 1,
          account: 2,
          stamps: 1,
        });
        assert.deepEqual(yield* seen(teammate), {
          item: false,
          task: 0,
          agent: 0,
          account: 0,
          stamps: 0,
        });
        assert.ok(Option.isNone(yield* answerDone(teammate, posted)));
      }),
  );

  it.effect(
    "a member's message, a teammate's as much as the starter's, stands on the thread of an open item and of an answered one, oldest first and naming its writer, leaves the status, the answer, and the revision as they stood, moves the item's last change and the plan read's cursor, and an outsider writes none",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        const outsider = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const open = yield* post(agent);
        const settled = yield* post(agent, { ...SETTINGS, key: "settled" });
        const answered = Option.getOrThrow(yield* answerDone(agent.userId, settled));
        const before = yield* taskInboxPast(agent.userId, agent.taskId, INBOX_CURSOR_START);
        const write = (userId: string, itemId: string, text: string) =>
          Effect.gen(function* () {
            yield* TestClock.adjust(Duration.seconds(1));
            return yield* postInboxMessage(userId, itemId, { text, clientKey: randomUUID() });
          });

        assert.ok(Option.isNone(yield* write(outsider, open.id, "Not my workspace.")));
        yield* write(agent.userId, open.id, "Is [@main](https://github.com/acme/relay) it?");
        const onOpen = Option.getOrThrow(yield* write(teammate, open.id, "Main, yes."));
        const onSettled = Option.getOrThrow(
          yield* write(teammate, settled.id, "One more thing on this."),
        );

        assert.deepEqual(
          [onOpen.outcome, onSettled.outcome],
          [INBOX_MESSAGE_OUTCOME.WRITTEN, INBOX_MESSAGE_OUTCOME.WRITTEN],
        );
        assert.deepEqual(
          memberMessages(onOpen.item).map((message) => [
            message.author,
            message.member?.userId,
            message.text,
          ]),
          [
            [
              INBOX_MESSAGE_AUTHOR.MEMBER,
              agent.userId,
              "Is [@main](https://github.com/acme/relay) it?",
            ],
            [INBOX_MESSAGE_AUTHOR.MEMBER, teammate, "Main, yes."],
          ],
        );
        assert.deepEqual(
          [onOpen.item.status, onOpen.item.revision],
          [INBOX_STATUS.OPEN, open.revision],
        );
        assert.deepEqual(
          [
            onSettled.item.status,
            onSettled.item.revision,
            answeringOf(onSettled.item),
            onSettled.item.answeredBy,
          ],
          [
            answered.status,
            answered.revision,
            answeringOf({ thread: unkeyed(answered.thread) ?? [] }),
            answered.answeredBy,
          ],
        );
        assert.ok(onSettled.item.updatedAt > answered.updatedAt, "the message moves the item");
        assert.equal(onSettled.item.updatedAt, onSettled.item.thread?.at(-1)?.createdAt);
        const byStarter = yield* readInboxItem(agent.userId, settled.id);
        const byTeammate = yield* readInboxItem(teammate, settled.id);
        const [starterThread, teammateThread] = [byStarter, byTeammate].map(
          (read) => Option.getOrThrow(read).item.thread,
        );
        assert.deepEqual(teammateThread, onSettled.item.thread);
        assert.deepEqual(unkeyed(starterThread), unkeyed(onSettled.item.thread));
        // Note that the key a message was sent under is handed to its writer alone.
        assert.deepEqual(
          starterThread
            ?.filter((message) => message.clientKey !== undefined)
            .map((message) => message.member?.userId),
          [agent.userId],
        );
        const after = yield* taskInboxPast(agent.userId, agent.taskId, INBOX_CURSOR_START);
        assert.notEqual(after.cursor, before.cursor, "a holder of the cursor before hears it");
        assert.deepEqual(yield* taskInboxItems(outsider, agent.taskId), []);
      }),
  );

  it.effect(
    "a message's files are kept in the order attached and served to every member, and stay with the thread when the agent posts the item again; a message sent again under its key is written once and moves nothing, other words under its key are refused as the key reused, and one withdrawn goes with its files",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const { id } = yield* post(agent);
        const files = [
          attached("trace.txt", AGENT_ATTACHMENT_TYPE.TEXT, TRACE),
          attached("after.png", AGENT_ATTACHMENT_TYPE.PNG, SHOT),
        ];
        const key = randomUUID();
        yield* TestClock.adjust(Duration.seconds(1));

        const first = Option.getOrThrow(
          yield* postInboxMessage(agent.userId, id, { text: "", clientKey: key, files }),
        );
        yield* TestClock.adjust(Duration.seconds(1));
        const again = Option.getOrThrow(
          yield* postInboxMessage(agent.userId, id, { text: "", clientKey: key, files }),
        );

        const reused = Option.getOrThrow(
          yield* postInboxMessage(agent.userId, id, {
            text: "Other words.",
            clientKey: key,
            files,
          }),
        );
        assert.deepEqual(
          [first.outcome, again.outcome, reused.outcome],
          [
            INBOX_MESSAGE_OUTCOME.WRITTEN,
            INBOX_MESSAGE_OUTCOME.REPEATED,
            INBOX_MESSAGE_OUTCOME.KEY_REUSED,
          ],
        );
        assert.deepEqual(again.item, first.item, "a repeat writes nothing and moves nothing");
        assert.deepEqual(reused.item, first.item, "a key reused writes nothing either");
        const [message] = memberMessages(first.item);
        assert.deepEqual(
          message?.files?.map((file) => [file.name, file.mediaType]),
          [
            ["trace.txt", AGENT_ATTACHMENT_TYPE.TEXT],
            ["after.png", AGENT_ATTACHMENT_TYPE.PNG],
          ],
        );
        const [trace] = message?.files ?? [];
        assert.ok(trace);
        const served = yield* readInboxAttachment(agent.userId, id, trace.attachmentId);
        assert.deepEqual(new Uint8Array(Option.getOrThrow(served).bytes), TRACE);

        const askedAgain = yield* post(agent, { ...SETTINGS, title: "Require two reviews" });
        // Note that the agent is handed no member's key.
        assert.deepEqual(memberMessages(askedAgain), unkeyed(memberMessages(first.item)));
        assert.ok(Option.isSome(yield* readInboxAttachment(agent.userId, id, trace.attachmentId)));

        yield* withdrawInboxMessage(agent.userId, id, key);
        assert.deepEqual(
          memberMessages(Option.getOrThrow(yield* readInboxItem(agent.userId, id)).item),
          [],
        );
        assert.ok(Option.isNone(yield* readInboxAttachment(agent.userId, id, trace.attachmentId)));
      }),
  );
  it.effect(
    "an item answered or closed is stamped settled at that instant, which a message on its thread leaves while moving the last change; one settled before the stamp was kept reads its last change as settled and keeps it through the first message; a post that opens it again clears it",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const posted = yield* post(agent);
        yield* post(agent, { ...SETTINGS, key: "closing" });
        const { id } = posted;
        assert.equal(posted.settledAt, undefined, "an open item is not settled");
        const say = (itemId: string) =>
          Effect.gen(function* () {
            yield* TestClock.adjust(Duration.seconds(1));
            const said = yield* postInboxMessage(agent.userId, itemId, {
              text: "Following up.",
              clientKey: randomUUID(),
            });
            return Option.getOrThrow(said).item;
          });

        yield* TestClock.adjust(Duration.seconds(1));
        const answered = Option.getOrThrow(yield* answerDone(agent.userId, posted));
        const messaged = yield* say(id);
        assert.equal(answered.settledAt, answered.updatedAt);
        assert.equal(messaged.settledAt, answered.settledAt, "a message leaves when it settled");
        assert.ok(messaged.updatedAt > answered.updatedAt, "and moves when it last changed");

        const closed = Option.getOrThrow(yield* closeInboxItem(agent, "closing", "Not needed."));
        assert.equal(closed.settledAt, yield* Clock.currentTimeMillis);
        assert.ok(
          closed.updatedAt < (closed.settledAt ?? 0),
          "an agent's close leaves its last change",
        );
        // As an item settled before the stamp was kept stands.
        yield* Database.use((db) =>
          db.update(inboxItem).set({ settledAt: null }).where(eq(inboxItem.id, closed.id)),
        );
        const legacy = Option.getOrThrow(yield* readInboxItem(agent.userId, closed.id)).item;
        assert.equal(legacy.settledAt, closed.updatedAt);
        const first = yield* say(closed.id);
        const second = yield* say(closed.id);
        assert.deepEqual([first.settledAt, second.settledAt], [closed.updatedAt, closed.updatedAt]);

        const reopened = yield* post(agent);
        assert.equal(reopened.settledAt, undefined);
        assert.equal(
          (yield* say(id)).settledAt,
          undefined,
          "a message on an open item settles nothing",
        );
      }),
  );
});

/** Whether the item is unread for the reader, as their read of it says. */
it.layer(getTestDB())("the inbox's held reads on Vespin Sync", (it) => {
  it.effect(
    "a task's, an agent's, and the account's held reads each answer an agent's post within a coalesce window of it",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const agent = yield* openAgent;
          const taskId = agent.taskId ?? "";

          const task = yield* taskInboxPast(agent.userId, taskId, INBOX_CURSOR_START);
          const onTask = yield* wokenOnHub(
            taskInboxPast(agent.userId, taskId, task.cursor),
            post(agent, NOTICE),
          );
          const own = yield* agentInboxPast(agent.userId, agent.agentId, INBOX_CURSOR_START);
          const onAgent = yield* wokenOnHub(
            agentInboxPast(agent.userId, agent.agentId, own.cursor),
            post(agent, SETTINGS),
          );
          const account = yield* accountInboxPast(agent.userId, INBOX_CURSOR_START);
          const onAccount = yield* wokenOnHub(
            accountInboxPast(agent.userId, account.cursor),
            post(agent, { ...SETTINGS, key: "release-tag" }),
          );

          assert.deepEqual(
            onTask.answered.items.map((item) => item.id),
            [onTask.written.id],
          );
          assert.ok(onAgent.answered.items.some((item) => item.id === onAgent.written.id));
          assert.ok(onAccount.answered.items.some((item) => item.id === onAccount.written.id));
        }),
      ),
  );
});

const unreadFor = (reader: string, itemId: string) =>
  Effect.map(readInboxItem(reader, itemId), (found) => Option.getOrThrow(found).item.unread);

/** An agent's item posted under the key given. */
const postedItem = (agent: InboxAgent, key: string) => post(agent, { ...SETTINGS, key });

/** An agent's item posted under the key given, its id. */
const postedId = (agent: InboxAgent, key: string) =>
  Effect.map(postedItem(agent, key), (posted) => posted.id);

it.layer(getTestDB())("an inbox item's read state", (it) => {
  it.effect(
    "a new item is unread for every member until each reads it, and unread again for a reader once anything happens on it after their read but the agent withdrawing its ask",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const posted = yield* postedItem(agent, SETTINGS.key);
        const { id } = posted;

        assert.deepEqual(
          [yield* unreadFor(agent.userId, id), yield* unreadFor(teammate, id)],
          [true, true],
        );
        const listed = yield* taskInboxItems(teammate, agent.taskId ?? "");
        assert.deepEqual(
          listed.map((item) => [item.id, item.unread]),
          [[id, true]],
        );
        const waiting = yield* accountWaitingItems(teammate);
        assert.deepEqual(
          waiting.map((entry) => [entry.id, entry.unread]),
          [[id, true]],
        );

        // The read answers the transaction that wrote it, and one already standing writes none.
        const read = yield* markInboxItemRead(agent.userId, id);
        assert.match(read === false ? "" : (read.txid ?? ""), /^\d+$/u);
        assert.deepEqual(
          yield* markInboxItemRead(agent.userId, id),
          {},
          "reading it again is fine",
        );
        assert.deepEqual(
          [yield* unreadFor(agent.userId, id), yield* unreadFor(teammate, id)],
          [false, true],
          "one member's read leaves another's unread",
        );

        // Each change after the read makes it unread again: the agent's reply, a teammate's answer, a post under its key.
        const changes = [
          replyInboxItem(agent, SETTINGS.key, "Still needed."),
          answerDone(teammate, posted),
          post(agent),
        ];
        for (const change of changes) {
          yield* markInboxItemRead(agent.userId, id);
          assert.equal(yield* unreadFor(agent.userId, id), false);
          yield* TestClock.adjust(Duration.seconds(1));
          yield* change;
          assert.equal(yield* unreadFor(agent.userId, id), true);
        }

        // The agent withdrawing its ask asks nothing of the reader, so it leaves the item read.
        yield* markInboxItemRead(agent.userId, id);
        yield* TestClock.adjust(Duration.seconds(1));
        yield* closeInboxItem(agent, SETTINGS.key, "Done another way.");
        assert.equal(yield* unreadFor(agent.userId, id), false);
      }),
  );

  it.effect(
    "a member's own answer or message leaves the item read for them and unread for a teammate, as the write answers it and as later reads say",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const posted = yield* postedItem(agent, SETTINGS.key);
        const { id } = posted;
        yield* markInboxItemRead(agent.userId, id);
        yield* TestClock.adjust(Duration.seconds(1));

        const answered = Option.getOrThrow(yield* answerDone(teammate, posted));
        assert.equal(answered.unread, false, "the answer comes back read for its answerer");
        assert.deepEqual(
          [yield* unreadFor(teammate, id), yield* unreadFor(agent.userId, id)],
          [false, true],
        );

        yield* TestClock.adjust(Duration.seconds(1));
        const messaged = Option.getOrThrow(
          yield* postInboxMessage(agent.userId, id, { text: "Thanks.", clientKey: randomUUID() }),
        );
        assert.equal(messaged.item.unread, false, "the message comes back read for its writer");
        assert.deepEqual(
          [yield* unreadFor(agent.userId, id), yield* unreadFor(teammate, id)],
          [false, true],
        );
      }),
  );

  it.effect(
    "an item marked unread stays unread whatever changes until its member reads it again, and a teammate's marker never moves another's",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const outsider = yield* openUser;
        yield* openWorkspace(outsider);
        const id = yield* postedId(agent, SETTINGS.key);
        yield* markInboxItemRead(agent.userId, id);
        yield* markInboxItemRead(teammate, id);

        const marked = yield* markInboxItemUnread(agent.userId, id);
        assert.match(marked === false ? "" : (marked.txid ?? ""), /^\d+$/u);
        assert.deepEqual(
          yield* markInboxItemUnread(agent.userId, id),
          {},
          "marking it again is fine, and writes nothing to wait for",
        );
        assert.deepEqual(
          [yield* unreadFor(agent.userId, id), yield* unreadFor(teammate, id)],
          [true, false],
        );
        const markedOf = (reader: string) =>
          Effect.map(
            readInboxItem(reader, id),
            (found) => Option.getOrThrow(found).item.markedUnread,
          );
        assert.deepEqual(
          [yield* markedOf(agent.userId), yield* markedOf(teammate)],
          [true, undefined],
          "the read says whose mark it is, which Open reads on a closed thread",
        );
        yield* TestClock.adjust(Duration.seconds(1));
        yield* postInboxMessage(agent.userId, id, { text: "Later.", clientKey: randomUUID() });
        assert.equal(yield* unreadFor(teammate, id), true, "the message is news to the teammate");
        yield* markInboxItemRead(teammate, id);
        assert.equal(yield* unreadFor(teammate, id), false);
        assert.equal(
          yield* unreadFor(agent.userId, id),
          false,
          "the member's own message is a read of the item they marked unread",
        );

        yield* markInboxItemUnread(agent.userId, id);
        yield* markInboxItemUnread(teammate, id);
        yield* markInboxItemRead(teammate, id);
        assert.deepEqual(
          [yield* unreadFor(agent.userId, id), yield* unreadFor(teammate, id)],
          [true, false],
          "the teammate's read leaves the item marked unread for the member who marked it",
        );
        yield* markInboxItemRead(agent.userId, id);
        assert.equal(yield* unreadFor(agent.userId, id), false);

        assert.equal(yield* markInboxItemRead(outsider, id), false, "an outsider reaches no item");
        assert.equal(yield* markInboxItemUnread(outsider, id), false);
        assert.equal(yield* markInboxItemRead(agent.userId, randomUUID()), false);
      }),
  );

  it.effect(
    "a snooze marks the item read for its member alone and holds until a change wakes it or it comes due, and a read then takes it off",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const outsider = yield* openUser;
        yield* openWorkspace(outsider);
        const id = yield* postedId(agent, SETTINGS.key);
        const taskId = agent.taskId ?? "";
        const snoozedFor = (userId: string) =>
          Effect.map(
            taskInboxItems(userId, taskId),
            (items) => items.find((item) => item.id === id)?.snoozedUntil,
          );
        // The store's clock is the test's, while the snooze is weighed on the database's, so ahead is far off and due is long past.
        const ahead = new Date("2999-01-01T09:00:00Z");
        const due = new Date("2001-01-01T09:00:00Z");

        const snoozed = yield* snoozeInboxItem(agent.userId, id, ahead);
        assert.match(snoozed === false ? "" : (snoozed.txid ?? ""), /^\d+$/u);
        assert.deepEqual(
          [yield* snoozedFor(agent.userId), yield* unreadFor(agent.userId, id)],
          [ahead.getTime(), false],
          "snoozing marks it read for its member",
        );
        assert.deepEqual(
          [yield* snoozedFor(teammate), yield* unreadFor(teammate, id)],
          [undefined, true],
          "a teammate's item is neither snoozed nor read",
        );
        assert.deepEqual(yield* markInboxItemRead(agent.userId, id), {});
        assert.equal(
          yield* snoozedFor(agent.userId),
          ahead.getTime(),
          "opening a snoozed item nothing woke leaves it snoozed",
        );

        yield* TestClock.adjust(Duration.seconds(1));
        yield* replyInboxItem(agent, SETTINGS.key, "Still needed.");
        assert.equal(yield* unreadFor(agent.userId, id), true, "a change wakes it, unread");
        yield* markInboxItemRead(agent.userId, id);
        assert.equal(
          yield* snoozedFor(agent.userId),
          undefined,
          "reading it then takes the snooze off",
        );

        yield* snoozeInboxItem(agent.userId, id, due);
        const read = yield* markInboxItemRead(agent.userId, id);
        assert.match(read === false ? "" : (read.txid ?? ""), /^\d+$/u);
        assert.equal(
          yield* snoozedFor(agent.userId),
          undefined,
          "a read once it came due takes it off",
        );
        yield* snoozeInboxItem(agent.userId, id, due);
        assert.equal((yield* markInboxRead(agent.userId, undefined)).marked, 1);
        assert.equal(yield* snoozedFor(agent.userId), undefined, "so does marking every item read");

        yield* snoozeInboxItem(agent.userId, id, ahead);
        yield* snoozeInboxItem(agent.userId, id, null);
        assert.equal(yield* snoozedFor(agent.userId), undefined, "a snooze of none ends it");

        assert.equal(
          yield* snoozeInboxItem(outsider, id, ahead),
          false,
          "an outsider reaches no item",
        );
        assert.equal(yield* snoozeInboxItem(agent.userId, randomUUID(), ahead), false);
      }),
  );

  it.effect(
    "marking every item read marks what the member's Inbox lists in the workspace named, settled items included, or in every workspace where none is, counts only what was unread, and leaves teammates' markers alone",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const elsewhere = yield* openTasklessAgent;
        yield* joinWorkspace(elsewhere.workspaceId, agent.userId);
        const open = yield* postedId(agent, "open");
        const settledItem = yield* postedItem(agent, "settled");
        const settled = settledItem.id;
        assert.ok(Option.isSome(yield* answerDone(teammate, settledItem)));
        const marked = yield* postedId(agent, "marked");
        yield* markInboxItemRead(agent.userId, marked);
        yield* markInboxItemUnread(agent.userId, marked);
        const read = yield* postedId(agent, "read");
        yield* markInboxItemRead(agent.userId, read);
        const other = yield* postedId(elsewhere.agent, SETTINGS.key);

        const all = yield* markInboxRead(agent.userId, workspaceId);
        assert.equal(all.marked, 3);
        assert.match(all.txid ?? "", /^\d+$/u, "one transaction marked them all");
        for (const id of [open, settled, marked, read]) {
          assert.equal(yield* unreadFor(agent.userId, id), false);
        }
        assert.equal(yield* unreadFor(agent.userId, other), true, "another workspace's is left");
        assert.deepEqual(
          [yield* unreadFor(teammate, open), yield* unreadFor(teammate, settled)],
          [true, false],
          "the teammate's markers stand as they were",
        );
        assert.deepEqual(
          yield* markInboxRead(agent.userId, workspaceId),
          { marked: 0 },
          "nothing is left unread, so nothing was written to wait for",
        );

        assert.equal((yield* markInboxRead(agent.userId, undefined)).marked, 1);
        assert.equal(yield* unreadFor(agent.userId, other), false);
      }),
  );

  it.effect(
    "a read never moves a member's marker back past a later change they read through, as their own write landing while a read waits leaves it",
    () =>
      Effect.gen(function* () {
        const { agent } = yield* openAgentIn;
        const id = yield* postedId(agent, SETTINGS.key);
        // As the member's own answer leaves the marker when it lands while a read that selected the older change waits on its lock.
        yield* markInboxItemRead(agent.userId, id);
        const ahead = new Date(
          (yield* DateTime.nowAsDate).getTime() + Duration.toMillis("5 seconds"),
        );
        yield* Database.use((db) =>
          db.update(inboxItemRead).set({ readThrough: ahead }).where(eq(inboxItemRead.itemId, id)),
        );

        yield* markInboxItemRead(agent.userId, id);
        assert.equal(
          (yield* markInboxRead(agent.userId, undefined)).marked,
          0,
          "nothing moved, so nothing counts",
        );
        yield* markInboxItemUnread(agent.userId, id);
        assert.equal((yield* markInboxRead(agent.userId, undefined)).marked, 1);

        yield* TestClock.adjust(Duration.seconds(2));
        yield* replyInboxItem(agent, SETTINGS.key, "Before the later change.");
        assert.equal(
          yield* unreadFor(agent.userId, id),
          false,
          "the marker still reads through the later change, so one before it is read",
        );
      }),
  );

  it.effect(
    "an item that stood before unread was kept reads as read for every member until something happens on it",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const id = yield* postedId(agent, SETTINGS.key);
        // As the migration that added the column stamped every item standing at the instant it ran.
        yield* TestClock.adjust(Duration.seconds(1));
        const released = yield* DateTime.nowAsDate;
        yield* Database.use((db) =>
          db.update(inboxItem).set({ readThrough: released }).where(eq(inboxItem.id, id)),
        );

        assert.deepEqual(
          [yield* unreadFor(agent.userId, id), yield* unreadFor(teammate, id)],
          [false, false],
        );
        assert.equal((yield* markInboxRead(agent.userId, undefined)).marked, 0);

        yield* TestClock.adjust(Duration.seconds(1));
        yield* replyInboxItem(agent, SETTINGS.key, "One more thing.");
        assert.deepEqual(
          [yield* unreadFor(agent.userId, id), yield* unreadFor(teammate, id)],
          [true, true],
        );
        yield* markInboxItemRead(teammate, id);
        assert.equal(yield* unreadFor(teammate, id), false);
      }),
  );

  it.effect(
    "a member's held reads move when their own marker moves, and a teammate's marker leaves them where they stand",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const taskId = agent.taskId ?? "";
        const id = yield* postedId(agent, SETTINGS.key);
        const task = yield* taskInboxPast(agent.userId, taskId, INBOX_CURSOR_START);
        const account = yield* accountInboxPast(agent.userId, INBOX_CURSOR_START);
        const theirs = yield* taskInboxPast(teammate, taskId, INBOX_CURSOR_START);

        yield* markInboxItemRead(agent.userId, id);

        // A held read past the old cursor answers at once, since the reader's own items moved.
        const woken = yield* taskInboxPast(agent.userId, taskId, task.cursor);
        assert.notEqual(woken.cursor, task.cursor);
        assert.deepEqual(
          woken.items.map((item) => item.unread),
          [false],
        );
        const accountWoken = yield* accountInboxPast(agent.userId, account.cursor);
        assert.notEqual(accountWoken.cursor, account.cursor);
        assert.deepEqual(
          accountWoken.items.map((entry) => entry.unread),
          [false],
        );
        const unmoved = yield* taskInboxPast(teammate, taskId, INBOX_CURSOR_START);
        assert.equal(unmoved.cursor, theirs.cursor, "the teammate's inbox stands where it stood");
      }),
  );

  it.effect(
    "each task the account's read lists counts the questions waiting on the reader, a settled task's among them, never a notice or a settled item read or not, alike live and held, and no one counts another's",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const owner = agent.userId;
        const taskId = agent.taskId ?? "";
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const stranger = yield* openUser;
        yield* openWorkspace(stranger);
        const agentOn = (userId: string, onTask: string) =>
          Effect.gen(function* () {
            const started = yield* createAgent(userId, {
              taskId: onTask,
              idempotencyKey: randomUUID(),
              model: "anthropic/claude-opus-5.5",
              effort: "high",
              repository: "acme/relay",
              planSnapshot: null,
              prompt: null,
              runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
            });
            assert.ok(Option.isSome(started));
            return { userId, taskId: onTask, agentId: started.value.agent.id };
          });
        const teammates = yield* agentOn(teammate, taskId);
        const shelved = yield* startTask(owner, { name: "Shelved work" });
        const shelvedAgent = yield* agentOn(owner, shelved.id);

        // The owner's open ask counts; their open notice, unread, asks nothing.
        yield* postedId(agent, "ask");
        yield* post(agent, { ...NOTICE, key: "notice" });
        // A thread they answered, which its agent writes on again, unread, and one they answered and read: neither is a question now.
        const followedItem = yield* postedItem(agent, "followed");
        const followed = followedItem.id;
        for (const item of [followedItem, yield* postedItem(agent, "seen")]) {
          assert.ok(Option.isSome(yield* answerDone(owner, item)));
        }
        yield* TestClock.adjust(Duration.seconds(1));
        assert.ok(Option.isSome(yield* replyInboxItem(agent, "followed", "One more thing.")));
        // A teammate's agent asks on the same task, and the owner's agent asks on a task settled before.
        yield* postedId(teammates, "theirs");
        yield* updateTask(owner, shelved.id, { status: TASK_STATUS.DONE });
        yield* postedId(shelvedAgent, "shelved");

        const toDoOf = (answer: { readonly plans: readonly AccountInboxTask[] }) =>
          new Map(answer.plans.map((plan) => [plan.planId, plan.toDo]));
        for (const reader of [owner, teammate, stranger]) {
          const held = yield* accountInboxPast(reader, INBOX_CURSOR_START);
          const live = yield* liveAnswerOf(reader, held.readAt);
          assert.deepEqual({ ...live, cursor: held.cursor }, held);
        }
        const held = yield* accountInboxPast(owner, INBOX_CURSOR_START);
        assert.deepEqual(
          toDoOf(held),
          new Map([
            [taskId, 1],
            [shelved.id, 1],
          ]),
          "the ask alone, not the teammate's beside it; and the settled task's open ask",
        );
        assert.equal(
          toDoOf(yield* accountInboxPast(teammate, INBOX_CURSOR_START)).get(taskId),
          1,
          "the teammate counts their own ask alone, never the owner's",
        );
        assert.deepEqual((yield* accountInboxPast(stranger, INBOX_CURSOR_START)).plans, []);

        // Reading the settled thread still wakes the held read, and moves no count.
        yield* markInboxItemRead(owner, followed);
        const read = yield* accountInboxPast(owner, held.cursor);
        assert.notEqual(read.cursor, held.cursor);
        assert.equal(toDoOf(read).get(taskId), 1);
      }),
  );
});

it.layer(getTestDB())("a member's writes on an item", (it) => {
  it.effect(
    "an answer and a close each answer the transaction they were taken in, which a follower of the inbox waits for, and one taken in another transaction than the last",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const answering = yield* postedItem(agent, "answered");
        const closedId = yield* postedId(agent, "closed");

        const answered = Option.getOrThrow(yield* answerDone(teammate, answering));
        const closed = Option.getOrThrow(
          yield* closeInboxItemAsMember(teammate, closedId, 1, randomUUID()),
        );
        assert.match(answered.txid ?? "", /^\d+$/u);
        assert.match(closed.txid ?? "", /^\d+$/u);
        assert.notEqual(answered.txid, closed.txid);
        assert.ok(
          Option.isNone(yield* closeInboxItemAsMember(teammate, closedId, 1, randomUUID())),
          "a close that finds the item settled writes nothing, so nothing is waited for",
        );
      }),
  );

  it.effect(
    "a nod settles an open notice at the revision shown, under its key, once, naming who gave it; a nod at a revision the agent moved on from, under a key a message holds, or on an item holding an ask open takes nothing, and one withdrawn leaves the notice waiting again",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const outsider = yield* openUser;
        yield* openWorkspace(outsider);
        const first = yield* post(agent, NOTICE);
        // The agent posts the notice again, which moves its revision on.
        const notice = yield* post(agent, NOTICE);
        assert.notEqual(notice.revision, first.revision);
        const asking = yield* post(agent);
        const nod = (userId: string, item: InboxItem, key: string = randomUUID()) =>
          acknowledgeInboxItem(userId, item.id, item.revision, key);

        assert.ok(Option.isNone(yield* nod(teammate, first)), "a stale revision takes no nod");
        assert.ok(Option.isNone(yield* nod(outsider, notice)), "an outsider reaches no item");
        assert.ok(Option.isNone(yield* nod(teammate, asking)), "an open ask takes no nod");
        const messageKey = randomUUID();
        yield* postInboxMessage(teammate, notice.id, { text: "Noted.", clientKey: messageKey });
        assert.ok(
          Option.isNone(yield* nod(teammate, notice, messageKey)),
          "a key a message holds names the message",
        );
        assert.deepEqual(
          [notice, asking].map((item) => item.status),
          [INBOX_STATUS.OPEN, INBOX_STATUS.OPEN],
        );
        assert.equal(
          Option.getOrThrow(yield* readInboxItem(teammate, asking.id)).item.status,
          INBOX_STATUS.OPEN,
        );

        const key = randomUUID();
        const nodded = Option.getOrThrow(yield* nod(teammate, notice, key));
        assert.equal(nodded.status, INBOX_STATUS.ANSWERED);
        assert.deepEqual(nodded.answeredBy, { userId: teammate, name: "Test User" });
        assert.equal(nodded.unread, false, "the member's own nod leaves it read for them");
        assert.match(nodded.txid ?? "", /^\d+$/u);
        assert.ok(Option.isNone(yield* nod(teammate, notice, key)), "the same nod is taken once");
        assert.ok(Option.isNone(yield* nod(agent.userId, notice)), "a settled notice takes none");
        const read = Option.getOrThrow(yield* readInboxItem(agent.userId, notice.id)).item;
        assert.deepEqual(
          [read.status, read.answeredBy?.userId, read.unread],
          [INBOX_STATUS.ANSWERED, teammate, true],
        );

        const withdrawn = Option.getOrThrow(yield* withdrawInboxAnswer(teammate, notice.id, key));
        assert.deepEqual([withdrawn.status, withdrawn.answeredBy], [INBOX_STATUS.OPEN, undefined]);
        assert.equal(
          Option.getOrUndefined(yield* nod(agent.userId, withdrawn))?.status,
          INBOX_STATUS.ANSWERED,
        );
      }),
  );
});

it.layer(getTestDB())("who an inbox item waits on", (it) => {
  /** A plan's inbox as the desktop builds it from the live rows. */
  const liveTaskInbox = (readerId: string, taskId: string) =>
    Effect.gen(function* () {
      const statements = Option.getOrThrow(taskInboxLiveStatements(readerId, taskId));
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* Effect.all({
        items: sql.unsafe(statements.items.sql, [...statements.items.params]),
        messages: sql.unsafe(statements.messages.sql, [...statements.messages.params]),
        files: sql.unsafe(statements.files.sql, [...statements.files.params]),
      });
      return inboxOfLiveRows(yield* Schema.decodeUnknownEffect(scopeInboxLiveRowsSchema)(rows));
    });

  it.effect(
    "an item on a task waits on the task's assignee, else on its agent's starter, and moves with the assignee, alike in a plan's read, the account's, its To do count, its cursor, and the live reads",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const owner = agent.userId;
        const taskId = agent.taskId ?? "";
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        yield* updateTask(owner, taskId, { assigneeId: null });
        const itemId = yield* postedId(agent, "assigned");
        const standing = Effect.gen(function* () {
          const [item] = yield* taskInboxItems(teammate, taskId);
          const account = yield* accountInboxPast(teammate, INBOX_CURSOR_START);
          const toDoOf = (tasks: readonly AccountInboxTask[]) =>
            tasks.find((each) => each.planId === taskId)?.toDo;
          assert.deepEqual(yield* liveTaskInbox(teammate, taskId), [item]);
          const live = yield* liveAnswerOf(teammate, account.readAt);
          assert.deepEqual({ ...live, cursor: account.cursor }, account);
          return {
            waitsOn: item?.waitsOn?.userId,
            startedBy: item?.startedBy?.userId,
            accountWaitsOn: account.items.find((each) => each.id === itemId)?.waitsOn,
            toDo: {
              owner: toDoOf(yield* accountInboxTasks(owner)),
              teammate: toDoOf(account.plans),
            },
            cursors: {
              task: (yield* taskInboxPast(teammate, taskId, INBOX_CURSOR_START)).cursor,
              account: account.cursor,
            },
          };
        });

        const unassigned = yield* standing;
        yield* updateTask(owner, taskId, { assigneeId: teammate });
        const toTeammate = yield* standing;
        yield* updateTask(owner, taskId, { assigneeId: owner });
        const toOwner = yield* standing;

        assert.deepEqual(
          [unassigned, toTeammate, toOwner].map(({ waitsOn, startedBy, accountWaitsOn, toDo }) => ({
            waitsOn,
            startedBy,
            accountWaitsOn,
            toDo,
          })),
          [
            {
              waitsOn: owner,
              startedBy: owner,
              accountWaitsOn: owner,
              toDo: { owner: 1, teammate: 0 },
            },
            {
              waitsOn: teammate,
              startedBy: owner,
              accountWaitsOn: teammate,
              toDo: { owner: 0, teammate: 1 },
            },
            {
              waitsOn: owner,
              startedBy: owner,
              accountWaitsOn: owner,
              toDo: { owner: 1, teammate: 0 },
            },
          ],
        );
        assert.notEqual(toTeammate.cursors.task, unassigned.cursors.task);
        assert.notEqual(toTeammate.cursors.account, unassigned.cursors.account);
        assert.deepEqual(
          (yield* accountWaitingStamps(teammate)).map((stamp) => stamp.waitsOn),
          [owner],
        );
      }),
  );

  it.effect(
    "a settled item still unread is counted in the account's read of whoever its task is assigned to, else of its agent's starter",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const owner = agent.userId;
        const taskId = agent.taskId ?? "";
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        yield* updateTask(owner, taskId, { assigneeId: null });
        const settled = yield* postedItem(agent, "settled");
        const itemId = settled.id;
        // The owner's answer leaves it read for them and unread for the teammate.
        assert.ok(Option.isSome(yield* answerDone(owner, settled)));
        const counted = (readerId: string) =>
          Effect.map(accountWaitingStamps(readerId), (stamps) =>
            stamps.some((stamp) => stamp.id === itemId),
          );

        const unassigned = yield* counted(teammate);
        yield* updateTask(owner, taskId, { assigneeId: teammate });
        const assigned = yield* counted(teammate);
        yield* updateTask(owner, taskId, { assigneeId: owner });
        const reassigned = yield* counted(teammate);

        assert.deepEqual([unassigned, assigned, reassigned], [false, true, false]);
      }),
  );

  it.effect("an item of an agent with no task waits on the member who started it", () =>
    Effect.gen(function* () {
      const { agent, workspaceId } = yield* openTasklessAgent;
      const teammate = yield* openUser;
      yield* joinWorkspace(workspaceId, teammate);
      yield* postedId(agent, "taskless");

      const [item] = yield* memberAgentInboxItems(teammate, agent.agentId);
      assert.equal(item?.waitsOn?.userId, agent.userId);
    }),
  );

  it.effect(
    "a settled item still unread of an agent with no task is counted in the account's read of its starter alone, never a teammate's",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openTasklessAgent;
        const owner = agent.userId;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        // Each answered by the owner, then written on again by its agent: settled, and unread for the owner.
        const settledOf = (of: InboxAgent) =>
          Effect.gen(function* () {
            const item = yield* postedItem(of, "settled");
            assert.ok(Option.isSome(yield* answerDone(owner, item)));
            yield* TestClock.adjust(Duration.seconds(1));
            assert.ok(Option.isSome(yield* replyInboxItem(of, "settled", "One more thing.")));
            return item.id;
          });
        const coder = yield* settledOf(agent);
        const stampIds = (readerId: string) =>
          Effect.map(accountWaitingStamps(readerId), (stamps) => stamps.map((stamp) => stamp.id));

        assert.deepEqual(
          [(yield* stampIds(owner)).toSorted(), yield* stampIds(teammate)],
          [[coder], []],
        );
      }),
  );
});

it.layer(getTestDB())("a thread's addressee", (it) => {
  it.effect(
    "a thread addressed to a member waits on them over the task's assignee, in its read and the account's stamps, and on the assignee again once a post names nobody, its first ask still naming whom it was addressed to",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const owner = agent.userId;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        yield* updateTask(owner, agent.taskId ?? "", { assigneeId: owner });
        const standing = Effect.gen(function* () {
          const [item] = yield* taskInboxItems(teammate, agent.taskId ?? "");
          const stamps = yield* accountWaitingStamps(teammate);
          return {
            waitsOn: item?.waitsOn?.userId,
            teammateStamp: stamps.find((stamp) => stamp.id === item?.id)?.waitsOn,
          };
        });

        yield* post(agent, { ...SETTINGS, addresseeId: teammate });
        const addressed = yield* standing;
        const after = yield* post(agent, SETTINGS);
        const unaddressed = yield* standing;

        const addressedOf = (status: string) =>
          after.thread?.find((message) => message.ask?.status === status)?.addressedTo?.userId;
        assert.deepEqual(
          [addressedOf(INBOX_ASK_STATUS.REPLACED), addressedOf(INBOX_ASK_STATUS.OPEN)],
          [teammate, undefined],
        );
        assert.deepEqual(addressed, { waitsOn: teammate, teammateStamp: teammate });
        assert.deepEqual(unaddressed, { waitsOn: owner, teammateStamp: owner });
      }),
  );

  it.effect(
    "a follow-up on an open ask readdresses it where it names a member, and a post addressed outside its workspace is refused",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const elsewhere = yield* openAgentIn;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const asked = yield* post(agent, SETTINGS);
        const followUp = { key: SETTINGS.key, body: "The setting is under Branches." };

        const readdressed = yield* post(agent, { ...followUp, addresseeId: teammate });
        const refused = yield* postInboxThread(agent, {
          ...SETTINGS,
          addresseeId: elsewhere.agent.userId,
        });

        assert.equal(readdressed.id, asked.id);
        assert.equal(readdressed.waitsOn?.userId, teammate);
        assert.deepEqual(refused, Result.fail(INBOX_POST_REFUSAL.NO_ADDRESSEE));
      }),
  );
});
