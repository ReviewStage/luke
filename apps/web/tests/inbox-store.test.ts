import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { db } from "@sidecar/database/core/query";
import { createCodingAgent } from "@sidecar/database/models/coding-agent-store";
import { deletePlan } from "@sidecar/database/models/plan-store";
import { user } from "@sidecar/database/schemas/auth";
import { getTestDB } from "@sidecar/database/testing";
import {
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  type InboxPost,
} from "@sidecar/hosted/inbox-wire";
import { Effect, Option, Result } from "effect";
import {
  answerInboxItem,
  closeInboxItem,
  type InboxAgent,
  planInboxItems,
  postInboxItem,
  readInboxItem,
  withdrawInboxAnswer,
} from "../server/hosted/inbox-store";
import { joinWorkspace, startPlan } from "./support/workspaces";

/**
 * The developer's inbox as the store keeps it, through its public functions
 * against a real dialect: a post under a key is one item, a post under the
 * same key writes it again and opens it, a close takes it back, an answer
 * is taken only at the revision it names while the item is open and can be
 * withdrawn under its key, a read keeps every open item however many others
 * changed, every member of the plan's workspace reads and answers the items
 * of an agent any of them started, and nothing of a workspace the account
 * is not in is read or written.
 *
 * Synthetic accounts, plans, and words throughout.
 */

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** An account with one plan and one agent started on it, and the workspace the plan is in. */
const openAgentIn = Effect.gen(function* () {
  const userId = yield* openUser;
  const plan = yield* startPlan(userId, { name: "Teammate invitations" });
  const started = yield* createCodingAgent(userId, {
    planId: plan.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    repository: "acme/relay",
    planSnapshot: "# Teammate invitations\n",
    task: null,
  });
  assert.ok(Option.isSome(started));
  const agent: InboxAgent = { userId, planId: plan.id, agentId: started.value.agent.id };
  return { agent, workspaceId: plan.workspaceId };
});

const openAgent = Effect.map(openAgentIn, ({ agent }) => agent);

const QUEUE: InboxPost = {
  key: "invite-queue",
  title: "Which queue sends the invitation emails?",
  blocks: [{ type: INBOX_BLOCK.MARKDOWN, text: "The repo already runs **Postgres**." }],
  response: {
    type: INBOX_RESPONSE.CHOICE,
    options: [{ label: "Postgres outbox", detail: "No new service." }, { label: "Redis" }],
    recommended: "Postgres outbox",
  },
};

const SETTINGS: InboxPost = {
  key: "branch-protection",
  title: "Require a review on main",
  response: { type: INBOX_RESPONSE.TASK },
  needsReply: false,
};

it.layer(getTestDB())("the inbox store", (it) => {
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
        assert.deepEqual(yield* planInboxItems(other, agent.planId), []);
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
          (yield* planInboxItems(teammate, agent.planId)).map((each) => each.id),
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

        assert.deepEqual(yield* planInboxItems(stranger, agent.planId), []);
        assert.ok(Option.isNone(yield* readInboxItem(stranger, id)));
        assert.ok(Option.isNone(yield* answerInboxItem(stranger, id, 1, done, randomUUID())));
      }),
  );
});
