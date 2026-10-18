import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { LiveStatement } from "@luke/database/core/live-statement";
import { Database } from "@luke/database/core/query";
import { writeAccountPreferences } from "@luke/database/models/account-store";
import {
  createAutomation,
  ownFailedRunsLiveStatement,
} from "@luke/database/models/automation-store";
import {
  ensureMember,
  ensureTaskChannel,
  findOrMakeDm,
  markNoticed,
  postAsk,
  postMessage,
} from "@luke/database/models/chat-store";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { updateTask } from "@luke/database/models/task-store";
import { organization, user } from "@luke/database/schemas/auth";
import { automation as automationTable } from "@luke/database/schemas/automation";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { inboxItem } from "@luke/database/schemas/inbox";
import { inboxItemRead } from "@luke/database/schemas/inbox-item-read";
import { getTestDB, joinWorkspace, openWorkspace, startTask } from "@luke/database/testing";
import { ACCOUNT_CHAT_REASON } from "@luke/features/account-inbox-wire";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
} from "@luke/features/automation-wire";
import { CHAT_ASK, CHAT_BLOCK, MEMBER_KIND } from "@luke/features/chat-wire";
import {
  CODING_AGENT_ATTACHMENT_TYPE,
  type CodingAgentAttachment,
} from "@luke/features/coding-agent-wire";
import {
  INBOX_BLOCK,
  INBOX_CURSOR_START,
  INBOX_IMAGE_TYPE,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  type InboxImageBlock,
  type InboxPost,
} from "@luke/features/inbox-wire";
import { accountInboxLiveRowSchemas, accountInboxOfLiveRows } from "@luke/features/live-wire";
import { EXPERIMENT } from "@luke/settings";
import { eq } from "drizzle-orm";
import { DateTime, Duration, Effect, Option, Result, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import {
  accountInboxLiveStatements,
  accountInboxTasks,
  accountWaitingItems,
  answerInboxItem,
  closeInboxItem,
  INBOX_MESSAGE_OUTCOME,
  type InboxAgent,
  type InboxFile,
  markInboxItemRead,
  markInboxItemUnread,
  markInboxRead,
  postInboxItem,
  postInboxMessage,
  readInboxAttachment,
  readInboxItem,
  replyInboxItem,
  taskInboxItems,
  withdrawInboxAnswer,
  withdrawInboxMessage,
} from "../../inbox/inbox-store.js";
import { accountInboxPast, taskInboxPast } from "./inbox-page.js";

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
 * not in is read or written.
 *
 * Synthetic accounts, tasks, and words throughout.
 */

const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** An account with one task and one agent started on it, and the workspace the task is in. */
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

/** A file as an answer carries it: its name, its type, and its bytes in base64. */
const attached = (
  name: string,
  mediaType: CodingAgentAttachment["mediaType"],
  bytes: Uint8Array,
): CodingAgentAttachment => ({ name, mediaType, data: Buffer.from(bytes).toString("base64") });

const TRACE = new TextEncoder().encode("TypeError: invite is undefined\n");
const SHOT = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** A workspace automation of the account's on a task of the workspace, which its runs start agents beside. */
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

/** An account's workspace with one agent started in it on no task, as an automation's run starts one, by an automation of the account's where asked. */
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
        chatAsks: yield* runLive(parts.chatAsks, accountInboxLiveRowSchemas.chatAsks),
        chatNotices: yield* runLive(parts.chatNotices, accountInboxLiveRowSchemas.chatNotices),
      },
      readAt,
    );
  });

