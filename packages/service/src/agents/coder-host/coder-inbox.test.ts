import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, leaveWorkspace, startTask } from "@luke/database/testing";
import { CODING_AGENT_ATTACHMENT_TYPE } from "@luke/features/coding-agent-wire";
import { inboxAttachmentOf } from "@luke/features/inbox-attachment-link";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_FIELD,
  INBOX_IMAGE_TYPE,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  type InboxItem,
} from "@luke/features/inbox-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { ACTION_RESULT_STATUS } from "../../core.js";
import {
  answerInboxAsk,
  closeInboxItemAsMember,
  type InboxAgent,
  postInboxMessage,
  readInboxAttachment,
  taskInboxItems,
} from "../../inbox/inbox-store.js";
import { CODER } from "./bounds.js";
import { INBOX_REFUSAL, postToInbox, readOwnInbox, withdrawAsk } from "./inbox.js";
import type { InboxSandboxDoor } from "./inbox-image.js";

/**
 * The coding agent's inbox tools, through their public functions against a
 * real dialect: a first post under a key opens a thread the task's inbox
 * reads, a later one adds a message, its ask replacing the open one, the
 * pictures its body draws are read from the sandbox and kept, a withdrawal
 * settles the open ask with why, and every call answers the agent's whole
 * inbox, each thread's messages with their asks and answers. Nothing of
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
  } satisfies InboxAgent;
  return { ...agent, workspaceId: task.workspaceId };
});

const QUEUE = {
  key: "invite-queue",
  title: "Which queue sends the invitation emails?",
  body: "The repo already runs **Postgres**.",
  ask: {
    type: INBOX_ASK.DECIDE,
    options: [{ label: "Postgres outbox", detail: "No new service." }, { label: "Redis" }],
    recommended: "Postgres outbox",
  },
};

const SETTINGS = {
  key: "branch-protection",
  title: "Require a review on main",
  body: "Add a rule for `main`.\n\nhttps://github.com/acme/relay/settings/branches",
  ask: {
    type: INBOX_ASK.DO,
    steps: ["Open Settings → Branches.", "Require one review on `main`."],
  },
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
const post = (agent: InboxAgent, value: WireBoundaryInput, sandbox = noSandbox) =>
  postToInbox(agent, input(value), sandbox);

/** The one thread of the agent's task, as the task's inbox reads it. */
const onlyItem = (agent: Pick<InboxAgent, "userId"> & { readonly taskId: string }) =>
  Effect.map(taskInboxItems(agent.userId, agent.taskId), (items) => {
    assert.equal(items.length, 1, "one thread per key");
    const [item] = items;
    assert.ok(item);
    return item;
  });

/** The message whose ask the thread holds open. */
function openAsk(item: InboxItem) {
  const asking = item.thread?.find((message) => message.ask?.status === INBOX_ASK_STATUS.OPEN);
  assert.ok(asking);
  return asking;
}

/** The refusal a call answered, or a failure where it was taken. */
function refusalOf(result: { readonly status: string; readonly reason?: string }): string {
  assert.equal(result.status, ACTION_RESULT_STATUS.REJECTED);
  return result.reason ?? "";
}

