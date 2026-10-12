import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { INBOX_BOUNDS, INBOX_KIND, INBOX_REPLY, INBOX_STATUS } from "@sidecar/hosted/inbox-wire";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { ACTION_RESULT_STATUS } from "../server/core";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import {
  closeInInbox,
  INBOX_REFUSAL,
  postToInbox,
  readOwnInbox,
} from "../server/hosted/coder-host/inbox";
import { createCodingAgent } from "../server/hosted/coding-agent-store";
import { answerInboxItem, type InboxAgent, planInboxItems } from "../server/hosted/inbox-store";
import { createPlan, deletePlan } from "../server/hosted/plan-store";
import { testSqlClient } from "./support/sql-client";

/**
 * The coding agent's inbox tools, through their public functions against a
 * real dialect: a post under a key is one item the plan's inbox reads, a
 * post under the same key replaces it and opens it again, a close takes it
 * back with why, a read answers the agent's items open first, and every
 * call answers the agent's whole inbox, answers and all. Nothing of
 * another account's agent is read or written.
 *
 * Synthetic accounts, plans, and words throughout.
 */

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** An account with one plan and one agent started on it. */
const openAgent = Effect.gen(function* () {
  const userId = yield* openUser;
  const plan = yield* createPlan(userId, { name: "Teammate invitations" });
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
  return agent;
});

const QUEUE = {
  key: "invite-queue",
  kind: INBOX_KIND.CHOICE,
  title: "Which queue sends the invitation emails?",
  details: "The repo already runs **Postgres**.",
  options: [{ label: "Postgres outbox", detail: "No new service." }, { label: "Redis" }],
  recommended: "Postgres outbox",
};

const SETTINGS = {
  key: "branch-protection",
  kind: INBOX_KIND.TASK,
  title: "Require a review on main",
  details: "Settings → Branches → add a rule for `main`.",
  needsReply: false,
};

/** A tool's input as eve hands it over. */
const input = (value: WireBoundaryInput) => unparsedWire(value);

