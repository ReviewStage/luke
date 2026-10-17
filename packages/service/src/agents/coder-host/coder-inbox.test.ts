import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, startTask } from "@luke/database/testing";
import { INBOX_BLOCK, INBOX_REPLY, INBOX_RESPONSE, INBOX_STATUS } from "@luke/features/inbox-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { ACTION_RESULT_STATUS } from "../../core.js";
import { answerInboxItem, taskInboxItems } from "../../inbox/inbox-store.js";
import { closeInInbox, type PostingAgent, postToInbox } from "./inbox.js";
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
});