it.layer(getTestDB())("the coding agent's inbox", (it) => {
  it.effect(
    "a first post opens a thread under its title; a later post adds a message, one with an ask replacing the open one and keeping the title where it names none",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const posted = yield* post(agent, QUEUE);
        assert.deepEqual(posted, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          inbox: [
            {
              key: QUEUE.key,
              title: QUEUE.title,
              status: INBOX_STATUS.OPEN,
              waits: true,
              thread: [
                {
                  from: "you",
                  text: QUEUE.body,
                  ask: { ...QUEUE.ask, status: INBOX_ASK_STATUS.OPEN },
                },
              ],
            },
          ],
        });
        const first = yield* onlyItem(agent);
        assert.deepEqual(first.response, {
          type: INBOX_RESPONSE.CHOICE,
          options: QUEUE.ask.options,
          recommended: QUEUE.ask.recommended,
        });

        yield* TestClock.adjust(Duration.seconds(1));
        yield* post(agent, { key: QUEUE.key, body: "Redis would need a new service." });
        const noted = yield* onlyItem(agent);
        assert.equal(
          noted.status,
          INBOX_STATUS.OPEN,
          "a post that asks nothing leaves the ask open",
        );
        assert.equal(openAsk(noted).id, openAsk(first).id);

        yield* TestClock.adjust(Duration.seconds(1));
        const askedAgain = yield* post(agent, {
          key: QUEUE.key,
          body: "Redis is gone; how many workers?",
          ask: { type: INBOX_ASK.ANSWER, fields: [{ type: INBOX_FIELD.NUMBER, label: "Workers" }] },
        });
        assert.equal(askedAgain.status, ACTION_RESULT_STATUS.ACCEPTED);
        const item = yield* onlyItem(agent);
        assert.equal(item.id, first.id);
        assert.equal(item.title, QUEUE.title, "a post naming no title keeps the thread's");
        assert.deepEqual(
          item.thread?.map((message) => [message.text, message.ask?.status]),
          [
            [QUEUE.body, INBOX_ASK_STATUS.REPLACED],
            ["Redis would need a new service.", undefined],
            ["Redis is gone; how many workers?", INBOX_ASK_STATUS.OPEN],
          ],
        );
        assert.deepEqual(item.response, {
          type: INBOX_RESPONSE.FORM,
          fields: [{ type: INBOX_FIELD.NUMBER, label: "Workers" }],
        });
      }),
  );

  it.effect(
    "a first post naming no title is refused and writes nothing; a first post that asks nothing opens a thread that waits on nobody",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const { title: _title, ...untitled } = QUEUE;
        assert.equal(refusalOf(yield* post(agent, untitled)), INBOX_REFUSAL.NO_TITLE);
        assert.deepEqual(yield* taskInboxItems(agent.userId, agent.taskId), []);

        const noted = yield* post(agent, { key: "pr-ready", title: "PR ready", body: "Opened." });
        assert.deepEqual(noted, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          inbox: [
            {
              key: "pr-ready",
              title: "PR ready",
              status: INBOX_STATUS.ANSWERED,
              thread: [{ from: "you", text: "Opened." }],
            },
          ],
        });
      }),
  );

  it.effect(
    "a decide and an answer wait on their answer unless the post says not, and a do only where it says so",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const cases = [
          ["decide", QUEUE.ask, undefined, true],
          ["decide-quiet", QUEUE.ask, false, false],
          ["answer", { type: INBOX_ASK.ANSWER }, undefined, true],
          ["do", SETTINGS.ask, undefined, false],
          ["do-waits", SETTINGS.ask, true, true],
        ] as const;
        for (const [key, ask, waits] of cases) {
          const value = { key, title: key, body: "Words.", ask };
          yield* post(agent, waits === undefined ? value : { ...value, waits });
        }
        const items = yield* taskInboxItems(agent.userId, agent.taskId);
        assert.deepEqual(
          cases.map(([key]) => [key, items.find((item) => item.key === key)?.needsReply]),
          cases.map(([key, , , waits]) => [key, waits]),
        );
      }),
  );

  it.effect(
    "an ask its shape admits but cannot ask is refused, and a recommended value on a field is not kept",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const decide = (ask: WireBoundaryInput) => ({ ...QUEUE, ask });
        const answer = (fields: readonly WireBoundaryInput[]) => ({
          key: "invite-channel",
          title: "How are invitations sent?",
          body: "Pick a channel.",
          ask: { type: INBOX_ASK.ANSWER, fields },
        });
        const refusals = [
          [
            decide({ ...QUEUE.ask, options: [{ label: "A" }, { label: "A" }] }),
            INBOX_REFUSAL.NO_OPTIONS,
          ],
          [decide({ ...QUEUE.ask, recommended: "Kafka" }), INBOX_REFUSAL.UNKNOWN_RECOMMENDATION],
          [answer([{ type: INBOX_FIELD.SELECT, label: "Channel" }]), INBOX_REFUSAL.SELECT_OPTIONS],
          [
            answer([
              { type: INBOX_FIELD.TEXT, label: "Channel" },
              { type: INBOX_FIELD.BOOLEAN, label: "Channel" },
            ]),
            INBOX_REFUSAL.FIELD_LABELS,
          ],
          [{ key: "Not A Slug", title: "T", body: "B" }, INBOX_REFUSAL.UNREADABLE_POST],
          [{ key: "empty", title: "T", body: "" }, INBOX_REFUSAL.UNREADABLE_POST],
        ] as const;
        for (const [value, reason] of refusals) {
          assert.equal(refusalOf(yield* post(agent, value)), reason);
        }
        assert.deepEqual(yield* taskInboxItems(agent.userId, agent.taskId), []);

        const channel = { type: INBOX_FIELD.SELECT, label: "Channel", options: ["Email", "Slack"] };
        yield* post(agent, answer([{ ...channel, recommended: "Slack" }]));
        const item = yield* onlyItem(agent);
        assert.deepEqual(item.response, { type: INBOX_RESPONSE.FORM, fields: [channel] });
      }),
  );

  it.effect(
    "the pictures a body draws by their paths are read from the sandbox, kept as the message's files, and written by their addresses; a web picture and one in code are left as written",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const body = [
          "The form, before and after:",
          "",
          '![Before](shots/before.png "Before") ![After](</workspace/repository/shots/after.png>)',
          "",
          "![Logo](https://example.com/logo.png)",
          "",
          "Write `![alt](shots/missing.png)` for a picture.",
        ].join("\n");
        const sandbox = sandboxWith({ "shots/before.png": PNG, "shots/after.png": PNG });

        const posted = yield* post(agent, { ...QUEUE, body }, sandbox);

        assert.equal(posted.status, ACTION_RESULT_STATUS.ACCEPTED);
        const item = yield* onlyItem(agent);
        const [message] = item.thread ?? [];
        assert.equal(message?.author, INBOX_MESSAGE_AUTHOR.AGENT);
        assert.deepEqual(
          message?.files?.map((file) => [file.name, file.mediaType]),
          [
            ["before.png", INBOX_IMAGE_TYPE.PNG],
            ["after.png", INBOX_IMAGE_TYPE.PNG],
          ],
        );
        const drawn = [...(message?.text ?? "").matchAll(/!\[[^\]]*\]\(<?([^\s)>]+)/gu)].map(
          ([, destination]) => destination ?? "",
        );
        assert.deepEqual(
          drawn.slice(0, 2).map((address) => inboxAttachmentOf(address)),
          (message?.files ?? []).map((file) => ({
            itemId: item.id,
            attachmentId: file.attachmentId,
          })),
          "each path is written as its kept picture's address",
        );
        assert.deepEqual(drawn.slice(2), ["https://example.com/logo.png", "shots/missing.png"]);
        const kept = yield* readInboxAttachment(
          agent.userId,
          item.id,
          message?.files?.[0]?.attachmentId ?? "",
        );
        assert.deepEqual(new Uint8Array(Option.getOrThrow(kept).bytes), PNG);

        const web = yield* post(agent, {
          key: "web-only",
          title: "A web picture",
          body: "![Logo](https://example.com/logo.png)",
        });
        assert.equal(web.status, ACTION_RESULT_STATUS.ACCEPTED, "a web picture opens no sandbox");
      }),
  );

  it.effect(
    "a post drawing a picture that is missing, no image, or one past the count is refused with the path named, and writes nothing",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const sandbox = sandboxWith({
          "shots/form.png": PNG,
          "notes.txt": new TextEncoder().encode("no picture"),
        });
        const drawing = (...paths: string[]) => ({
          ...QUEUE,
          body: paths.map((path) => `![Shot](${path})`).join("\n"),
        });
        const refusals = [
          [
            drawing("shots/form.png", "shots/gone.png"),
            "Not posted: a picture names no file in your sandbox: shots/gone.png",
          ],
          [
            drawing("notes.txt"),
            "Not posted: a picture names a file that is not a PNG, JPEG, or WebP image: notes.txt",
          ],
          [
            drawing(...Array.from({ length: 9 }, (_none, at) => `shots/${at}.png`)),
            INBOX_REFUSAL.TOO_MANY_PICTURES,
          ],
        ] as const;
        for (const [value, reason] of refusals) {
          assert.equal(refusalOf(yield* post(agent, value, sandbox)), reason);
        }
        assert.deepEqual(yield* taskInboxItems(agent.userId, agent.taskId), []);
      }),
  );

  it.effect(
    "withdraw_ask settles the open ask with why and leaves the thread; one with no open ask, an answered one among them, is refused and changes nothing",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        yield* post(agent, SETTINGS);
        const withdrawn = yield* withdrawAsk(
          agent,
          input({ key: SETTINGS.key, reason: "Did it myself." }),
        );
        assert.deepEqual(withdrawn, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          inbox: [
            {
              key: SETTINGS.key,
              title: SETTINGS.title,
              status: INBOX_STATUS.CLOSED,
              thread: [
                {
                  from: "you",
                  text: SETTINGS.body,
                  ask: {
                    type: INBOX_ASK.DO,
                    status: INBOX_ASK_STATUS.WITHDRAWN,
                    withdrawnReason: "Did it myself.",
                  },
                },
              ],
            },
          ],
        });
        const again = yield* withdrawAsk(agent, input({ key: SETTINGS.key, reason: "Twice." }));
        assert.equal(refusalOf(again), INBOX_REFUSAL.NO_OPEN_ASK);

        yield* post(agent, QUEUE);
        const asked = (yield* taskInboxItems(agent.userId, agent.taskId)).find(
          (item) => item.key === QUEUE.key,
        );
        assert.ok(asked);
        const answered = yield* answerInboxAsk(agent.userId, asked.id, {
          answers: { ask: openAsk(asked).id, reply: INBOX_REPLY.CHOSE, choices: ["Redis"] },
          text: "",
          clientKey: randomUUID(),
        });
        assert.equal(Option.getOrThrow(answered).item.status, INBOX_STATUS.ANSWERED);
        const late = yield* withdrawAsk(agent, input({ key: QUEUE.key, reason: "Too late." }));
        assert.equal(refusalOf(late), INBOX_REFUSAL.NO_OPEN_ASK);
        const after = (yield* taskInboxItems(agent.userId, agent.taskId)).find(
          (item) => item.key === QUEUE.key,
        );
        assert.equal(
          after?.status,
          INBOX_STATUS.ANSWERED,
          "an answered thread is never closed over",
        );

        const refusals = [
          [{ key: "no-such-thread", reason: "Gone." }, INBOX_REFUSAL.NO_OPEN_ASK],
          [{ key: QUEUE.key }, INBOX_REFUSAL.UNREADABLE_WITHDRAW],
        ] as const;
        for (const [value, reason] of refusals) {
          assert.equal(refusalOf(yield* withdrawAsk(agent, input(value))), reason);
        }
      }),
  );

  it.effect(
    "read_inbox answers each thread's messages in order, each ask with where it stands and each answer by whom, a settled thread by its latest messages",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        yield* post(agent, QUEUE);
        const asked = yield* onlyItem(agent);
        yield* TestClock.adjust(Duration.seconds(1));
        yield* postInboxMessage(agent.userId, asked.id, {
          text: "Is Redis free?",
          clientKey: randomUUID(),
          files: [
            {
              name: "pricing.txt",
              mediaType: CODING_AGENT_ATTACHMENT_TYPE.TEXT,
              data: Buffer.from("free\n").toString("base64"),
            },
          ],
        });
        yield* TestClock.adjust(Duration.seconds(1));
        yield* post(agent, { key: QUEUE.key, body: "No: it needs a new service." });

        const open = yield* readOwnInbox(agent);
        assert.equal(open.status, ACTION_RESULT_STATUS.ACCEPTED);
        assert.deepEqual(open.inbox?.[0]?.thread, [
          { from: "you", text: QUEUE.body, ask: { ...QUEUE.ask, status: INBOX_ASK_STATUS.OPEN } },
          { from: "Test User", text: "Is Redis free?", files: ["pricing.txt"] },
          { from: "you", text: "No: it needs a new service." },
        ]);

        yield* TestClock.adjust(Duration.seconds(1));
        yield* answerInboxAsk(agent.userId, asked.id, {
          answers: {
            ask: openAsk(asked).id,
            reply: INBOX_REPLY.CHOSE,
            choices: ["Postgres outbox"],
          },
          text: "Go with the outbox.",
          clientKey: randomUUID(),
        });

        const settled = yield* readOwnInbox(agent);
        assert.equal(settled.status, ACTION_RESULT_STATUS.ACCEPTED);
        assert.deepEqual(settled.inbox, [
          {
            key: QUEUE.key,
            title: QUEUE.title,
            status: INBOX_STATUS.ANSWERED,
            earlier: 1,
            thread: [
              { from: "Test User", text: "Is Redis free?", files: ["pricing.txt"] },
              { from: "you", text: "No: it needs a new service." },
              {
                from: "Test User",
                text: "Go with the outbox.",
                answers: { reply: INBOX_REPLY.CHOSE, choices: ["Postgres outbox"] },
              },
            ],
          },
        ]);
      }),
  );

  it.effect(
    "the agent reads back which member closed a thread without an answer, and its own withdrawal by its reason",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        yield* post(agent, SETTINGS);
        yield* post(agent, { ...SETTINGS, key: "own" });
        const items = yield* taskInboxItems(agent.userId, agent.taskId);
        const settings = items.find((item) => item.key === SETTINGS.key);
        assert.ok(settings);
        yield* closeInboxItemAsMember(agent.userId, settings.id, settings.revision, randomUUID());
        yield* withdrawAsk(agent, input({ key: "own", reason: "Did it myself." }));

        const read = yield* readOwnInbox(agent);
        assert.equal(read.status, ACTION_RESULT_STATUS.ACCEPTED);
        assert.deepEqual(
          read.inbox
            ?.map((line) => [line.key, line.status, line.closedBy, line.thread[0]?.ask])
            .sort(),
          [
            [
              "own",
              INBOX_STATUS.CLOSED,
              undefined,
              {
                type: INBOX_ASK.DO,
                status: INBOX_ASK_STATUS.WITHDRAWN,
                withdrawnReason: "Did it myself.",
              },
            ],
            [
              SETTINGS.key,
              INBOX_STATUS.CLOSED,
              "Test User",
              { type: INBOX_ASK.DO, status: INBOX_ASK_STATUS.WITHDRAWN },
            ],
          ].sort(),
        );
      }),
  );

  it.effect(
    "an agent whose starter left the thread's workspace posts on none of its threads there",
    () =>
      Effect.gen(function* () {
        const { workspaceId, ...agent } = yield* openAgent;
        yield* post(agent, SETTINGS);
        yield* leaveWorkspace(workspaceId, agent.userId);

        const refused = yield* post(agent, { key: SETTINGS.key, body: "Still here." });

        assert.equal(refusalOf(refused), INBOX_REFUSAL.NO_AGENT);
      }),
  );
});
