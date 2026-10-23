import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { user } from "@luke/database/schemas/auth";
import { inboxItem } from "@luke/database/schemas/inbox";
import { inboxMessage } from "@luke/database/schemas/inbox-message";
import { getTestDB, joinWorkspace, openWorkspace, startTask } from "@luke/database/testing";
import {
  CODING_AGENT_ATTACHMENT_TYPE,
  type CodingAgentAttachment,
} from "@luke/features/coding-agent-wire";
import { inboxAttachmentOf } from "@luke/features/inbox-attachment-link";
import {
  INBOX_APPROVAL_OPTION,
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_BOUNDS,
  INBOX_FIELD,
  INBOX_IMAGE_TYPE,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_STATUS,
  type InboxItem,
} from "@luke/features/inbox-wire";
import { eq, sql } from "drizzle-orm";
import { DateTime, Duration, Effect, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import {
  accountWaitingItems,
  acknowledgeInboxItem,
  answerInboxAsk,
  closeInboxItem,
  closeInboxItemAsMember,
  INBOX_ASK_ANSWER,
  INBOX_POST_REFUSAL,
  type InboxPostRefusal,
  postInboxMessage,
  postInboxThread,
  readInboxAttachment,
  readInboxItem,
  replyInboxItem,
  taskInboxItems,
  withdrawInboxAnswer,
  withdrawInboxClose,
  withdrawInboxMessage,
} from "../../inbox/inbox-store.js";

/**
 * An inbox item as a thread of messages, through the store's public
 * functions against a real dialect: every post is the agent's message on
 * the thread, the ask it ends with held open and the one before replaced;
 * a post that asks nothing is a notice, open until the developer's nod
 * and holding no ask, or, on a thread whose ask stands open, a message on
 * it; the revision moves only with what the agent asks; an answer is the
 * member's message that answers the open ask, checked against it; a nod
 * settles a notice at the revision the member was shown, once under its
 * key; a read's `thread` carries its first message and its open ask
 * however long it runs; and an account outside the workspace reads and
 * answers none of it.
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
  const task = yield* startTask(userId, { name: "Preview deploys" });
  const started = yield* createCodingAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    repository: "acme/relay",
    planSnapshot: "# Preview deploys\n",
    prompt: null,
  });
  assert.ok(Option.isSome(started));
  const agent = { userId, taskId: task.id, agentId: started.value.agent.id };
  return { agent, workspaceId: task.workspaceId };
});

const openAgent = Effect.map(openAgentIn, ({ agent }) => agent);

/** An account's workspace with one agent started in it on no task, as an automation's run starts one. */
const openTasklessAgent = Effect.gen(function* () {
  const userId = yield* openUser;
  const workspaceId = yield* openWorkspace(userId);
  const started = yield* createCodingAgent(userId, {
    taskId: null,
    organizationId: workspaceId,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    repository: "acme/relay",
    planSnapshot: null,
    prompt: "Check the preview.",
  });
  assert.ok(Option.isSome(started));
  return { userId, taskId: null, agentId: started.value.agent.id };
});

/** A choice between two regions, one recommended. */
const REGION = {
  key: "deploy-region",
  title: "Where should the preview deploy?",
  body: "Two regions are free.",
  ask: {
    type: INBOX_ASK.DECIDE,
    options: [{ label: "iad1" }, { label: "sfo1", detail: "Closer to the team." }],
    recommended: "iad1",
  },
} as const;

/** A `do` of no steps, which the agent does not wait to hear done. */
const SETTINGS = {
  key: "branch-protection",
  title: "Require a review on main",
  body: "Turn on the review rule for main.",
  ask: { type: INBOX_ASK.DO, steps: [] },
  needsReply: false,
} as const;

/** The ask a `decide` post ends with. */
const DECIDE = {
  type: INBOX_ASK.DECIDE,
  options: [{ label: "iad1" }, { label: "sfo1" }],
} as const;

const TRACE = new TextEncoder().encode("TypeError: deploy is undefined\n");
const SHOT = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** Every picture a message's words draw, as the item's picture its address names and the place its address names the item under. */
function picturesIn(text: string | undefined) {
  return [...(text ?? "").matchAll(/!\[[^\]]*\]\(([^\s)]+)/gu)].flatMap(([, address = ""]) => {
    const picture = inboxAttachmentOf(address);
    if (picture === undefined) return [];
    return [{ ...picture, holder: new URL(address).pathname.split("/").slice(2, 4).join("/") }];
  });
}

const attached = (name: string, bytes: Uint8Array): CodingAgentAttachment => ({
  name,
  mediaType: CODING_AGENT_ATTACHMENT_TYPE.TEXT,
  data: Buffer.from(bytes).toString("base64"),
});

