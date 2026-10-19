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
  INBOX_BLOCK,
  INBOX_FIELD,
  INBOX_IMAGE_TYPE,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  type InboxImageBlock,
  type InboxItem,
  type InboxPost,
} from "@luke/features/inbox-wire";
import { eq, sql } from "drizzle-orm";
import { DateTime, Duration, Effect, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import {
  accountWaitingItems,
  answerInboxAsk,
  answerInboxItem,
  closeInboxItem,
  INBOX_ASK_ANSWER,
  type InboxPostRefusal,
  postInboxItem,
  postInboxMessage,
  postInboxThread,
  readInboxAttachment,
  readInboxItem,
  replyInboxItem,
  taskInboxItems,
  withdrawInboxAnswer,
} from "../../inbox/inbox-store.js";

/**
 * An inbox item as a thread of messages, through the store's public
 * functions against a real dialect: every post is the agent's message on
 * the thread, the ask it ends with held open and the one before replaced,
 * the item's own fields a view of that ask for a desktop before version 5;
 * a post that asks nothing waits on nobody; the revision moves only with
 * what the agent asks; an older desktop's answer by revision is written as
 * the member's message that answers the open ask, and an answer by the
 * ask's message is checked against it; a read's `messages` leave out what
 * the item's fields stand for while its `thread` carries everything, its
 * first message and its open ask however long it runs; an item from before
 * threads reads as it was written; and an account outside the workspace
 * reads and answers none of it.
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

const COMMIT = "4f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39";

/** The words a post about regions carries. */
const REGION_WORDS = [{ type: INBOX_BLOCK.MARKDOWN, text: "Two regions are free." }] as const;

/** A choice between two regions, as the tool before version 5 posts one. */
const REGION: InboxPost = {
  key: "deploy-region",
  title: "Where should the preview deploy?",
  blocks: REGION_WORDS,
  response: {
    type: INBOX_RESPONSE.CHOICE,
    options: [{ label: "iad1" }, { label: "sfo1", detail: "Closer to the team." }],
    recommended: "iad1",
  },
};

/** A to-do, as the tool before version 5 posts one. */
const SETTINGS: InboxPost = {
  key: "branch-protection",
  title: "Require a review on main",
  response: { type: INBOX_RESPONSE.TODO },
  needsReply: false,
};

/** The ask a `decide` post from version 5 ends with. */
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

/** The words of each message a desktop before version 5 draws. */
function plainWords(item: InboxItem) {
  return item.messages?.map((message) => message.text);
}

/** One second on, so each write after it is the latest. */
const later = TestClock.adjust(Duration.seconds(1));

it.layer(getTestDB())("an inbox item's thread", (it) => {
  it.effect(
    "a post writes the agent's message with the ask it ends with, its blocks as the words, and a post under the same key replaces the ask held open, the item's fields standing for the newest",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const first = posted(
          yield* postInboxItem(agent, {
            ...REGION,
            blocks: [
              ...REGION_WORDS,
              {
                type: INBOX_BLOCK.LINK,
                url: "https://vercel.com/acme/relay/settings",
                label: "Project [settings]",
              },
              {
                type: INBOX_BLOCK.CODE,
                repo: "acme/relay",
                path: "apps/web/vercel.json",
                startLine: 3,
                endLine: 5,
                sha: COMMIT,
              },
            ],
          }),
        );
        const [question] = first.thread ?? [];
        assert.equal(
          question?.text,
          [
            "Two regions are free.",
            "[Project \\[settings\\]](https://vercel.com/acme/relay/settings)",
            `https://github.com/acme/relay/blob/${COMMIT}/apps/web/vercel.json#L3-L5`,
          ].join("\n\n"),
        );
        assert.deepEqual(question?.ask, {
          type: INBOX_ASK.DECIDE,
          options: [{ label: "iad1" }, { label: "sfo1", detail: "Closer to the team." }],
          recommended: "iad1",
          status: INBOX_ASK_STATUS.OPEN,
        });
        assert.deepEqual(
          [first.status, first.revision, first.response, first.messages],
          [INBOX_STATUS.OPEN, 1, REGION.response, undefined],
          "the item stands for the ask as it was posted, and draws no message twice",
        );

        yield* later;
        const second = posted(
          yield* postInboxItem(agent, {
            key: REGION.key,
            title: "Deploy the preview to iad1?",
            response: { type: INBOX_RESPONSE.APPROVAL },
          }),
        );
        assert.deepEqual(asksOf(second), [
          [INBOX_MESSAGE_AUTHOR.AGENT, INBOX_ASK.DECIDE, INBOX_ASK_STATUS.REPLACED],
          [INBOX_MESSAGE_AUTHOR.AGENT, INBOX_ASK.DECIDE, INBOX_ASK_STATUS.OPEN],
        ]);
        assert.deepEqual(second.thread?.[1]?.ask, {
          type: INBOX_ASK.DECIDE,
          options: [
            { label: INBOX_APPROVAL_OPTION.APPROVE },
            { label: INBOX_APPROVAL_OPTION.DECLINE },
          ],
          status: INBOX_ASK_STATUS.OPEN,
        });
        assert.deepEqual(
          [second.title, second.revision, second.response, second.blocks, second.messages],
          ["Deploy the preview to iad1?", 2, { type: INBOX_RESPONSE.APPROVAL }, [], undefined],
        );
      }),
  );

  it.effect(
    "a post that asks nothing replaces the ask held open and waits on nobody: the item stands as a note already settled, its words its message, and no read of what waits counts it",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        posted(yield* postInboxItem(agent, SETTINGS));
        yield* later;

        const note = posted(
          yield* postInboxItem(agent, {
            key: SETTINGS.key,
            title: "The review rule is on",
            blocks: [{ type: INBOX_BLOCK.MARKDOWN, text: "Main now needs one review." }],
            response: { type: INBOX_RESPONSE.NONE },
          }),
        );

        assert.deepEqual(
          [note.status, note.response, note.blocks, note.needsReply, note.revision],
          [INBOX_STATUS.ANSWERED, { type: INBOX_RESPONSE.NONE }, [], false, 2],
        );
        assert.deepEqual([note.answer, note.answeredBy], [undefined, undefined]);
        assert.equal(note.settledAt, note.updatedAt);
        assert.deepEqual(plainWords(note), ["Main now needs one review."]);
        assert.deepEqual(asksOf(note), [
          [INBOX_MESSAGE_AUTHOR.AGENT, INBOX_ASK.DO, INBOX_ASK_STATUS.REPLACED],
          [INBOX_MESSAGE_AUTHOR.AGENT, undefined, undefined],
        ]);
        assert.deepEqual(yield* accountWaitingItems(agent.userId), []);
      }),
  );

  it.effect(
    "the revision moves when the agent asks, asks again, or withdraws, and never for a message on the thread or an answer",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const { id } = posted(yield* postInboxItem(agent, SETTINGS));
        const revision = Effect.map(
          readInboxItem(agent.userId, id),
          (read) => Option.getOrThrow(read).item.revision,
        );
        const answerKey = randomUUID();
        const writes = [
          replyInboxItem(agent, SETTINGS.key, "Still needed."),
          postInboxMessage(agent.userId, id, { text: "On it.", clientKey: randomUUID() }),
          answerInboxItem(agent.userId, id, 1, { reply: INBOX_REPLY.DONE }, answerKey),
          withdrawInboxAnswer(agent.userId, id, answerKey),
          postInboxItem(agent, SETTINGS),
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
    "an older desktop's answer by revision settles the open ask and is written as the member's message that answers it, with its note and files, which `messages` leaves out while `thread` carries it; taken back, the ask is open again",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const { id } = posted(yield* postInboxItem(agent, REGION));
        yield* later;
        yield* replyInboxItem(agent, REGION.key, "Both cost the same.");
        yield* later;
        const answerKey = randomUUID();

        const answered = Option.getOrThrow(
          yield* answerInboxItem(
            teammate,
            id,
            1,
            { reply: INBOX_REPLY.CHOSE, choices: ["sfo1"], note: "Closer to the team." },
            answerKey,
            [attached("trace.txt", TRACE)],
          ),
        );

        const [question, said, answer] = answered.thread ?? [];
        assert.equal(question?.ask?.status, INBOX_ASK_STATUS.ANSWERED);
        assert.equal(said?.text, "Both cost the same.");
        assert.deepEqual(
          [answer?.author, answer?.member?.userId, answer?.text, answer?.answers],
          [
            INBOX_MESSAGE_AUTHOR.MEMBER,
            teammate,
            "Closer to the team.",
            { ask: question?.id, reply: INBOX_REPLY.CHOSE, choices: ["sfo1"] },
          ],
        );
        assert.deepEqual(
          answer?.files?.map((file) => file.name),
          ["trace.txt"],
        );
        assert.deepEqual(answered.answer, {
          reply: INBOX_REPLY.CHOSE,
          choices: ["sfo1"],
          note: "Closer to the team.",
        });
        assert.deepEqual(
          answered.answerFiles,
          answer?.files,
          "the answer's files are its message's",
        );
        assert.deepEqual(plainWords(answered), ["Both cost the same."]);
        assert.deepEqual([answered.status, answered.revision], [INBOX_STATUS.ANSWERED, 1]);

        const withdrawn = Option.getOrThrow(yield* withdrawInboxAnswer(teammate, id, answerKey));
        assert.deepEqual(asksOf(withdrawn), [
          [INBOX_MESSAGE_AUTHOR.AGENT, INBOX_ASK.DECIDE, INBOX_ASK_STATUS.OPEN],
          [INBOX_MESSAGE_AUTHOR.AGENT, undefined, undefined],
        ]);
        assert.deepEqual(
          [withdrawn.status, withdrawn.answer, withdrawn.answerFiles],
          [INBOX_STATUS.OPEN, undefined, undefined],
        );
        const again = Option.getOrThrow(
          yield* answerInboxAsk(teammate, id, {
            answers: { ask: question?.id ?? "", reply: INBOX_REPLY.CHOSE, choices: ["iad1"] },
            text: "",
            clientKey: randomUUID(),
          }),
        );
        assert.equal(again.outcome, INBOX_ASK_ANSWER.TAKEN, "the ask taken back takes an answer");
      }),
  );

  it.effect(
    "an answer to an ask by its message is checked against the ask, taken once under its key with the item answered as its view, and takes nothing once the ask is no longer the one held open",
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
        assert.deepEqual(
          [asked.status, asked.blocks, asked.response],
          [
            INBOX_STATUS.OPEN,
            [{ type: INBOX_BLOCK.MARKDOWN, text: "Two regions are free." }],
            { type: INBOX_RESPONSE.CHOICE, options: DECIDE.options },
          ],
        );
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
          [taken.item.status, taken.item.answer, taken.item.answeredBy?.userId],
          [
            INBOX_STATUS.ANSWERED,
            { reply: INBOX_REPLY.CHOSE, choices: ["sfo1"], note: "Closer to the team." },
            agent.userId,
          ],
        );
        assert.equal((yield* answer(["sfo1"], key)).outcome, INBOX_ASK_ANSWER.REPEATED);

        yield* later;
        const askedAgain = posted(
          yield* postInboxThread(agent, {
            key: "deploy-region",
            title: "Which region for staging?",
            body: "",
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
    "a post from version 5 shows a desktop before it its words as blocks and the response nearest its ask, a to-do's steps listed under the words",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const todo = posted(
          yield* postInboxThread(agent, {
            key: "preview-domain",
            title: "Point the preview's domain",
            body: "The preview needs its own domain.",
            ask: { type: INBOX_ASK.DO, steps: ["Add the CNAME.", "Wait for it to verify."] },
          }),
        );
        const form = posted(
          yield* postInboxThread(agent, {
            key: "preview-budget",
            title: "How much may the preview spend?",
            body: "",
            ask: {
              type: INBOX_ASK.ANSWER,
              fields: [{ type: INBOX_FIELD.NUMBER, label: "Monthly budget", required: true }],
            },
            needsReply: false,
          }),
        );

        assert.deepEqual(
          [todo.response, todo.blocks, todo.needsReply],
          [
            { type: INBOX_RESPONSE.TODO },
            [
              { type: INBOX_BLOCK.MARKDOWN, text: "The preview needs its own domain." },
              { type: INBOX_BLOCK.MARKDOWN, text: "1. Add the CNAME.\n2. Wait for it to verify." },
            ],
            true,
          ],
        );
        assert.deepEqual(
          [form.response, form.blocks, form.needsReply],
          [
            {
              type: INBOX_RESPONSE.FORM,
              fields: [{ type: INBOX_FIELD.NUMBER, label: "Monthly budget", required: true }],
            },
            [],
            false,
          ],
        );
      }),
  );

  it.effect(
    "a post from version 5 that asks nothing is a message on the thread of the item under its key, moving nothing but its last change, and under a new key opens a thread that waits on nobody",
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
          }),
        );
        assert.deepEqual(
          [opened.status, opened.response, opened.blocks, opened.revision],
          [INBOX_STATUS.ANSWERED, { type: INBOX_RESPONSE.NONE }, [], 1],
        );
        assert.deepEqual(plainWords(opened), ["It deploys from main."]);
      }),
  );

  it.effect(
    "a post's pictures are kept as files of its message, its words drawing each by its address under the item, its task's or its agent's, and a line that is a picture alone stands as an image block for a desktop before version 5",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const fromBlocks = posted(
          yield* postInboxItem(
            agent,
            {
              ...SETTINGS,
              blocks: [
                { type: INBOX_BLOCK.MARKDOWN, text: "The rule as it stands:" },
                { type: INBOX_BLOCK.IMAGE, path: "shots/rule.png", alt: "The branch rule" },
              ],
            },
            [{ contentType: INBOX_IMAGE_TYPE.PNG, bytes: SHOT }],
          ),
        );
        const block = fromBlocks.blocks.find(
          (each): each is InboxImageBlock => each.type === INBOX_BLOCK.IMAGE,
        );
        assert.ok(block);
        const [posting] = fromBlocks.thread ?? [];
        assert.deepEqual(picturesIn(posting?.text), [
          {
            itemId: fromBlocks.id,
            attachmentId: block.attachmentId,
            holder: `plan/${agent.taskId}`,
          },
        ]);
        assert.ok(posting?.text.startsWith("The rule as it stands:\n\n![The branch rule]("));
        assert.deepEqual(
          posting?.files?.map((file) => [file.attachmentId, file.name]),
          [[block.attachmentId, "rule.png"]],
        );

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
        assert.deepEqual(asked.blocks, [
          { type: INBOX_BLOCK.MARKDOWN, text: "The page as it was:" },
          { type: INBOX_BLOCK.IMAGE, attachmentId: kept.attachmentId, alt: "The old page" },
          {
            type: INBOX_BLOCK.MARKDOWN,
            text: "Named in code it stays a path: `![x](shots/before.png)`",
          },
        ]);
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
    "a long thread's read keeps its first message and the one whose ask is open beside the latest, and `messages` keeps the latest that neither ask nor answer",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const first = posted(yield* postInboxItem(agent, SETTINGS));
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
          yield* postInboxItem(agent, { ...SETTINGS, title: "Two reviews" }),
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
        const plain = plainWords(read) ?? [];
        assert.deepEqual([plain.length, plain[0], plain.at(-1)], [50, "Note 15", "Note 64"]);
      }),
  );

  it.effect(
    "an item from before threads reads as it was written and takes an answer as its own, and a close from before threads leaves the ask it held reading withdrawn with its reason",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const now = yield* DateTime.nowAsDate;
        const [legacy] = yield* Database.use((db) =>
          db
            .insert(inboxItem)
            .values({
              userId: agent.userId,
              taskId: agent.taskId,
              organizationId: workspaceId,
              agentId: agent.agentId,
              key: REGION.key,
              revision: 3,
              version: 4,
              title: REGION.title,
              blocks: REGION_WORDS,
              response: REGION.response,
              needsReply: true,
              status: INBOX_STATUS.OPEN,
              postedAt: now,
              updatedAt: now,
            })
            .returning({ id: inboxItem.id }),
        );
        assert.ok(legacy);
        yield* Database.use((db) =>
          db.insert(inboxMessage).values({
            itemId: legacy.id,
            author: INBOX_MESSAGE_AUTHOR.MEMBER,
            userId: agent.userId,
            text: "Which is cheaper?",
            createdAt: now,
          }),
        );

        const read = Option.getOrThrow(yield* readInboxItem(agent.userId, legacy.id)).item;
        assert.deepEqual(
          [read.version, read.revision, read.status, read.blocks, read.response],
          [4, 3, INBOX_STATUS.OPEN, REGION_WORDS, REGION.response],
        );
        assert.deepEqual(plainWords(read), ["Which is cheaper?"]);
        assert.deepEqual(read.thread, read.messages);

        yield* later;
        const answered = Option.getOrThrow(
          yield* answerInboxItem(
            agent.userId,
            legacy.id,
            3,
            { reply: INBOX_REPLY.CHOSE, choices: ["iad1"] },
            randomUUID(),
            [attached("trace.txt", TRACE)],
          ),
        );
        assert.deepEqual(
          [answered.status, answered.answer, answered.thread?.length],
          [INBOX_STATUS.ANSWERED, { reply: INBOX_REPLY.CHOSE, choices: ["iad1"] }, 1],
          "an item that held no ask takes the answer as its own, writing no message",
        );
        const [file] = answered.answerFiles ?? [];
        assert.ok(file);
        posted(yield* postInboxItem(agent, REGION));
        assert.ok(
          Option.isNone(yield* readInboxAttachment(agent.userId, legacy.id, file.attachmentId)),
          "a post deletes the files of an answer that answered no ask",
        );

        // As a deployment from before threads closes an item: its row alone, the ask's message untouched.
        const asked = posted(yield* postInboxItem(agent, SETTINGS));
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
    "an account outside the item's workspace reads none of its thread and answers none of its asks, and a member of it reads both",
    () =>
      Effect.gen(function* () {
        const { agent, workspaceId } = yield* openAgentIn;
        const teammate = yield* openUser;
        yield* joinWorkspace(workspaceId, teammate);
        const outsider = yield* openUser;
        yield* openWorkspace(outsider);
        const item = posted(yield* postInboxItem(agent, REGION));
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
