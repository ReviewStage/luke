import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, startTask } from "@luke/database/testing";
import { CODING_AGENT_ATTACHMENT_TYPE } from "@luke/features/coding-agent-wire";
import {
  INBOX_BLOCK,
  INBOX_IMAGE_TYPE,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
} from "@luke/features/inbox-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { ACTION_RESULT_STATUS } from "../../core.js";
import {
  answerInboxItem,
  postInboxMessage,
  readInboxAttachment,
  taskInboxItems,
} from "../../inbox/inbox-store.js";
import { CODER } from "./bounds.js";
import {
  closeInInbox,
  INBOX_REFUSAL,
  type PostingAgent,
  postToInbox,
  readOwnInbox,
  replyInInbox,
} from "./inbox.js";
import type { InboxSandboxDoor } from "./inbox-image.js";

/**
 * The coding agent's inbox tools, through their public functions against a
 * real dialect: a post under a key is one item the task's inbox reads, a
 * post under the same key replaces it and opens it again, a close takes it
 * back with why, a read answers the agent's items open first, and every
 * call answers the agent's whole inbox, answers and all. Nothing of
 * another account's agent is read or written.
 *
 * Synthetic accounts, tasks, and words throughout.
 */

const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** An account with one task and one agent started on it, in its repository. */
const openAgent = Effect.gen(function* () {
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
  const agent = {
    userId,
    taskId: task.id,
    agentId: started.value.agent.id,
    repository: "acme/relay",
  } satisfies PostingAgent;
  return agent;
});

const QUEUE = {
  key: "invite-queue",
  title: "Which queue sends the invitation emails?",
  blocks: [{ type: INBOX_BLOCK.MARKDOWN, text: "The repo already runs **Postgres**." }],
  response: {
    type: INBOX_RESPONSE.CHOICE,
    options: [{ label: "Postgres outbox", detail: "No new service." }, { label: "Redis" }],
    recommended: "Postgres outbox",
  },
};

const SETTINGS = {
  key: "branch-protection",
  title: "Require a review on main",
  blocks: [
    { type: INBOX_BLOCK.MARKDOWN, text: "Settings → Branches → add a rule for `main`." },
    {
      type: INBOX_BLOCK.LINK,
      url: "https://github.com/acme/relay/settings/branches",
      label: "Branch rules",
    },
  ],
  response: { type: INBOX_RESPONSE.TODO },
  needsReply: false,
};

/** A tool's input as eve hands it over. */
const input = (value: WireBoundaryInput) => unparsedWire(value);

/** A sandbox door no post with words alone opens: one that fails if it is. */
const noSandbox: InboxSandboxDoor = () => Promise.reject(new Error("the sandbox was opened"));

/** A sandbox holding the files given by their path from the checkout, each read as one stream. */
function sandboxWith(files: Readonly<Record<string, Uint8Array>>): InboxSandboxDoor {
  const byPath = new Map(
    Object.entries(files).map(([path, bytes]) => [posix.resolve(CODER.CHECKOUT_PATH, path), bytes]),
  );
  return () =>
    Promise.resolve({
      readFile: ({ path }: { path: string }) => {
        const bytes = byPath.get(path);
        if (bytes === undefined) return Promise.resolve(null);
        return Promise.resolve(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
        );
      },
    });
}

/** The first bytes of a PNG, as a screenshot's file starts. */
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

/** A post run as the tool runs one, over the sandbox given. */
const post = (agent: PostingAgent, value: ReturnType<typeof input>, sandbox = noSandbox) =>
  postToInbox(agent, value, sandbox);