/** The item a post wrote, where it was written. */
function posted(result: Result.Result<InboxItem, InboxPostRefusal>): InboxItem {
  assert.ok(Result.isSuccess(result));
  return result.success;
}

/** The thread as who wrote each message, its ask's type, and where that ask stands. */
function asksOf(item: InboxItem) {
  return (item.thread ?? []).map((message) => [
    message.author,
    message.ask?.type,
    message.ask?.status,
  ]);
}

/** The id of the message whose ask the item holds open. */
function openAskOf(item: InboxItem): string {
  const asking = (item.thread ?? []).find(
    (message) => message.ask?.status === INBOX_ASK_STATUS.OPEN,
  );
  assert.ok(asking, "the item holds an ask open");
  return asking.id;
}

/** The answer the member's message on the thread carries, the latest that carries one. */
function answersOf(item: InboxItem) {
  return (item.thread ?? []).findLast((message) => message.answers !== undefined)?.answers;
}

/** One second on, so each write after it is the latest. */
const later = TestClock.adjust(Duration.seconds(1));

it.layer(getTestDB())("an inbox item's thread", (it) => {
  it.effect(
    "a post writes the agent's message with its words and the ask it ends with held open, and a post under the same key replaces the ask held open, moving the title and the revision",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const first = posted(yield* postInboxThread(agent, REGION));
        const [question] = first.thread ?? [];
        assert.equal(question?.text, "Two regions are free.");
        assert.deepEqual(question?.ask, { ...REGION.ask, status: INBOX_ASK_STATUS.OPEN });
        assert.deepEqual(
          [first.status, first.revision, first.title, first.needsReply],
          [INBOX_STATUS.OPEN, 1, REGION.title, true],
        );

        yield* later;
        const approval = {
          type: INBOX_ASK.DECIDE,
          options: [
            { label: INBOX_APPROVAL_OPTION.APPROVE },
            { label: INBOX_APPROVAL_OPTION.DECLINE },
          ],
        } as const;
        const second = posted(
          yield* postInboxThread(agent, {
            key: REGION.key,
            title: "Deploy the preview to iad1?",
            body: "iad1 it is, unless you say otherwise.",
            ask: approval,
          }),
        );
        assert.deepEqual(asksOf(second), [
          [INBOX_MESSAGE_AUTHOR.AGENT, INBOX_ASK.DECIDE, INBOX_ASK_STATUS.REPLACED],
          [INBOX_MESSAGE_AUTHOR.AGENT, INBOX_ASK.DECIDE, INBOX_ASK_STATUS.OPEN],
        ]);
        assert.deepEqual(second.thread?.[1]?.ask, {
          ...approval,
          status: INBOX_ASK_STATUS.OPEN,
        });
        assert.deepEqual(
          [second.title, second.revision, second.status],
          ["Deploy the preview to iad1?", 2, INBOX_STATUS.OPEN],
        );
      }),
  );

  it.effect(
    "the revision moves when the agent asks, asks again, or withdraws, and never for a message on the thread or an answer",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const item = posted(yield* postInboxThread(agent, SETTINGS));
        const { id } = item;
        const revision = Effect.map(
          readInboxItem(agent.userId, id),
          (read) => Option.getOrThrow(read).item.revision,
        );
        const answerKey = randomUUID();
        const writes = [
          replyInboxItem(agent, SETTINGS.key, "Still needed."),
          postInboxMessage(agent.userId, id, { text: "On it.", clientKey: randomUUID() }),
          answerInboxAsk(agent.userId, id, {
            answers: { ask: openAskOf(item), reply: INBOX_REPLY.DONE, steps: [] },
            text: "",
            clientKey: answerKey,
          }),
          withdrawInboxAnswer(agent.userId, id, answerKey),
          postInboxThread(agent, SETTINGS),
          closeInboxItem(agent, SETTINGS.key, "Done by hand."),
        ];
        const seen = [yield* revision];
        for (const write of writes) {
          yield* later;
          yield* write;
          seen.push(yield* revision);
        }

        assert.deepEqual(seen, [1, 1, 1, 1, 1, 2, 3]);
      }),
  );

  it.effect(
    "a member's close withdraws the open ask with no reason and its agent's close with its own, the item naming the member and moving no revision for the member's, and a member's close taken back opens the ask again",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const { id } = posted(yield* postInboxThread(agent, REGION));
        yield* later;
        const closeKey = randomUUID();

        const closed = Option.getOrThrow(yield* closeInboxItemAsMember(teammate, id, 1, closeKey));
        assert.deepEqual(
          [closed.status, closed.revision, closed.closedBy?.userId, closed.closedReason],
          [INBOX_STATUS.CLOSED, 1, teammate, undefined],
        );
        assert.deepEqual(closed.thread?.[0]?.ask?.status, INBOX_ASK_STATUS.WITHDRAWN);
        assert.equal(
          closed.thread?.[0]?.ask?.withdrawnReason,
          undefined,
          "a member's close gives no reason",
        );
        assert.equal(closed.thread?.length, 1, "a member's close writes no message");

        const reopened = Option.getOrThrow(yield* withdrawInboxClose(teammate, id, closeKey));
        assert.deepEqual(asksOf(reopened), [
          [INBOX_MESSAGE_AUTHOR.AGENT, INBOX_ASK.DECIDE, INBOX_ASK_STATUS.OPEN],
        ]);
        assert.deepEqual([reopened.status, reopened.closedBy], [INBOX_STATUS.OPEN, undefined]);
        const taken = Option.getOrThrow(
          yield* answerInboxAsk(teammate, id, {
            answers: {
              ask: reopened.thread?.[0]?.id ?? "",
              reply: INBOX_REPLY.CHOSE,
              choices: ["iad1"],
            },
            text: "",
            clientKey: randomUUID(),
          }),
        );
        assert.equal(taken.outcome, INBOX_ASK_ANSWER.TAKEN, "the ask opened again takes an answer");

        yield* later;
        const asked = posted(yield* postInboxThread(agent, REGION));
        const byAgent = Option.getOrThrow(yield* closeInboxItem(agent, REGION.key, "Picked iad1."));
        assert.deepEqual(byAgent.thread?.at(-1)?.ask?.withdrawnReason, "Picked iad1.");
        assert.equal(byAgent.revision, asked.revision + 1);
      }),
  );

  it.effect(
    "an answer to the open ask is written as the member's message that carries it, with its words and files, settling the ask; taken back, the message is gone and the ask is open again",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const asked = posted(yield* postInboxThread(agent, REGION));
        const { id } = asked;
        const ask = openAskOf(asked);
        yield* later;
        yield* replyInboxItem(agent, REGION.key, "Both cost the same.");
        yield* later;
        const answerKey = randomUUID();

        const answered = Option.getOrThrow(
          yield* answerInboxAsk(teammate, id, {
            answers: { ask, reply: INBOX_REPLY.CHOSE, choices: ["sfo1"] },
            text: "Closer to the team.",
            clientKey: answerKey,
            files: [attached("trace.txt", TRACE)],
          }),
        ).item;

        const [question, said, answer] = answered.thread ?? [];
        assert.equal(question?.ask?.status, INBOX_ASK_STATUS.ANSWERED);
        assert.equal(said?.text, "Both cost the same.");
        assert.deepEqual(
          [answer?.author, answer?.member?.userId, answer?.text, answer?.answers],
          [
            INBOX_MESSAGE_AUTHOR.MEMBER,
            teammate,
            "Closer to the team.",
            { ask, reply: INBOX_REPLY.CHOSE, choices: ["sfo1"] },
          ],
        );
        assert.deepEqual(
          answer?.files?.map((file) => file.name),
          ["trace.txt"],
        );
        const [file] = answer?.files ?? [];
        assert.ok(file);
        const served = yield* readInboxAttachment(teammate, id, file.attachmentId);
        assert.deepEqual(new Uint8Array(Option.getOrThrow(served).bytes), TRACE);
        assert.deepEqual(
          [answered.status, answered.revision, answered.answeredBy?.userId],
          [INBOX_STATUS.ANSWERED, 1, teammate],
        );

        const withdrawn = Option.getOrThrow(yield* withdrawInboxAnswer(teammate, id, answerKey));
        assert.deepEqual(asksOf(withdrawn), [
          [INBOX_MESSAGE_AUTHOR.AGENT, INBOX_ASK.DECIDE, INBOX_ASK_STATUS.OPEN],
          [INBOX_MESSAGE_AUTHOR.AGENT, undefined, undefined],
        ]);
        assert.deepEqual([withdrawn.status, withdrawn.answeredBy], [INBOX_STATUS.OPEN, undefined]);
        assert.ok(
          Option.isNone(yield* readInboxAttachment(teammate, id, file.attachmentId)),
          "the answer's files go with its message",
        );
        const again = Option.getOrThrow(
          yield* answerInboxAsk(teammate, id, {
            answers: { ask, reply: INBOX_REPLY.CHOSE, choices: ["iad1"] },
            text: "",
            clientKey: randomUUID(),
          }),
        );
        assert.equal(again.outcome, INBOX_ASK_ANSWER.TAKEN, "the ask taken back takes an answer");
      }),
  );

  it.effect(
    "an answer to an ask by its message is checked against the ask, taken once under its key with the item answered, and takes nothing once the ask is no longer the one held open",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const asked = posted(
          yield* postInboxThread(agent, {
            key: "deploy-region",
            title: "Where should the preview deploy?",
            body: "Two regions are free.",
            ask: DECIDE,
          }),
        );
        assert.equal(asked.status, INBOX_STATUS.OPEN);
        const ask = asked.thread?.[0]?.id ?? "";
        const answer = (choices: readonly string[], clientKey: string) =>
          Effect.map(
            answerInboxAsk(agent.userId, asked.id, {
              answers: { ask, reply: INBOX_REPLY.CHOSE, choices },
              text: "Closer to the team.",
              clientKey,
            }),
            Option.getOrThrow,
          );

        yield* later;
        const refused = yield* answer(["fra1"], randomUUID());
        assert.equal(refused.outcome, INBOX_ASK_ANSWER.REFUSED);
        assert.notEqual(refused.refusal, undefined, "the refusal says why");
        assert.equal(refused.item.status, INBOX_STATUS.OPEN);

        const key = randomUUID();
        const taken = yield* answer(["sfo1"], key);
        assert.equal(taken.outcome, INBOX_ASK_ANSWER.TAKEN);
        assert.deepEqual(
          [taken.item.status, answersOf(taken.item), taken.item.answeredBy?.userId],
          [
            INBOX_STATUS.ANSWERED,
            { ask, reply: INBOX_REPLY.CHOSE, choices: ["sfo1"] },
            agent.userId,
          ],
        );
        assert.match(
          taken.txid ?? "",
          /^\d+$/u,
          "the answer is taken in a transaction to wait for",
        );
        const repeated = yield* answer(["sfo1"], key);
        assert.deepEqual(
          [repeated.outcome, repeated.txid],
          [INBOX_ASK_ANSWER.REPEATED, undefined],
          "the same answer sent again writes nothing, so nothing is waited for",
        );
        const changed = yield* answer(["fra1"], key);
        assert.deepEqual(
          [changed.outcome, changed.refusal, answersOf(changed.item)?.choices],
          [INBOX_ASK_ANSWER.REFUSED, "The key names another message of the thread.", ["sfo1"]],
          "another answer under the key it was taken by is refused, and the answer stands",
        );

        yield* later;
        const askedAgain = posted(
          yield* postInboxThread(agent, {
            key: "deploy-region",
            title: "Which region for staging?",
            body: "Staging needs one too.",
            ask: DECIDE,
          }),
        );
        assert.deepEqual(asksOf(askedAgain), [
          [INBOX_MESSAGE_AUTHOR.AGENT, INBOX_ASK.DECIDE, INBOX_ASK_STATUS.ANSWERED],
          [INBOX_MESSAGE_AUTHOR.MEMBER, undefined, undefined],
          [INBOX_MESSAGE_AUTHOR.AGENT, INBOX_ASK.DECIDE, INBOX_ASK_STATUS.OPEN],
        ]);
        assert.equal((yield* answer(["iad1"], randomUUID())).outcome, INBOX_ASK_ANSWER.NOT_OPEN);
      }),
  );

  it.effect(
    "a form filled in part is taken and recorded with the values given, a required field left empty absent from them, while a form given nothing at all is refused",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const asked = posted(
          yield* postInboxThread(agent, {
            key: "preview-limits",
            title: "What may the preview use?",
            body: "The preview needs limits.",
            ask: {
              type: INBOX_ASK.ANSWER,
              fields: [
                { type: INBOX_FIELD.NUMBER, label: "Monthly budget", required: true },
                { type: INBOX_FIELD.TEXT, label: "Owner", required: true },
              ],
            },
          }),
        );
        const ask = asked.thread?.[0]?.id ?? "";
        const submit = (values: readonly { label: string; value: number | string }[]) =>
          Effect.map(
            answerInboxAsk(agent.userId, asked.id, {
              answers: { ask, reply: INBOX_REPLY.SUBMITTED, values },
              text: "",
              clientKey: randomUUID(),
            }),
            Option.getOrThrow,
          );

        yield* later;
        const empty = yield* submit([{ label: "Owner", value: "  " }]);
        assert.equal(empty.outcome, INBOX_ASK_ANSWER.REFUSED);
        assert.equal(empty.item.status, INBOX_STATUS.OPEN);

        const partial = yield* submit([{ label: "Monthly budget", value: 40 }]);
        assert.deepEqual(
          [partial.outcome, partial.item.status, answersOf(partial.item)],
          [
            INBOX_ASK_ANSWER.TAKEN,
            INBOX_STATUS.ANSWERED,
            {
              ask,
              reply: INBOX_REPLY.SUBMITTED,
              values: [{ label: "Monthly budget", value: 40 }],
            },
          ],
        );
        assert.deepEqual(asksOf(partial.item), [
          [INBOX_MESSAGE_AUTHOR.AGENT, INBOX_ASK.ANSWER, INBOX_ASK_STATUS.ANSWERED],
          [INBOX_MESSAGE_AUTHOR.MEMBER, undefined, undefined],
        ]);
      }),
  );

  it.effect(
    "a post that asks nothing is a message on a thread whose ask stands open, moving nothing but its last change, and under a new key opens a notice waiting on the developer's nod",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const asked = posted(
          yield* postInboxThread(agent, {
            key: "deploy-region",
            title: "Where should the preview deploy?",
            body: "Two regions are free.",
            ask: DECIDE,
          }),
        );
        yield* later;

        const followed = posted(
          yield* postInboxThread(agent, {
            key: "deploy-region",
            title: "Another title",
            body: "Pinged the team too.",
          }),
        );
        assert.deepEqual(
          [followed.status, followed.revision, followed.title],
          [INBOX_STATUS.OPEN, asked.revision, asked.title],
        );
        assert.deepEqual(asksOf(followed), [
          [INBOX_MESSAGE_AUTHOR.AGENT, INBOX_ASK.DECIDE, INBOX_ASK_STATUS.OPEN],
          [INBOX_MESSAGE_AUTHOR.AGENT, undefined, undefined],
        ]);
        assert.ok(followed.updatedAt > asked.updatedAt);

        const opened = posted(
          yield* postInboxThread(agent, {
            key: "preview-up",
            title: "The preview is up",
            body: "It deploys from main.",
            needsReply: true,
          }),
        );
        assert.deepEqual(
          [opened.status, opened.needsReply, opened.revision],
          [INBOX_STATUS.OPEN, false, 1],
          "a notice asks for nothing back",
        );
        assert.deepEqual(asksOf(opened), [[INBOX_MESSAGE_AUTHOR.AGENT, undefined, undefined]]);
        assert.deepEqual(
          opened.thread?.map((message) => message.text),
          ["It deploys from main."],
        );
      }),
  );

  it.effect(
    "a post's pictures are kept as files of its message, its words drawing each by its address under the item, its task's or its agent's, and served as they were posted",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const rule = {
          path: "shots/rule.png",
          name: "rule.png",
          contentType: INBOX_IMAGE_TYPE.PNG,
          bytes: SHOT,
        };
        const onTask = posted(
          yield* postInboxThread(
            agent,
            {
              ...SETTINGS,
              body: "The rule as it stands:\n\n![The branch rule](shots/rule.png)",
            },
            [rule],
          ),
        );
        const [posting] = onTask.thread ?? [];
        const [ruleFile] = posting?.files ?? [];
        assert.ok(ruleFile);
        assert.deepEqual(picturesIn(posting?.text), [
          {
            itemId: onTask.id,
            attachmentId: ruleFile.attachmentId,
            holder: `plan/${agent.taskId}`,
          },
        ]);
        assert.ok(posting?.text.startsWith("The rule as it stands:\n\n![The branch rule]("));
        assert.equal(ruleFile.name, "rule.png");

        const taskless = yield* openTasklessAgent;
        const picture = {
          path: "shots/before.png",
          name: "before.png",
          contentType: INBOX_IMAGE_TYPE.PNG,
          bytes: SHOT,
        };
        const asked = posted(
          yield* postInboxThread(
            taskless,
            {
              key: "preview-look",
              title: "Ship the new page?",
              body: [
                "The page as it was:",
                '![The old page](shots/before.png "Before")',
                "Named in code it stays a path: `![x](shots/before.png)`",
              ].join("\n\n"),
              ask: DECIDE,
            },
            [picture],
          ),
        );
        const [question] = asked.thread ?? [];
        const [kept] = question?.files ?? [];
        assert.ok(kept);
        assert.deepEqual(picturesIn(question?.text), [
          {
            itemId: asked.id,
            attachmentId: kept.attachmentId,
            holder: `agent/${taskless.agentId}`,
          },
        ]);
        assert.ok(question?.text.endsWith("`![x](shots/before.png)`"));
        const served = yield* readInboxAttachment(taskless.userId, asked.id, kept.attachmentId);
        assert.deepEqual(new Uint8Array(Option.getOrThrow(served).bytes), SHOT);

        yield* later;
        const followed = posted(
          yield* postInboxThread(
            taskless,
            { key: "preview-look", title: "", body: "And now: ![The new page](shots/before.png)" },
            [picture],
          ),
        );
        const said = followed.thread?.at(-1);
        assert.equal(said?.files?.length, 1);
        assert.deepEqual(picturesIn(said?.text), [
          {
            itemId: asked.id,
            attachmentId: said?.files?.[0]?.attachmentId,
            holder: `agent/${taskless.agentId}`,
          },
        ]);
      }),
  );

  it.effect(
    "a long thread's read keeps its first message and the one whose ask is open beside the latest",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const first = posted(yield* postInboxThread(agent, SETTINGS));
        const opening = first.thread?.[0]?.id;
        const notes = (from: number, count: number, at: Date) =>
          Database.use((db) =>
            db.insert(inboxMessage).values(
              Array.from({ length: count }, (_, index) => ({
                itemId: first.id,
                author: INBOX_MESSAGE_AUTHOR.MEMBER,
                userId: agent.userId,
                text: `Note ${from + index}`,
                createdAt: new Date(at.getTime() + (index + 1) * 1_000),
              })),
            ),
          );
        yield* notes(0, 10, yield* DateTime.nowAsDate);
        yield* TestClock.adjust(Duration.minutes(1));
        const askedAgain = posted(
          yield* postInboxThread(agent, { ...SETTINGS, title: "Two reviews" }),
        );
        const open = askedAgain.thread?.at(-1)?.id;
        yield* notes(10, 55, yield* DateTime.nowAsDate);

        const read = Option.getOrThrow(yield* readInboxItem(agent.userId, first.id)).item;

        const thread = read.thread ?? [];
        assert.equal(thread.length, 52);
        assert.deepEqual(
          [thread[0]?.id, thread[1]?.id, thread[2]?.text, thread.at(-1)?.text],
          [opening, open, "Note 15", "Note 64"],
          "the first message and the open ask, then the latest fifty, oldest first",
        );
        assert.equal(thread[1]?.ask?.status, INBOX_ASK_STATUS.OPEN);
      }),
  );

  it.effect(
    "a close as a deployment from before threads writes one, the item's row alone, leaves the ask it held reading withdrawn with its reason",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const now = yield* DateTime.nowAsDate;
        const asked = posted(yield* postInboxThread(agent, SETTINGS));
        yield* Database.use((db) =>
          db
            .update(inboxItem)
            .set({
              status: INBOX_STATUS.CLOSED,
              closedReason: "Did it by hand.",
              revision: sql`${inboxItem.revision} + 1`,
              settledAt: now,
              updatedAt: now,
            })
            .where(eq(inboxItem.id, asked.id)),
        );
        const closed = Option.getOrThrow(yield* readInboxItem(agent.userId, asked.id)).item;
        assert.deepEqual(closed.thread?.[0]?.ask, {
          type: INBOX_ASK.DO,
          steps: [],
          status: INBOX_ASK_STATUS.WITHDRAWN,
          withdrawnReason: "Did it by hand.",
        });
      }),
  );

  it.effect(
    "an answer under a key a message of the thread already holds is not taken, so no answer stands without the message that carries it",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const asked = posted(yield* postInboxThread(agent, REGION));
        const key = randomUUID();
        yield* later;
        yield* postInboxMessage(agent.userId, asked.id, {
          text: "Which is cheaper?",
          clientKey: key,
        });

        const byAsk = Option.getOrThrow(
          yield* answerInboxAsk(agent.userId, asked.id, {
            answers: {
              ask: asked.thread?.[0]?.id ?? "",
              reply: INBOX_REPLY.CHOSE,
              choices: ["iad1"],
            },
            text: "",
            clientKey: key,
          }),
        );
        assert.equal(byAsk.outcome, INBOX_ASK_ANSWER.REFUSED);
        const read = Option.getOrThrow(yield* readInboxItem(agent.userId, asked.id)).item;
        assert.deepEqual(
          [read.status, read.thread?.[0]?.ask?.status],
          [INBOX_STATUS.OPEN, INBOX_ASK_STATUS.OPEN],
        );
      }),
  );

  it.effect(
    "a post that asks nothing takes no place among the open asks, so an agent holding as many as it may still posts one, and notices left open keep no ask from being posted; past as many open notices, one more is refused until the developer nods to one, while a follow-up on one stands",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        for (let at = 0; at < INBOX_BOUNDS.MAX_OPEN_PER_AGENT; at += 1) {
          posted(
            yield* postInboxThread(agent, {
              key: `notice-${at}`,
              title: "The preview is up",
              body: "It deploys from main.",
            }),
          );
        }
        for (let at = 0; at < INBOX_BOUNDS.MAX_OPEN_PER_AGENT; at += 1) {
          posted(yield* postInboxThread(agent, { ...SETTINGS, key: `open-${at}` }));
        }

        const refused = yield* postInboxThread(agent, { ...SETTINGS, key: "one-more" });
        const notice = {
          key: "preview-up",
          title: "The preview is up",
          body: "It deploys from main.",
        };

        assert.deepEqual(refused, Result.fail(INBOX_POST_REFUSAL.TOO_MANY_OPEN));
        assert.deepEqual(
          yield* postInboxThread(agent, notice),
          Result.fail(INBOX_POST_REFUSAL.TOO_MANY_NOTICES),
          "the notice bound counts the notices open, whatever the ask bound holds",
        );
        const first = posted(
          yield* postInboxThread(agent, { key: "notice-0", body: "Redeployed from main." }),
        );
        assert.equal(first.status, INBOX_STATUS.OPEN, "a follow-up on a notice still open stands");
        assert.ok(
          Option.isSome(
            yield* acknowledgeInboxItem(agent.userId, first.id, first.revision, randomUUID()),
          ),
        );
        assert.equal(posted(yield* postInboxThread(agent, notice)).status, INBOX_STATUS.OPEN);
      }),
  );

  it.effect(
    "a post that asks nothing on a thread holding no open ask brings it back as a notice, its revision moved on, until the developer's Got it settles it without a message; a member's close settles one too",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const asked = posted(
          yield* postInboxThread(agent, {
            key: "deploy-region",
            title: "Where should the preview deploy?",
            body: "Two regions are free.",
            ask: DECIDE,
          }),
        );
        const ask = asked.thread?.[0]?.id ?? "";
        const answers = { ask, reply: INBOX_REPLY.CHOSE, choices: ["iad1"] };
        yield* later;
        yield* answerInboxAsk(agent.userId, asked.id, {
          answers,
          text: "",
          clientKey: randomUUID(),
        });
        yield* later;

        const followed = posted(
          yield* postInboxThread(agent, { key: "deploy-region", body: "Deployed to iad1." }),
        );
        assert.deepEqual(
          [followed.status, followed.title, followed.revision, followed.answeredBy],
          [INBOX_STATUS.OPEN, asked.title, asked.revision + 1, undefined],
        );
        assert.deepEqual(asksOf(followed), [
          [INBOX_MESSAGE_AUTHOR.AGENT, INBOX_ASK.DECIDE, INBOX_ASK_STATUS.ANSWERED],
          [INBOX_MESSAGE_AUTHOR.MEMBER, undefined, undefined],
          [INBOX_MESSAGE_AUTHOR.AGENT, undefined, undefined],
        ]);
        const waiting = Effect.map(accountWaitingItems(agent.userId), (entries) =>
          entries.map((entry) => entry.id),
        );
        assert.deepEqual(yield* waiting, [asked.id]);
        yield* later;

        const nodded = Option.getOrThrow(
          yield* acknowledgeInboxItem(agent.userId, asked.id, followed.revision, randomUUID()),
        );
        assert.deepEqual(
          [nodded.status, nodded.answeredBy?.userId],
          [INBOX_STATUS.ANSWERED, agent.userId],
        );
        assert.equal(nodded.thread?.length, 3, "a nod writes no message on the thread");
        assert.deepEqual(yield* waiting, []);

        const closing = posted(
          yield* postInboxThread(agent, {
            key: "preview-up",
            title: "The preview is up",
            body: "It deploys from main.",
          }),
        );
        const closed = Option.getOrThrow(
          yield* closeInboxItemAsMember(agent.userId, closing.id, closing.revision, randomUUID()),
        );
        assert.equal(closed.status, INBOX_STATUS.CLOSED);
        assert.deepEqual(yield* waiting, []);
      }),
  );

  it.effect(
    "a nod settles an open notice at the revision the member was shown and no other, is taken once under its key, and takes neither an item holding an ask open, a key a message of the thread holds, nor an item outside the account's workspaces; taken back, the notice waits again",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const outsider = yield* openUser;
        yield* openWorkspace(outsider);
        const asking = posted(yield* postInboxThread(agent, REGION));
        assert.ok(
          Option.isNone(
            yield* acknowledgeInboxItem(agent.userId, asking.id, asking.revision, randomUUID()),
          ),
          "a nod settles no ask",
        );
        assert.equal(
          Option.getOrThrow(yield* readInboxItem(agent.userId, asking.id)).item.status,
          INBOX_STATUS.OPEN,
        );

        posted(
          yield* postInboxThread(agent, {
            key: "preview-up",
            title: "The preview is up",
            body: "It deploys from main.",
          }),
        );
        yield* later;
        // Posted again under its key, so the revision first shown is one the agent has moved on from.
        const notice = posted(
          yield* postInboxThread(agent, {
            key: "preview-up",
            title: "The preview is up again",
            body: "Redeployed from main.",
          }),
        );
        assert.equal(notice.revision, 2);
        const status = Effect.map(
          readInboxItem(agent.userId, notice.id),
          (read) => Option.getOrThrow(read).item.status,
        );
        yield* later;

        assert.ok(
          Option.isNone(yield* acknowledgeInboxItem(teammate, notice.id, 1, randomUUID())),
          "a nod on what came before settles nothing",
        );
        assert.ok(
          Option.isNone(
            yield* acknowledgeInboxItem(outsider, notice.id, notice.revision, randomUUID()),
          ),
        );
        const messageKey = randomUUID();
        yield* postInboxMessage(teammate, notice.id, { text: "Seen it.", clientKey: messageKey });
        assert.ok(
          Option.isNone(
            yield* acknowledgeInboxItem(teammate, notice.id, notice.revision, messageKey),
          ),
          "a key a message holds names that message, never a nod",
        );
        assert.equal(yield* status, INBOX_STATUS.OPEN);

        const key = randomUUID();
        const nodded = Option.getOrThrow(
          yield* acknowledgeInboxItem(teammate, notice.id, notice.revision, key),
        );
        assert.deepEqual(
          [nodded.status, nodded.answeredBy?.userId, nodded.revision],
          [INBOX_STATUS.ANSWERED, teammate, notice.revision],
        );
        assert.match(nodded.txid ?? "", /^\d+$/u, "the nod is taken in a transaction to wait for");
        assert.ok(
          Option.isNone(yield* acknowledgeInboxItem(teammate, notice.id, notice.revision, key)),
          "the same nod sent again writes nothing",
        );
        assert.ok(
          Option.isNone(
            yield* acknowledgeInboxItem(agent.userId, notice.id, notice.revision, randomUUID()),
          ),
          "a notice nodded to takes no second nod",
        );

        const back = Option.getOrThrow(yield* withdrawInboxAnswer(teammate, notice.id, key));
        assert.deepEqual(
          [back.status, back.answeredBy, back.thread?.length],
          [INBOX_STATUS.OPEN, undefined, 3],
        );
        assert.deepEqual(
          (yield* accountWaitingItems(agent.userId)).map((entry) => entry.id).toSorted(),
          [asking.id, notice.id].toSorted(),
        );
      }),
  );

  it.effect(
    "a member's words on a notice settle it as their nod at the revision they were shown and no other, and taken back for a hand-off that failed leave it waiting again; the agent's withdrawal finds no ask on it",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const notice = posted(
          yield* postInboxThread(agent, {
            key: "preview-up",
            title: "The preview is up",
            body: "It deploys from main.",
          }),
        );
        assert.ok(Option.isNone(yield* closeInboxItem(agent, "preview-up", "No longer needed.")));
        yield* later;

        const stale = Option.getOrThrow(
          yield* postInboxMessage(agent.userId, notice.id, {
            text: "Thanks for the last one.",
            clientKey: randomUUID(),
            revision: notice.revision - 1,
          }),
        );
        assert.equal(
          stale.item.status,
          INBOX_STATUS.OPEN,
          "a reply to what came before settles nothing",
        );
        yield* later;
        const plain = Option.getOrThrow(
          yield* postInboxMessage(agent.userId, notice.id, {
            text: "Hm.",
            clientKey: randomUUID(),
          }),
        );
        assert.equal(
          plain.item.status,
          INBOX_STATUS.OPEN,
          "a reply naming no revision settles nothing",
        );
        yield* later;

        const clientKey = randomUUID();
        const written = Option.getOrThrow(
          yield* postInboxMessage(agent.userId, notice.id, {
            text: "Looks good.",
            clientKey,
            revision: notice.revision,
          }),
        );
        assert.deepEqual(
          [written.item.status, written.item.answeredBy?.userId],
          [INBOX_STATUS.ANSWERED, agent.userId],
        );
        assert.deepEqual(yield* accountWaitingItems(agent.userId), []);

        yield* withdrawInboxMessage(agent.userId, notice.id, clientKey);
        const back = Option.getOrThrow(yield* readInboxItem(agent.userId, notice.id)).item;
        assert.deepEqual(
          [back.status, back.answeredBy, back.thread?.map((message) => message.text)],
          [
            INBOX_STATUS.OPEN,
            undefined,
            ["It deploys from main.", "Thanks for the last one.", "Hm."],
          ],
        );
      }),
  );

  it.effect(
    "an account outside the item's workspace reads none of its thread and answers none of its asks, and a member of it reads both",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const outsider = yield* openUser;
        yield* openWorkspace(outsider);
        const item = posted(yield* postInboxThread(agent, REGION));
        const ask = item.thread?.[0]?.id ?? "";

        assert.ok(Option.isNone(yield* readInboxItem(outsider, item.id)));
        assert.deepEqual(yield* taskInboxItems(outsider, agent.taskId), []);
        const sent = {
          answers: { ask, reply: INBOX_REPLY.CHOSE, choices: ["iad1"] },
          text: "",
          clientKey: randomUUID(),
        };
        assert.ok(Option.isNone(yield* answerInboxAsk(outsider, item.id, sent)));
        assert.equal(
          Option.getOrThrow(yield* readInboxItem(agent.userId, item.id)).item.status,
          INBOX_STATUS.OPEN,
        );

        const [theirs] = yield* taskInboxItems(teammate, agent.taskId);
        assert.deepEqual(theirs?.thread, item.thread);
        const taken = Option.getOrThrow(yield* answerInboxAsk(teammate, item.id, sent));
        assert.equal(taken.outcome, INBOX_ASK_ANSWER.TAKEN);
      }),
  );
});