it.layer(getTestDB())("the inbox store", (it) => {
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
        const first = yield* postInboxItem(onTask.agent, SETTINGS);
        assert.ok(Result.isSuccess(first));
        assert.ok(
          Result.isSuccess(yield* postInboxItem(onTask.agent, { ...SETTINGS, key: "second" })),
        );
        assert.ok(Result.isSuccess(yield* postInboxItem(taskless, SETTINGS)));
        // Read by the agent's starter and not by the teammate, so the two read it apart.
        assert.equal(yield* markInboxItemRead(onTask.agent.userId, first.success.id), true);

        // Chat on for everyone but the taskless agent's starter: an open ask the plan's agent
        // posts in its channel, a direct message to the teammate they were told of, and the
        // starter told of the ask itself, which waits once.
        const owner = onTask.agent.userId;
        const workspace = onTask.workspaceId;
        for (const each of [owner, teammate, outsider]) {
          yield* writeAccountPreferences(each, { experiments: { [EXPERIMENT.CHAT]: true } });
        }
        const person = (userId: string) =>
          Effect.map(
            ensureMember(owner, workspace, { kind: MEMBER_KIND.HUMAN, userId }),
            Option.getOrThrow,
          );
        const ownerMember = yield* person(owner);
        const teammateMember = yield* person(teammate);
        const agentMember = Option.getOrThrow(
          yield* ensureMember(owner, workspace, {
            kind: MEMBER_KIND.AGENT,
            agentId: onTask.agent.agentId,
          }),
        );
        const channel = Option.getOrThrow(yield* ensureTaskChannel(owner, onTask.agent.taskId));
        const asked = Result.getOrThrow(
          yield* postAsk(owner, workspace, {
            authorMemberId: agentMember.id,
            to: { channelId: channel.id },
            blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: "Which expiry?" }],
            mentions: [],
            clientKey: randomUUID(),
            key: "invite-expiry",
            ask: {
              title: "Invite expiry",
              response: {
                type: CHAT_ASK.CHOICE,
                options: [{ label: "Seven days" }, { label: "Five days" }],
              },
            },
          }),
        );
        const dm = Option.getOrThrow(
          yield* findOrMakeDm(owner, workspace, agentMember.id, teammateMember.id),
        );
        const direct = Result.getOrThrow(
          yield* postMessage(owner, workspace, {
            authorMemberId: agentMember.id,
            to: { channelId: dm.id },
            blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: "Can I take the invite file too?" }],
            mentions: [],
            clientKey: randomUUID(),
          }),
        );
        assert.ok(
          yield* markNoticed(owner, workspace, teammateMember.id, dm.id, direct.message.seq),
        );
        assert.ok(
          yield* markNoticed(owner, workspace, ownerMember.id, channel.id, asked.message.seq),
        );

        for (const reader of [owner, taskless.userId, teammate, outsider]) {
          const held = yield* accountInboxPast(reader, INBOX_CURSOR_START);
          const live = yield* liveAnswerOf(reader, held.readAt);
          assert.deepEqual(live, { ...held, cursor: "" });
        }
        const read = yield* accountInboxPast(teammate, INBOX_CURSOR_START);
        assert.equal(read.items.length + (read.planless?.length ?? 0), 3);
        const unreadOf = (answer: typeof read) =>
          answer.items.find((item) => item.id === first.success.id)?.unread;
        assert.equal(unreadOf(read), true, "the teammate has not read it");
        assert.equal(unreadOf(yield* accountInboxPast(owner, INBOX_CURSOR_START)), false);
        // Every change in a test lands at one instant, so the asks stand before the notices.
        assert.deepEqual(
          read.chat?.map((entry) => [entry.messageId, entry.reason, entry.from]),
          [
            [asked.message.id, ACCOUNT_CHAT_REASON.ASK, agentMember.handle],
            [direct.message.id, ACCOUNT_CHAT_REASON.DIRECT, agentMember.handle],
          ],
        );
        assert.deepEqual(
          (yield* accountInboxPast(owner, INBOX_CURSOR_START)).chat?.map((entry) => entry.reason),
          [ACCOUNT_CHAT_REASON.ASK],
          "a notice of an ask is the ask",
        );
        assert.deepEqual((yield* accountInboxPast(outsider, INBOX_CURSOR_START)).chat, []);
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
    "an item names the member whose agent asks it and an answer the member who gave it, to every member, and an answer withdrawn or an item asked again names nobody",
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
        assert.equal(answered.startedBy?.userId, agent.userId, "the item names whose agent asks");
        for (const reader of [agent.userId, teammate]) {
          const read = Option.getOrThrow(yield* readInboxItem(reader, id)).item;
          assert.equal(read.answeredBy?.userId, teammate);
          assert.equal(read.startedBy?.userId, agent.userId);
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
    "an answer's files are kept beside the item in the order attached, named by name and type, and served as their bytes to every member and nobody else; an answer not taken keeps none",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        const outsider = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const posted = yield* postInboxItem(agent, SETTINGS);
        assert.ok(Result.isSuccess(posted));
        const { id } = posted.success;
        const files = [
          attached("trace.txt", CODING_AGENT_ATTACHMENT_TYPE.TEXT, TRACE),
          attached("after.png", CODING_AGENT_ATTACHMENT_TYPE.PNG, SHOT),
        ];

        const stale = yield* answerInboxItem(teammate, id, 2, DONE, randomUUID(), files);
        assert.ok(Option.isNone(stale));
        assert.equal(
          Option.getOrThrow(yield* readInboxItem(teammate, id)).item.answerFiles,
          undefined,
        );

        const answered = Option.getOrThrow(
          yield* answerInboxItem(teammate, id, 1, DONE, randomUUID(), files),
        );
        assert.deepEqual(
          answered.answerFiles?.map((file) => [file.name, file.mediaType]),
          [
            ["trace.txt", CODING_AGENT_ATTACHMENT_TYPE.TEXT],
            ["after.png", CODING_AGENT_ATTACHMENT_TYPE.PNG],
          ],
        );
        const [trace, shot] = answered.answerFiles ?? [];
        assert.ok(trace && shot);
        for (const reader of [agent.userId, teammate]) {
          const read = Option.getOrThrow(yield* readInboxItem(reader, id)).item;
          assert.deepEqual(read.answerFiles, answered.answerFiles);
          const found = yield* readInboxAttachment(reader, id, trace.attachmentId);
          const served: InboxFile = Option.getOrThrow(found);
          assert.equal(served.contentType, CODING_AGENT_ATTACHMENT_TYPE.TEXT);
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
        const posted = yield* postInboxItem(agent, SETTINGS);
        assert.ok(Result.isSuccess(posted));
        // Past the picture bound, inside a PDF's.
        const spec = new Uint8Array(2_000_000).fill(0x25);
        const answered = yield* answerInboxItem(
          agent.userId,
          posted.success.id,
          1,
          DONE,
          randomUUID(),
          [attached("spec.pdf", CODING_AGENT_ATTACHMENT_TYPE.PDF, spec)],
        );
        const [file] = Option.getOrThrow(answered).answerFiles ?? [];
        assert.ok(file);
        const served = yield* readInboxAttachment(
          agent.userId,
          posted.success.id,
          file.attachmentId,
        );
        assert.equal(Option.getOrThrow(served).bytes.byteLength, spec.byteLength);
      }),
  );

  it.effect(
    "an answer taken back, or a post that opens the item again, deletes the answer's files and keeps the item's pictures",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const withPicture: InboxPost = {
          ...SETTINGS,
          blocks: [{ type: INBOX_BLOCK.IMAGE, path: "shots/rule.png", alt: "The branch rule" }],
        };
        const posted = yield* postInboxItem(agent, withPicture, [
          { contentType: INBOX_IMAGE_TYPE.PNG, bytes: SHOT },
        ]);
        assert.ok(Result.isSuccess(posted));
        const { id } = posted.success;
        const picture = posted.success.blocks.find(
          (block): block is InboxImageBlock => block.type === INBOX_BLOCK.IMAGE,
        );
        assert.ok(picture);
        const files = [attached("trace.txt", CODING_AGENT_ATTACHMENT_TYPE.TEXT, TRACE)];
        const fileOf = (item: { readonly answerFiles?: readonly { attachmentId: string }[] }) =>
          item.answerFiles?.[0]?.attachmentId ?? "";

        const key = randomUUID();
        const first = Option.getOrThrow(
          yield* answerInboxItem(agent.userId, id, 1, DONE, key, files),
        );
        const withdrawn = Option.getOrThrow(yield* withdrawInboxAnswer(agent.userId, id, key));
        assert.equal(withdrawn.answerFiles, undefined);
        assert.ok(Option.isNone(yield* readInboxAttachment(agent.userId, id, fileOf(first))));
        assert.ok(
          Option.isSome(yield* readInboxAttachment(agent.userId, id, picture.attachmentId)),
          "taking an answer back keeps the item's picture",
        );

        const second = Option.getOrThrow(
          yield* answerInboxItem(agent.userId, id, withdrawn.revision, DONE, randomUUID(), files),
        );
        const askedAgain = yield* postInboxItem(agent, SETTINGS);
        assert.ok(Result.isSuccess(askedAgain));
        assert.equal(askedAgain.success.answerFiles, undefined);
        assert.ok(Option.isNone(yield* readInboxAttachment(agent.userId, id, fileOf(second))));
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
  it.effect(
    "a member's message, a teammate's as much as the starter's, stands on the thread of an open item and of an answered one, oldest first and naming its writer, leaves the status, the answer, and the revision as they stood, moves the item's last change and the plan read's cursor, and an outsider writes none",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        const outsider = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const open = yield* postInboxItem(agent, SETTINGS);
        const settled = yield* postInboxItem(agent, { ...SETTINGS, key: "settled" });
        assert.ok(Result.isSuccess(open) && Result.isSuccess(settled));
        const answered = Option.getOrThrow(
          yield* answerInboxItem(agent.userId, settled.success.id, 1, DONE, randomUUID()),
        );
        const before = yield* taskInboxPast(agent.userId, agent.taskId, INBOX_CURSOR_START);
        const write = (userId: string, itemId: string, text: string) =>
          Effect.gen(function* () {
            yield* TestClock.adjust(Duration.seconds(1));
            return yield* postInboxMessage(userId, itemId, { text, clientKey: randomUUID() });
          });

        assert.ok(Option.isNone(yield* write(outsider, open.success.id, "Not my workspace.")));
        yield* write(
          agent.userId,
          open.success.id,
          "Is [@main](https://github.com/acme/relay) it?",
        );
        const onOpen = Option.getOrThrow(yield* write(teammate, open.success.id, "Main, yes."));
        const onSettled = Option.getOrThrow(
          yield* write(teammate, settled.success.id, "One more thing on this."),
        );

        assert.deepEqual(
          [onOpen.outcome, onSettled.outcome],
          [INBOX_MESSAGE_OUTCOME.WRITTEN, INBOX_MESSAGE_OUTCOME.WRITTEN],
        );
        assert.deepEqual(
          onOpen.item.messages?.map((message) => [
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
          [INBOX_STATUS.OPEN, open.success.revision],
        );
        assert.deepEqual(
          [
            onSettled.item.status,
            onSettled.item.revision,
            onSettled.item.answer,
            onSettled.item.answeredBy,
          ],
          [answered.status, answered.revision, answered.answer, answered.answeredBy],
        );
        assert.ok(onSettled.item.updatedAt > answered.updatedAt, "the message moves the item");
        assert.equal(onSettled.item.updatedAt, onSettled.item.messages?.[0]?.createdAt);
        const byStarter = yield* readInboxItem(agent.userId, settled.success.id);
        const byTeammate = yield* readInboxItem(teammate, settled.success.id);
        assert.deepEqual(
          [byStarter, byTeammate].map((read) => Option.getOrThrow(read).item.messages),
          [onSettled.item.messages, onSettled.item.messages],
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
        const posted = yield* postInboxItem(agent, SETTINGS);
        assert.ok(Result.isSuccess(posted));
        const { id } = posted.success;
        const files = [
          attached("trace.txt", CODING_AGENT_ATTACHMENT_TYPE.TEXT, TRACE),
          attached("after.png", CODING_AGENT_ATTACHMENT_TYPE.PNG, SHOT),
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
        const [message] = first.item.messages ?? [];
        assert.deepEqual(
          message?.files?.map((file) => [file.name, file.mediaType]),
          [
            ["trace.txt", CODING_AGENT_ATTACHMENT_TYPE.TEXT],
            ["after.png", CODING_AGENT_ATTACHMENT_TYPE.PNG],
          ],
        );
        const [trace] = message?.files ?? [];
        assert.ok(trace);
        const served = yield* readInboxAttachment(agent.userId, id, trace.attachmentId);
        assert.deepEqual(new Uint8Array(Option.getOrThrow(served).bytes), TRACE);

        const askedAgain = yield* postInboxItem(agent, {
          ...SETTINGS,
          title: "Require two reviews",
        });
        assert.ok(Result.isSuccess(askedAgain));
        assert.deepEqual(askedAgain.success.messages, first.item.messages);
        assert.ok(Option.isSome(yield* readInboxAttachment(agent.userId, id, trace.attachmentId)));

        yield* withdrawInboxMessage(agent.userId, id, key);
        assert.equal(
          Option.getOrThrow(yield* readInboxItem(agent.userId, id)).item.messages,
          undefined,
        );
        assert.ok(Option.isNone(yield* readInboxAttachment(agent.userId, id, trace.attachmentId)));
      }),
  );
  it.effect(
    "an item answered or closed is stamped settled at that instant, which a message on its thread leaves while moving the last change; one settled before the stamp was kept reads its last change as settled and keeps it through the first message; a post that opens it again clears it",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const posted = yield* postInboxItem(agent, SETTINGS);
        const closing = yield* postInboxItem(agent, { ...SETTINGS, key: "closing" });
        assert.ok(Result.isSuccess(posted) && Result.isSuccess(closing));
        const { id } = posted.success;
        assert.equal(posted.success.settledAt, undefined, "an open item is not settled");
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
        const answered = Option.getOrThrow(
          yield* answerInboxItem(agent.userId, id, 1, DONE, randomUUID()),
        );
        const messaged = yield* say(id);
        assert.equal(answered.settledAt, answered.updatedAt);
        assert.equal(messaged.settledAt, answered.settledAt, "a message leaves when it settled");
        assert.ok(messaged.updatedAt > answered.updatedAt, "and moves when it last changed");

        const closed = Option.getOrThrow(yield* closeInboxItem(agent, "closing", "Not needed."));
        assert.equal(closed.settledAt, closed.updatedAt);
        // As an item settled before the stamp was kept stands.
        yield* Database.use((db) =>
          db.update(inboxItem).set({ settledAt: null }).where(eq(inboxItem.id, closed.id)),
        );
        const legacy = Option.getOrThrow(yield* readInboxItem(agent.userId, closed.id)).item;
        assert.equal(legacy.settledAt, closed.updatedAt);
        const first = yield* say(closed.id);
        const second = yield* say(closed.id);
        assert.deepEqual([first.settledAt, second.settledAt], [closed.updatedAt, closed.updatedAt]);

        const reopened = yield* postInboxItem(agent, SETTINGS);
        assert.ok(Result.isSuccess(reopened));
        assert.equal(reopened.success.settledAt, undefined);
        assert.equal(
          (yield* say(id)).settledAt,
          undefined,
          "a message on an open item settles nothing",
        );
      }),
  );
});