it.layer(testSqlClient)("the coding agent's inbox", (it) => {
  it.effect(
    "a post is one open item the plan's inbox reads; posting under the same key again replaces it, moves its revision on, and opens it again once answered",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const posted = yield* postToInbox(agent, input(QUEUE));
        assert.deepEqual(posted, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          inbox: [
            {
              key: QUEUE.key,
              kind: INBOX_KIND.CHOICE,
              title: QUEUE.title,
              status: INBOX_STATUS.OPEN,
            },
          ],
        });
        const [first] = yield* planInboxItems(agent.userId, agent.planId);
        assert.ok(first);
        assert.equal(first.revision, 1);
        assert.equal(first.needsReply, true, "an item asks to be heard back unless it says not");
        assert.deepEqual(first.options, QUEUE.options);

        const taken = yield* answerInboxItem(
          agent.userId,
          first.id,
          1,
          { reply: INBOX_REPLY.CHOSE, choice: "Redis" },
          randomUUID(),
        );
        assert.equal(Option.getOrUndefined(taken)?.status, INBOX_STATUS.ANSWERED);

        yield* TestClock.adjust(Duration.seconds(1));
        yield* postToInbox(
          agent,
          input({ ...QUEUE, title: "Which queue, now that Redis is gone?" }),
        );
        const items = yield* planInboxItems(agent.userId, agent.planId);
        assert.equal(items.length, 1, "one item per key");
        assert.equal(items[0]?.id, first.id);
        assert.equal(items[0]?.revision, 2);
        assert.equal(items[0]?.status, INBOX_STATUS.OPEN);
        assert.equal(items[0]?.answer, undefined);
        assert.equal(items[0]?.title, "Which queue, now that Redis is gone?");
      }),
  );

  it.effect(
    "every call answers the agent's whole inbox, open first, then answered with the answer, then closed with why",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        yield* postToInbox(agent, input(SETTINGS));
        yield* TestClock.adjust(Duration.seconds(1));
        yield* postToInbox(agent, input(QUEUE));
        yield* TestClock.adjust(Duration.seconds(1));
        yield* postToInbox(
          agent,
          input({ key: "ship", kind: INBOX_KIND.APPROVAL, title: "Ship it?" }),
        );
        const [ship, , settings] = yield* planInboxItems(agent.userId, agent.planId);
        assert.ok(ship && settings);
        yield* answerInboxItem(
          agent.userId,
          settings.id,
          settings.revision,
          { reply: INBOX_REPLY.DONE, note: "Done, with two reviewers." },
          randomUUID(),
        );
        yield* closeInInbox(agent, input({ key: "ship", reason: "The checks failed; not yet." }));

        assert.deepEqual(yield* readOwnInbox(agent), {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          inbox: [
            {
              key: QUEUE.key,
              kind: INBOX_KIND.CHOICE,
              title: QUEUE.title,
              status: INBOX_STATUS.OPEN,
            },
            {
              key: SETTINGS.key,
              kind: INBOX_KIND.TASK,
              title: SETTINGS.title,
              status: INBOX_STATUS.ANSWERED,
              answer: { reply: INBOX_REPLY.DONE, note: "Done, with two reviewers." },
            },
            {
              key: "ship",
              kind: INBOX_KIND.APPROVAL,
              title: "Ship it?",
              status: INBOX_STATUS.CLOSED,
              closedReason: "The checks failed; not yet.",
            },
          ],
        });
      }),
  );

  it.effect(
    "a post that does not read, a choice with fewer than two options or recommending none of them, and a close of no item are refused with why, writing nothing",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const refused = (result: { readonly status: string; readonly reason?: string }) =>
          result.status === ACTION_RESULT_STATUS.REJECTED ? result.reason : undefined;
        assert.equal(
          refused(yield* postToInbox(agent, input({ ...QUEUE, key: "Not A Slug" }))),
          INBOX_REFUSAL.UNREADABLE_POST,
        );
        assert.equal(
          refused(yield* postToInbox(agent, input({ ...QUEUE, options: [{ label: "Only" }] }))),
          INBOX_REFUSAL.NO_OPTIONS,
        );
        assert.equal(
          refused(yield* postToInbox(agent, input({ ...QUEUE, recommended: "SQS" }))),
          INBOX_REFUSAL.UNKNOWN_RECOMMENDATION,
        );
        assert.equal(
          refused(yield* closeInInbox(agent, input({ key: "never-posted", reason: "x" }))),
          INBOX_REFUSAL.NO_ITEM,
        );
        assert.deepEqual(yield* planInboxItems(agent.userId, agent.planId), []);
      }),
  );

  it.effect(
    "an agent holds at most so many open items, though it may post again under a key it holds and post once it closed one",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        for (let index = 0; index < INBOX_BOUNDS.MAX_OPEN_PER_AGENT; index += 1) {
          const posted = yield* postToInbox(agent, input({ ...SETTINGS, key: `task-${index}` }));
          assert.equal(posted.status, ACTION_RESULT_STATUS.ACCEPTED);
        }
        const over = yield* postToInbox(agent, input({ ...SETTINGS, key: "one-more" }));
        assert.deepEqual(over, {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: INBOX_REFUSAL.TOO_MANY,
        });
        const again = yield* postToInbox(
          agent,
          input({ ...SETTINGS, key: "task-0", title: "New" }),
        );
        assert.equal(again.status, ACTION_RESULT_STATUS.ACCEPTED);
        yield* closeInInbox(agent, input({ key: "task-1", reason: "Not needed." }));
        const room = yield* postToInbox(agent, input({ ...SETTINGS, key: "one-more" }));
        assert.equal(room.status, ACTION_RESULT_STATUS.ACCEPTED);
      }),
  );

  it.effect(
    "an answer is taken only at the revision it names and only while the item is open, and another account's answer finds nothing",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const other = yield* openUser;
        yield* postToInbox(agent, input(SETTINGS));
        const [item] = yield* planInboxItems(agent.userId, agent.planId);
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
        assert.deepEqual(yield* planInboxItems(other, agent.planId), []);
      }),
  );

  it.effect(
    "an item left open stays in the plan's inbox and in the agent's own read however many others changed after it, while the settled ones each read carries are bounded",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        yield* postToInbox(agent, input(SETTINGS));
        for (let index = 0; index <= INBOX_BOUNDS.MAX_ITEMS_READ; index += 1) {
          yield* TestClock.adjust(Duration.millis(1));
          yield* postToInbox(agent, input({ ...QUEUE, key: `queue-${index}` }));
          yield* closeInInbox(agent, input({ key: `queue-${index}`, reason: "Settled." }));
        }
        const items = yield* planInboxItems(agent.userId, agent.planId);
        assert.ok(
          items.some((each) => each.key === SETTINGS.key && each.status === INBOX_STATUS.OPEN),
        );
        assert.equal(items.length, 1 + INBOX_BOUNDS.MAX_ITEMS_READ);
        // The agent's own read keeps its open item too, beside only the latest few settled.
        const told = yield* readOwnInbox(agent);
        const lines = told.status === ACTION_RESULT_STATUS.ACCEPTED ? told.inbox : [];
        assert.equal(lines[0]?.key, SETTINGS.key);
        assert.equal(lines.length, 1 + INBOX_BOUNDS.MAX_SETTLED_TOLD);
      }),
  );

  it.effect("a plan's items go with the plan", () =>
    Effect.gen(function* () {
      const agent = yield* openAgent;
      yield* postToInbox(agent, input(SETTINGS));
      yield* deletePlan(agent.userId, agent.planId);
      assert.deepEqual(yield* planInboxItems(agent.userId, agent.planId), []);
    }),
  );
});