it.layer(getTestDB())("the coding agent's inbox", (it) => {
  it.effect(
    "a post is one open item the plan's inbox reads; posting under the same key again replaces it, moves its revision on, and opens it again once answered",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const posted = yield* post(agent, input(QUEUE));
        assert.deepEqual(posted, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          inbox: [
            {
              key: QUEUE.key,
              title: QUEUE.title,
              status: INBOX_STATUS.OPEN,
              blocks: QUEUE.blocks,
              response: QUEUE.response,
              needsReply: true,
            },
          ],
        });
        const [first] = yield* taskInboxItems(agent.userId, agent.taskId);
        assert.ok(first);
        assert.equal(first.revision, 1);
        assert.equal(first.needsReply, true, "an item asks to be heard back unless it says not");
        assert.deepEqual(first.response, QUEUE.response);

        const taken = yield* answerInboxItem(
          agent.userId,
          first.id,
          1,
          { reply: INBOX_REPLY.CHOSE, choices: ["Redis"] },
          randomUUID(),
        );
        assert.equal(Option.getOrUndefined(taken)?.status, INBOX_STATUS.ANSWERED);

        yield* TestClock.adjust(Duration.seconds(1));
        yield* post(agent, input({ ...QUEUE, title: "Which queue, now that Redis is gone?" }));
        const items = yield* taskInboxItems(agent.userId, agent.taskId);
        assert.equal(items.length, 1, "one item per key");
        assert.equal(items[0]?.id, first.id);
        assert.equal(items[0]?.revision, 2);
        assert.equal(items[0]?.status, INBOX_STATUS.OPEN);
        assert.equal(items[0]?.answer, undefined);
        assert.equal(items[0]?.title, "Which queue, now that Redis is gone?");
      }),
  );

  it.effect(
    "an answer is taken only at the revision it names and only while the item is open, and another account's answer finds nothing",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const other = yield* openUser;
        yield* post(agent, input(SETTINGS));
        const [item] = yield* taskInboxItems(agent.userId, agent.taskId);
        assert.ok(item);
        const done = { reply: INBOX_REPLY.DONE } as const;
        assert.ok(Option.isNone(yield* answerInboxItem(other, item.id, 1, done, randomUUID())));
        assert.ok(
          Option.isNone(yield* answerInboxItem(agent.userId, item.id, 2, done, randomUUID())),
        );
        yield* closeInInbox(agent, input({ key: SETTINGS.key, reason: "Did it myself." }));
        assert.ok(
          Option.isNone(yield* answerInboxItem(agent.userId, item.id, 2, done, randomUUID())),
          "a closed item takes no answer",
        );
        assert.deepEqual(yield* taskInboxItems(other, agent.taskId), []);
      }),
  );

  it.effect("the agent reads back by name which files an answer carried", () =>
    Effect.gen(function* () {
      const agent = yield* openAgent;
      yield* post(agent, input(SETTINGS));
      const [item] = yield* taskInboxItems(agent.userId, agent.taskId);
      assert.ok(item);
      const file = (name: string) => ({
        name,
        mediaType: CODING_AGENT_ATTACHMENT_TYPE.TEXT,
        data: Buffer.from(`${name}\n`).toString("base64"),
      });
      yield* answerInboxItem(agent.userId, item.id, 1, { reply: INBOX_REPLY.DONE }, randomUUID(), [
        file("rule.txt"),
        file("audit.txt"),
      ]);

      const read = yield* readOwnInbox(agent);
      assert.equal(read.status, ACTION_RESULT_STATUS.ACCEPTED);
      assert.deepEqual(
        read.inbox?.map((line) => [line.key, line.answerFiles]),
        [[SETTINGS.key, ["rule.txt", "audit.txt"]]],
      );
    }),
  );
  it.effect(
    "the agent reads every item's thread in order, a member's message by the member's name and its own as yours, its files by name",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        yield* post(agent, input(SETTINGS));
        const [item] = yield* taskInboxItems(agent.userId, agent.taskId);
        assert.ok(item);
        yield* answerInboxItem(agent.userId, item.id, 1, { reply: INBOX_REPLY.DONE }, randomUUID());
        yield* TestClock.adjust(Duration.seconds(1));
        yield* postInboxMessage(agent.userId, item.id, {
          text: "Also on the release branch, please.",
          clientKey: randomUUID(),
          files: [
            {
              name: "rules.txt",
              mediaType: CODING_AGENT_ATTACHMENT_TYPE.TEXT,
              data: Buffer.from("main, release\n").toString("base64"),
            },
          ],
        });
        yield* TestClock.adjust(Duration.seconds(1));
        yield* replyInInbox(agent, input({ key: SETTINGS.key, text: "Will do." }), noSandbox);

        const read = yield* readOwnInbox(agent);

        assert.equal(read.status, ACTION_RESULT_STATUS.ACCEPTED);
        assert.deepEqual(
          read.inbox?.map((line) => [line.key, line.status, line.thread]),
          [
            [
              SETTINGS.key,
              INBOX_STATUS.ANSWERED,
              [
                {
                  from: "Test User",
                  text: "Also on the release branch, please.",
                  files: ["rules.txt"],
                },
                { from: "you", text: "Will do." },
              ],
            ],
          ],
        );
      }),
  );

  it.effect(
    "a reply writes the agent's message on its own item by key, with the pictures it names read from its sandbox, leaving the status, the answer, and the revision and moving the item; one naming no item of its, carrying nothing, or naming a file that is no picture is refused and writes nothing",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const other = yield* openAgent;
        yield* post(agent, input(QUEUE));
        const [asked] = yield* taskInboxItems(agent.userId, agent.taskId);
        assert.ok(asked);
        const answered = Option.getOrThrow(
          yield* answerInboxItem(
            agent.userId,
            asked.id,
            1,
            { reply: INBOX_REPLY.CHOSE, choices: ["Postgres outbox"] },
            randomUUID(),
          ),
        );
        yield* TestClock.adjust(Duration.seconds(1));
        const sandbox = sandboxWith({
          "shots/outbox.png": PNG,
          "notes.txt": new TextEncoder().encode("no"),
        });

        const replied = yield* replyInInbox(
          agent,
          input({
            key: QUEUE.key,
            text: "Done: the outbox runs. See [@outbox.ts](https://github.com/acme/relay/blob/HEAD/outbox.ts).",
            images: [{ path: "shots/outbox.png" }],
          }),
          sandbox,
        );

        assert.equal(replied.status, ACTION_RESULT_STATUS.ACCEPTED);
        const [item] = yield* taskInboxItems(agent.userId, agent.taskId);
        assert.ok(item);
        assert.deepEqual(
          [item.status, item.revision, item.answer, item.settledAt],
          [answered.status, answered.revision, answered.answer, answered.settledAt],
        );
        assert.ok(item.updatedAt > answered.updatedAt, "a reply moves the item to the top");
        const [message] = item.messages ?? [];
        assert.equal(message?.author, INBOX_MESSAGE_AUTHOR.AGENT);
        assert.equal(message?.member, undefined);
        assert.ok(
          message?.text.includes("[@outbox.ts](https://github.com/acme/relay/blob/HEAD/outbox.ts)"),
        );
        assert.deepEqual(
          message?.files?.map((file) => [file.name, file.mediaType]),
          [["outbox.png", INBOX_IMAGE_TYPE.PNG]],
        );
        const picture = message?.files?.[0]?.attachmentId ?? "";
        const kept = yield* readInboxAttachment(agent.userId, item.id, picture);
        assert.deepEqual(new Uint8Array(Option.getOrThrow(kept).bytes), PNG);

        const refusals = [
          [other, { key: QUEUE.key, text: "Not mine." }, INBOX_REFUSAL.NO_REPLY_ITEM],
          [agent, { key: "no-such-item", text: "Hello." }, INBOX_REFUSAL.NO_REPLY_ITEM],
          [agent, { key: QUEUE.key, text: "  " }, INBOX_REFUSAL.UNREADABLE_REPLY],
          [agent, { key: QUEUE.key, text: "See.", images: [{ path: "notes.txt" }] }, undefined],
        ] as const;
        for (const [who, value, reason] of refusals) {
          const refused = yield* replyInInbox(who, input(value), sandbox);
          assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
          if (reason !== undefined && refused.status === ACTION_RESULT_STATUS.REJECTED) {
            assert.equal(refused.reason, reason);
          }
        }
        const [after] = yield* taskInboxItems(agent.userId, agent.taskId);
        assert.equal(after?.messages?.length, 1, "a refused reply writes nothing");
      }),
  );
});
