import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  INBOX_BLOCK,
  INBOX_BOUNDS,
  INBOX_FIELD,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
} from "@sidecar/hosted/inbox-wire";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { ACTION_RESULT_STATUS } from "../server/core";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import {
  closeInInbox,
  INBOX_REFUSAL,
  type PostingAgent,
  postToInbox,
  readOwnInbox,
} from "../server/hosted/coder-host/inbox";
import { createCodingAgent } from "../server/hosted/coding-agent-store";
import { answerInboxItem, planInboxItems } from "../server/hosted/inbox-store";
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

/** An account with one plan and one agent started on it, in its repository. */
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
  const agent: PostingAgent = {
    userId,
    planId: plan.id,
    agentId: started.value.agent.id,
    repository: "acme/relay",
  };
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
  response: { type: INBOX_RESPONSE.TASK },
  needsReply: false,
};

/** A form of every field type, one required. */
const CREDENTIALS = {
  key: "smtp",
  title: "SMTP settings for the invitation emails",
  response: {
    type: INBOX_RESPONSE.FORM,
    fields: [
      { type: INBOX_FIELD.TEXT, label: "Host", required: true },
      { type: INBOX_FIELD.NUMBER, label: "Port" },
      { type: INBOX_FIELD.SELECT, label: "Security", options: ["TLS", "STARTTLS"] },
      { type: INBOX_FIELD.BOOLEAN, label: "Verify certificate" },
    ],
  },
};

/** Lines of the agent's own repository at a commit, its name spelled in another case than the agent's. */
const RETRY_LINES = {
  type: INBOX_BLOCK.CODE,
  repo: "Acme/Relay",
  path: "src/invite/send.ts",
  startLine: 40,
  endLine: 58,
  sha: "0123456789abcdef0123456789abcdef01234567",
};