/** Whether the item is unread for the reader, as their read of it says. */
const unreadFor = (reader: string, itemId: string) =>
  Effect.map(readInboxItem(reader, itemId), (found) => Option.getOrThrow(found).item.unread);

/** An agent's item posted under the key given, its id. */
const postedId = (agent: InboxAgent, key: string) =>
  Effect.map(postInboxItem(agent, { ...SETTINGS, key }), (posted) => {
    assert.ok(Result.isSuccess(posted));
    return posted.success.id;
  });

it.layer(getTestDB())("an inbox item's read state", (it) => {
  it.effect(
    "a new item is unread for every member until each reads it, and unread again for a reader once anything happens on it after their read",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const id = yield* postedId(agent, SETTINGS.key);

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

        assert.equal(yield* markInboxItemRead(agent.userId, id), true);
        assert.equal(yield* markInboxItemRead(agent.userId, id), true, "reading it again is fine");
        assert.deepEqual(
          [yield* unreadFor(agent.userId, id), yield* unreadFor(teammate, id)],
          [false, true],
          "one member's read leaves another's unread",
        );

        // Each change after the read makes it unread again: the agent's reply, a teammate's answer, a close, a post under its key.
        const changes = [
          replyInboxItem(agent, SETTINGS.key, "Still needed."),
          answerInboxItem(teammate, id, 1, DONE, randomUUID()),
          postInboxItem(agent, SETTINGS),
          closeInboxItem(agent, SETTINGS.key, "Done another way."),
        ];
        for (const change of changes) {
          yield* markInboxItemRead(agent.userId, id);
          assert.equal(yield* unreadFor(agent.userId, id), false);
          yield* TestClock.adjust(Duration.seconds(1));
          yield* change;
          assert.equal(yield* unreadFor(agent.userId, id), true);
        }
      }),
  );

  it.effect(
    "a member's own answer or message leaves the item read for them and unread for a teammate, as the write answers it and as later reads say",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const id = yield* postedId(agent, SETTINGS.key);
        yield* markInboxItemRead(agent.userId, id);
        yield* TestClock.adjust(Duration.seconds(1));

        const answered = Option.getOrThrow(
          yield* answerInboxItem(teammate, id, 1, DONE, randomUUID()),
        );
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

        assert.equal(yield* markInboxItemUnread(agent.userId, id), true);
        assert.equal(
          yield* markInboxItemUnread(agent.userId, id),
          true,
          "marking it again is fine",
        );
        assert.deepEqual(
          [yield* unreadFor(agent.userId, id), yield* unreadFor(teammate, id)],
          [true, false],
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
    "marking every item read marks what the member's Inbox lists in the workspace named, settled items included, or in every workspace where none is, counts only what was unread, and leaves teammates' markers alone",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const elsewhere = yield* openTasklessAgent;
        yield* joinWorkspace(elsewhere.workspaceId, agent.userId);
        const open = yield* postedId(agent, "open");
        const settled = yield* postedId(agent, "settled");
        yield* answerInboxItem(teammate, settled, 1, DONE, randomUUID());
        const marked = yield* postedId(agent, "marked");
        yield* markInboxItemRead(agent.userId, marked);
        yield* markInboxItemUnread(agent.userId, marked);
        const read = yield* postedId(agent, "read");
        yield* markInboxItemRead(agent.userId, read);
        const other = yield* postedId(elsewhere.agent, SETTINGS.key);

        assert.equal(yield* markInboxRead(agent.userId, workspaceId), 3);
        for (const id of [open, settled, marked, read]) {
          assert.equal(yield* unreadFor(agent.userId, id), false);
        }
        assert.equal(yield* unreadFor(agent.userId, other), true, "another workspace's is left");
        assert.deepEqual(
          [yield* unreadFor(teammate, open), yield* unreadFor(teammate, settled)],
          [true, false],
          "the teammate's markers stand as they were",
        );
        assert.equal(yield* markInboxRead(agent.userId, workspaceId), 0, "nothing is left unread");

        assert.equal(yield* markInboxRead(agent.userId, undefined), 1);
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
          yield* markInboxRead(agent.userId, undefined),
          0,
          "nothing moved, so nothing counts",
        );
        yield* markInboxItemUnread(agent.userId, id);
        assert.equal(yield* markInboxRead(agent.userId, undefined), 1);

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
        assert.equal(yield* markInboxRead(agent.userId, undefined), 0);

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
});
