import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { db } from "@sidecar/database/core/query";
import { user } from "@sidecar/database/schemas/auth";
import { inboxAttachment } from "@sidecar/database/schemas/inbox-attachment";
import { getTestDB } from "@sidecar/database/testing";
import {
  INBOX_BLOCK,
  INBOX_BOUNDS,
  INBOX_FIELD,
  INBOX_IMAGE_TYPE,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  type InboxImageBlock,
} from "@sidecar/hosted/inbox-wire";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { eq } from "drizzle-orm";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { ACTION_RESULT_STATUS } from "../server/core";
import {
  closeInInbox,
  INBOX_REFUSAL,
  type PostingAgent,
  postToInbox,
  readOwnInbox,
} from "../server/hosted/coder-host/inbox";
import {
  INBOX_IMAGE_REFUSAL,
  type InboxSandboxDoor,
} from "../server/hosted/coder-host/inbox-image";
import { createCodingAgent } from "../server/hosted/coding-agent-store";
import { answerInboxItem, planInboxItems, readInboxAttachment } from "../server/hosted/inbox-store";
import { createPlan, deletePlan } from "../server/hosted/plan-store";

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

/** A sandbox door no post with words alone opens: one that fails if it is. */
const noSandbox: InboxSandboxDoor = () => Promise.reject(new Error("the sandbox was opened"));

/** A post run as the tool runs one, over the sandbox given. */
const post = (agent: PostingAgent, value: ReturnType<typeof input>, sandbox = noSandbox) =>
  postToInbox(agent, value, sandbox);

/** The first bytes of each image type, as a file of it starts, followed by what a screenshot's would be. */
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
]);

/** A sandbox holding the files given by absolute path, each read as a stream in chunks of the size given, and recording every path asked for. */
function sandboxWith(files: Readonly<Record<string, Uint8Array>>, chunk = 4) {
  const reads: string[] = [];
  const door: InboxSandboxDoor = () =>
    Promise.resolve({
      readFile: ({ path }: { path: string }) => {
        reads.push(path);
        const bytes = files[path];
        if (bytes === undefined) return Promise.resolve(null);
        let at = 0;
        return Promise.resolve(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (at >= bytes.byteLength) {
                controller.close();
                return;
              }
              controller.enqueue(bytes.subarray(at, at + chunk));
              at += chunk;
            },
          }),
        );
      },
    });
  return { door, reads };
}