/** A choice about the lines the agent points at. */
const RETRIES = {
  key: "invite-retries",
  title: "Retry a failed invitation email?",
  blocks: [RETRY_LINES],
  response: { type: INBOX_RESPONSE.APPROVAL },
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
              title: QUEUE.title,
              status: INBOX_STATUS.OPEN,
              blocks: QUEUE.blocks,
              response: QUEUE.response,
              needsReply: true,
            },
          ],
        });
        const [first] = yield* planInboxItems(agent.userId, agent.planId);
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
    "every call answers the agent's whole inbox, open first with what each asks, so compaction loses nothing the agent acts on, then answered with the answer, then closed with why",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        yield* postToInbox(agent, input(SETTINGS));
        yield* TestClock.adjust(Duration.seconds(1));
        yield* postToInbox(agent, input(QUEUE));
        yield* TestClock.adjust(Duration.seconds(1));
        yield* postToInbox(
          agent,
          input({ key: "ship", title: "Ship it?", response: { type: INBOX_RESPONSE.APPROVAL } }),
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
              title: QUEUE.title,
              status: INBOX_STATUS.OPEN,
              blocks: QUEUE.blocks,
              response: QUEUE.response,
              needsReply: true,
            },
            {
              key: SETTINGS.key,
              title: SETTINGS.title,
              status: INBOX_STATUS.ANSWERED,
              answer: { reply: INBOX_REPLY.DONE, note: "Done, with two reviewers." },
            },
            {
              key: "ship",
              title: "Ship it?",
              status: INBOX_STATUS.CLOSED,
              closedReason: "The checks failed; not yet.",
            },
          ],
        });
      }),
  );

  it.effect(
    "a form, a link, and an item asking nothing post as the wire's shapes and read back whole, a settled one carrying what it asked no longer",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        yield* postToInbox(agent, input(CREDENTIALS));
        yield* TestClock.adjust(Duration.seconds(1));
        yield* postToInbox(agent, input(SETTINGS));
        yield* TestClock.adjust(Duration.seconds(1));
        const posted = yield* postToInbox(
          agent,
          input({
            key: "renamed",
            title: "The migration renamed the invites table",
            response: { type: INBOX_RESPONSE.NONE },
            needsReply: false,
          }),
        );
        assert.equal(posted.status, ACTION_RESULT_STATUS.ACCEPTED);
        const [fyi, settings, form] = yield* planInboxItems(agent.userId, agent.planId);
        assert.ok(fyi && settings && form);
        assert.deepEqual(fyi.blocks, []);
        assert.deepEqual(fyi.response, { type: INBOX_RESPONSE.NONE });
        assert.deepEqual(settings.blocks, SETTINGS.blocks);
        assert.deepEqual(form.response, CREDENTIALS.response);
        yield* answerInboxItem(
          agent.userId,
          form.id,
          form.revision,
          {
            reply: INBOX_REPLY.SUBMITTED,
            values: [
              { label: "Host", value: "smtp.acme.test" },
              { label: "Port", value: 587 },
              { label: "Verify certificate", value: true },
            ],
          },
          randomUUID(),
        );
        const told = yield* readOwnInbox(agent);
        const lines = told.status === ACTION_RESULT_STATUS.ACCEPTED ? told.inbox : [];
        assert.deepEqual(lines.at(-1), {
          key: CREDENTIALS.key,
          title: CREDENTIALS.title,
          status: INBOX_STATUS.ANSWERED,
          answer: {
            reply: INBOX_REPLY.SUBMITTED,
            values: [
              { label: "Host", value: "smtp.acme.test" },
              { label: "Port", value: 587 },
              { label: "Verify certificate", value: true },
            ],
          },
        });
      }),
  );

  it.effect(
    "a post that does not read, a choice with fewer than two options, two under one label, or recommending none of them, a form naming a field twice or a select with no options, and a close of no item are refused with why, writing nothing",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const refused = (result: { readonly status: string; readonly reason?: string }) =>
          result.status === ACTION_RESULT_STATUS.REJECTED ? result.reason : undefined;
        const asking = (response: WireBoundaryInput) => input({ ...QUEUE, response });
        assert.equal(
          refused(yield* postToInbox(agent, input({ ...QUEUE, key: "Not A Slug" }))),
          INBOX_REFUSAL.UNREADABLE_POST,
        );
        assert.equal(
          refused(
            yield* postToInbox(
              agent,
              input({
                ...SETTINGS,
                blocks: [{ type: INBOX_BLOCK.LINK, url: "ftp://x", label: "x" }],
              }),
            ),
          ),
          INBOX_REFUSAL.UNREADABLE_POST,
          "a link opens on the web alone",
        );
        assert.equal(
          refused(
            yield* postToInbox(
              agent,
              asking({ type: INBOX_RESPONSE.CHOICE, options: [{ label: "Only" }] }),
            ),
          ),
          INBOX_REFUSAL.UNREADABLE_POST,
          "a choice offers two options at least",
        );
        assert.equal(
          refused(
            yield* postToInbox(
              agent,
              asking({
                type: INBOX_RESPONSE.CHOICE,
                options: [{ label: "Same" }, { label: "Same" }],
              }),
            ),
          ),
          INBOX_REFUSAL.NO_OPTIONS,
        );
        assert.equal(
          refused(yield* postToInbox(agent, asking({ ...QUEUE.response, recommended: "SQS" }))),
          INBOX_REFUSAL.UNKNOWN_RECOMMENDATION,
        );
        assert.equal(
          refused(
            yield* postToInbox(
              agent,
              asking({
                type: INBOX_RESPONSE.FORM,
                fields: [
                  { type: INBOX_FIELD.TEXT, label: "Host" },
                  { type: INBOX_FIELD.TEXT, label: "Host" },
                ],
              }),
            ),
          ),
          INBOX_REFUSAL.FIELD_LABELS,
        );
        assert.equal(
          refused(
            yield* postToInbox(
              agent,
              asking({
                type: INBOX_RESPONSE.FORM,
                fields: [{ type: INBOX_FIELD.SELECT, label: "Security" }],
              }),
            ),
          ),
          INBOX_REFUSAL.SELECT_OPTIONS,
        );
        assert.equal(
          refused(yield* closeInInbox(agent, input({ key: "never-posted", reason: "x" }))),
          INBOX_REFUSAL.NO_ITEM,
        );
        assert.deepEqual(yield* planInboxItems(agent.userId, agent.planId), []);
      }),
  );

  it.effect(
    "a code block points at lines of the agent's own repository, named in any case, at a commit; one of another repository, a commit not spelled whole in lowercase, or lines running backwards or past the bound is refused with why, writing nothing",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const refused = (result: { readonly status: string; readonly reason?: string }) =>
          result.status === ACTION_RESULT_STATUS.REJECTED ? result.reason : undefined;
        const pointing = (block: Partial<typeof RETRY_LINES>) =>
          postToInbox(agent, input({ ...RETRIES, blocks: [{ ...RETRY_LINES, ...block }] }));
        assert.equal(
          refused(yield* pointing({ repo: "acme/other" })),
          INBOX_REFUSAL.CODE_REPOSITORY,
        );
        assert.equal(
          refused(yield* pointing({ sha: "0123456" })),
          INBOX_REFUSAL.UNREADABLE_POST,
          "a commit is its whole SHA",
        );
        assert.equal(
          refused(yield* pointing({ sha: RETRY_LINES.sha.toUpperCase() })),
          INBOX_REFUSAL.UNREADABLE_POST,
          "a commit is spelled in lowercase",
        );
        assert.equal(
          refused(yield* pointing({ sha: "main" + "0".repeat(36) })),
          INBOX_REFUSAL.UNREADABLE_POST,
          "a branch's name is no commit",
        );
        assert.equal(
          refused(yield* pointing({ startLine: 58, endLine: 40 })),
          INBOX_REFUSAL.CODE_LINES,
        );
        assert.equal(
          refused(yield* pointing({ startLine: 1, endLine: INBOX_BOUNDS.MAX_CODE_LINES + 1 })),
          INBOX_REFUSAL.CODE_LINES,
        );
        assert.deepEqual(yield* planInboxItems(agent.userId, agent.planId), []);

        const lastLine = INBOX_BOUNDS.MAX_CODE_LINES;
        const posted = yield* pointing({ startLine: 1, endLine: lastLine });
        assert.equal(posted.status, ACTION_RESULT_STATUS.ACCEPTED);
        const [item] = yield* planInboxItems(agent.userId, agent.planId);
        assert.deepEqual(item?.blocks, [{ ...RETRY_LINES, startLine: 1, endLine: lastLine }]);
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