/** An item with a screenshot the agent took, asking whether it reads right. */
const SHOT = {
  key: "landing",
  title: "Does the landing page read right?",
  blocks: [
    { type: INBOX_BLOCK.MARKDOWN, text: "Rendered at 1280 wide." },
    { type: INBOX_BLOCK.IMAGE, path: "shots/landing.png", alt: "The landing page at 1280 wide" },
  ],
  response: { type: INBOX_RESPONSE.APPROVAL },
};

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
        yield* post(agent, input({ ...QUEUE, title: "Which queue, now that Redis is gone?" }));
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
        yield* post(agent, input(SETTINGS));
        yield* TestClock.adjust(Duration.seconds(1));
        yield* post(agent, input(QUEUE));
        yield* TestClock.adjust(Duration.seconds(1));
        yield* post(
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
        yield* post(agent, input(CREDENTIALS));
        yield* TestClock.adjust(Duration.seconds(1));
        yield* post(agent, input(SETTINGS));
        yield* TestClock.adjust(Duration.seconds(1));
        const posted = yield* post(
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
          refused(yield* post(agent, input({ ...QUEUE, key: "Not A Slug" }))),
          INBOX_REFUSAL.UNREADABLE_POST,
        );
        assert.equal(
          refused(
            yield* post(
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
            yield* post(
              agent,
              asking({ type: INBOX_RESPONSE.CHOICE, options: [{ label: "Only" }] }),
            ),
          ),
          INBOX_REFUSAL.UNREADABLE_POST,
          "a choice offers two options at least",
        );
        assert.equal(
          refused(
            yield* post(
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
          refused(yield* post(agent, asking({ ...QUEUE.response, recommended: "SQS" }))),
          INBOX_REFUSAL.UNKNOWN_RECOMMENDATION,
        );
        assert.equal(
          refused(
            yield* post(
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
            yield* post(
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
          post(agent, input({ ...RETRIES, blocks: [{ ...RETRY_LINES, ...block }] }));
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
          const posted = yield* post(agent, input({ ...SETTINGS, key: `task-${index}` }));
          assert.equal(posted.status, ACTION_RESULT_STATUS.ACCEPTED);
        }
        const over = yield* post(agent, input({ ...SETTINGS, key: "one-more" }));
        assert.deepEqual(over, {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: INBOX_REFUSAL.TOO_MANY,
        });
        const again = yield* post(agent, input({ ...SETTINGS, key: "task-0", title: "New" }));
        assert.equal(again.status, ACTION_RESULT_STATUS.ACCEPTED);
        yield* closeInInbox(agent, input({ key: "task-1", reason: "Not needed." }));
        const room = yield* post(agent, input({ ...SETTINGS, key: "one-more" }));
        assert.equal(room.status, ACTION_RESULT_STATUS.ACCEPTED);
      }),
  );

  it.effect(
    "an answer is taken only at the revision it names and only while the item is open, and another account's answer finds nothing",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const other = yield* openUser;
        yield* post(agent, input(SETTINGS));
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
        yield* post(agent, input(SETTINGS));
        for (let index = 0; index <= INBOX_BOUNDS.MAX_ITEMS_READ; index += 1) {
          yield* TestClock.adjust(Duration.millis(1));
          yield* post(agent, input({ ...QUEUE, key: `queue-${index}` }));
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
      yield* post(agent, input(SETTINGS));
      yield* deletePlan(agent.userId, agent.planId);
      assert.deepEqual(yield* planInboxItems(agent.userId, agent.planId), []);
    }),
  );

  const CHECKOUT_SHOT = "/workspace/repository/shots/landing.png";

  /** The one image block of the agent's open item, as the plan's inbox reads it. */
  const imageBlockOf = (agent: PostingAgent) =>
    Effect.map(planInboxItems(agent.userId, agent.planId), (items) => {
      const block = items[0]?.blocks.find(
        (each): each is InboxImageBlock => each.type === INBOX_BLOCK.IMAGE,
      );
      assert.ok(block, "the item carries an image block");
      return { itemId: items[0]?.id ?? "", block };
    });

  it.effect(
    "a post with an image block reads the file from the sandbox at its path resolved from the checkout, keeps it as the item's attachment under the type its bytes say, and names the attachment in the block; posted again, the pictures the item no longer names are deleted",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const { door, reads } = sandboxWith({ [CHECKOUT_SHOT]: PNG, "/tmp/shot.jpg": JPEG });
        const posted = yield* post(agent, input(SHOT), door);
        assert.equal(posted.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(posted));
        assert.deepEqual(reads, [CHECKOUT_SHOT]);
        const first = yield* imageBlockOf(agent);
        assert.equal(first.block.alt, "The landing page at 1280 wide");
        assert.ok(
          !("path" in first.block),
          "the path the agent wrote is kept nowhere the desktop reads",
        );
        const kept = yield* readInboxAttachment(
          agent.userId,
          first.itemId,
          first.block.attachmentId,
        );
        assert.ok(Option.isSome(kept));
        assert.equal(kept.value.contentType, INBOX_IMAGE_TYPE.PNG);
        assert.deepEqual(Uint8Array.from(kept.value.bytes), PNG);
        assert.ok(
          Option.isNone(
            yield* readInboxAttachment("user-other", first.itemId, first.block.attachmentId),
          ),
          "another account reads nothing",
        );
        assert.ok(
          Option.isNone(
            yield* readInboxAttachment(agent.userId, randomUUID(), first.block.attachmentId),
          ),
          "an attachment is read under its own item alone",
        );

        yield* TestClock.adjust(Duration.seconds(1));
        const again = yield* post(
          agent,
          input({
            ...SHOT,
            blocks: [
              { type: INBOX_BLOCK.IMAGE, path: "/tmp/shot.jpg", alt: "The same page, mobile" },
            ],
          }),
          door,
        );
        assert.equal(again.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(again));
        const second = yield* imageBlockOf(agent);
        assert.equal(second.itemId, first.itemId, "one item per key");
        assert.notEqual(second.block.attachmentId, first.block.attachmentId);
        assert.ok(
          Option.isNone(
            yield* readInboxAttachment(agent.userId, first.itemId, first.block.attachmentId),
          ),
          "the picture the item no longer names is gone",
        );
        const replaced = yield* readInboxAttachment(
          agent.userId,
          second.itemId,
          second.block.attachmentId,
        );
        assert.equal(Option.getOrUndefined(replaced)?.contentType, INBOX_IMAGE_TYPE.JPEG);

        yield* post(agent, input({ ...SHOT, blocks: [] }));
        const rows = yield* db
          .select({ id: inboxAttachment.id })
          .from(inboxAttachment)
          .where(eq(inboxAttachment.itemId, first.itemId));
        assert.deepEqual(rows, [], "an item posted without pictures keeps none");
      }),
  );

  it.effect(
    "an image block is refused, the post with it, naming the path, where the file is not there, is not a PNG, JPEG, or WebP, runs past the bound, or the sandbox cannot be read; one at the bound is taken",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const atBound = new Uint8Array(INBOX_BOUNDS.MAX_IMAGE_BYTES);
        atBound.set(WEBP);
        const pastBound = new Uint8Array(INBOX_BOUNDS.MAX_IMAGE_BYTES + 1);
        pastBound.set(PNG);
        const { door } = sandboxWith(
          {
            "/workspace/repository/notes.txt": new TextEncoder().encode("# Not a picture\n"),
            "/workspace/repository/shots/huge.png": pastBound,
            "/workspace/repository/shots/full.webp": atBound,
          },
          500_000,
        );
        const shot = (path: string) =>
          input({ ...SHOT, blocks: [{ type: INBOX_BLOCK.IMAGE, path, alt: "A picture" }] });

        for (const [path, refusal] of [
          ["shots/none.png", INBOX_IMAGE_REFUSAL.NO_FILE],
          ["notes.txt", INBOX_IMAGE_REFUSAL.NOT_IMAGE],
          ["shots/huge.png", INBOX_IMAGE_REFUSAL.TOO_LARGE],
        ] as const) {
          assert.deepEqual(yield* post(agent, shot(path), door), {
            status: ACTION_RESULT_STATUS.REJECTED,
            reason: `${refusal} ${path}`,
          });
        }
        assert.deepEqual(yield* post(agent, shot("shots/landing.png"), noSandbox), {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: `${INBOX_IMAGE_REFUSAL.UNREADABLE} shots/landing.png`,
        });
        assert.deepEqual(yield* planInboxItems(agent.userId, agent.planId), [], "nothing posted");

        const taken = yield* post(agent, shot("shots/full.webp"), door);
        assert.equal(taken.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(taken));
        const { itemId, block } = yield* imageBlockOf(agent);
        const kept = yield* readInboxAttachment(agent.userId, itemId, block.attachmentId);
        assert.equal(Option.getOrUndefined(kept)?.contentType, INBOX_IMAGE_TYPE.WEBP);
        assert.equal(Option.getOrUndefined(kept)?.bytes.byteLength, INBOX_BOUNDS.MAX_IMAGE_BYTES);
      }),
  );

  it.effect("an item's pictures go with its plan, and with its account", () =>
    Effect.gen(function* () {
      const { door } = sandboxWith({ [CHECKOUT_SHOT]: PNG });
      const byPlan = yield* openAgent;
      yield* post(byPlan, input(SHOT), door);
      const byAccount = yield* openAgent;
      yield* post(byAccount, input(SHOT), door);
      const rowsOf = (userId: string) =>
        db
          .select({ id: inboxAttachment.id })
          .from(inboxAttachment)
          .where(eq(inboxAttachment.userId, userId));
      assert.equal((yield* rowsOf(byPlan.userId)).length, 1);
      assert.equal((yield* rowsOf(byAccount.userId)).length, 1);

      yield* deletePlan(byPlan.userId, byPlan.planId);
      assert.deepEqual(yield* rowsOf(byPlan.userId), []);

      yield* db.delete(user).where(eq(user.id, byAccount.userId));
      assert.deepEqual(yield* rowsOf(byAccount.userId), []);
    }),
  );
});
