import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { archiveChannel, createChannel } from "@luke/database/models/channel-store";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { createTask } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import { GENERAL_CHANNEL } from "@luke/database/schemas/channel";
import { inboxItem } from "@luke/database/schemas/inbox";
import { getTestDB, leaveWorkspace, openWorkspace, startTask } from "@luke/database/testing";
import {
  CODING_AGENT_ATTACHMENT_TYPE,
  CODING_AGENT_BOUNDS,
} from "@luke/features/coding-agent-wire";
import { inboxAttachmentOf } from "@luke/features/inbox-attachment-link";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_BOUNDS,
  INBOX_FIELD,
  INBOX_FILE_TYPE,
  INBOX_IMAGE_TYPE,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_STATUS,
  type InboxItem,
} from "@luke/features/inbox-wire";
import { encodeMention, MENTION_KIND } from "@luke/features/mention-link";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { paddedTo, webmBytes } from "@luke/wire/testing";
import { eq } from "drizzle-orm";
import { DateTime, Duration, Effect, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import { ACTION_RESULT_STATUS } from "../../core.js";
import {
  acknowledgeInboxItem,
  answerInboxAsk,
  channelThreads,
  closeInboxItemAsMember,
  type InboxAgent,
  postInboxMessage,
  readInboxAttachment,
  taskInboxItems,
} from "../../inbox/inbox-store.js";
import { CODER } from "./bounds.js";
import {
  CHANNEL_REFUSAL,
  type ChannelToolResult,
  createAgentChannel,
  INBOX_REFUSAL,
  moveAgentThread,
  postToInbox,
  readOwnInbox,
  type ThreadPoster,
  updateAgentChannel,
  withdrawAsk,
} from "./inbox.js";
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

/** A channel's first page of threads the reader may read, oldest first. */
const firstPage = (userId: string, channelId: string) =>
  Effect.map(channelThreads(userId, channelId), (page) => Option.getOrThrow(page).threads);

const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** An agent the account starts on the task, in its repository. */
const agentOn = (userId: string, task: { readonly id: string; readonly workspaceId: string }) =>
  Effect.gen(function* () {
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
      organizationId: started.value.agent.organizationId,
    } satisfies ThreadPoster;
    return { ...agent, workspaceId: task.workspaceId };
  });

/** An account with one task and one agent started on it, in its repository. */
const openAgent = Effect.gen(function* () {
  const userId = yield* openUser;
  const task = yield* startTask(userId, { name: "Teammate invitations" });
  return yield* agentOn(userId, task);
});

/** The open channel the account makes in its workspace, as a member makes one. */
const madeChannel = (userId: string, organizationId: string, name: string) =>
  Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const draft = { name, purpose: "Its work.", project: false };
    return Result.getOrThrow(yield* createChannel(userId, organizationId, draft, now));
  });

/** The open channels a channel tool answered, by name, or a failure where it was refused. */
function channelNames(result: ChannelToolResult): readonly string[] {
  assert.ok("channels" in result, JSON.stringify(result));
  return result.channels.map((channel) => channel.name);
}

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
const post = (agent: ThreadPoster, value: WireBoundaryInput, sandbox = noSandbox) =>
  postToInbox(agent, input(value), sandbox);

/** The one thread of the agent's task, as the task's inbox reads it. */
const onlyItem = (agent: Pick<InboxAgent, "userId"> & { readonly taskId: string }) =>
  Effect.map(taskInboxItems(agent.userId, agent.taskId), (items) => {
    assert.equal(items.length, 1, "one thread per key");
    const [item] = items;
    assert.ok(item);
    return item;
  });

/** The mention an agent writes a thread of its task's as, its link spelled out as the window reads one. */
function mentionOf(
  agent: { readonly workspaceId: string; readonly taskId: string },
  title: string,
  itemId: string,
): string {
  return `[@${title}](https://tryluke.dev/workspace-${agent.workspaceId}/plan/${agent.taskId}/inbox/${itemId})`;
}

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
        const first = yield* onlyItem(agent);
        assert.deepEqual(posted, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          inbox: [
            {
              id: first.id,
              key: QUEUE.key,
              title: QUEUE.title,
              mention: mentionOf(agent, QUEUE.title, first.id),
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
        assert.deepEqual(openAsk(first).ask, { ...QUEUE.ask, status: INBOX_ASK_STATUS.OPEN });

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
        assert.deepEqual(openAsk(item).ask, {
          type: INBOX_ASK.ANSWER,
          fields: [{ type: INBOX_FIELD.NUMBER, label: "Workers" }],
          status: INBOX_ASK_STATUS.OPEN,
        });
      }),
  );

  it.effect(
    "a post goes to the open channel it names, # or not, addressed to the member its link names; an unknown or archived channel, or a link naming no member of the workspace, is refused and posts nothing",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const now = yield* DateTime.nowAsDate;
        const { organizationId, userId } = agent;
        const made = (name: string) =>
          Effect.map(
            createChannel(
              userId,
              organizationId,
              { name, purpose: "Its work.", project: false },
              now,
            ),
            Result.getOrThrow,
          );
        const app = yield* made("app");
        const old = yield* made("old");
        Result.getOrThrow(yield* archiveChannel(userId, organizationId, old.id, now));
        const person = (id: string) =>
          `[@Ada](${encodeMention({ kind: MENTION_KIND.PERSON, userId: id }, { workspace: "acme", repository: null })})`;
        const posted = yield* post(agent, { ...QUEUE, channel: "#app", to: person(userId) });
        assert.equal(posted.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(posted));
        assert.deepEqual(
          (yield* firstPage(userId, app.id)).map((thread) => thread.key),
          [QUEUE.key],
        );

        const agentLink = `[@Agent](${encodeMention({ kind: MENTION_KIND.AGENT, agentId: agent.agentId }, { workspace: "acme", repository: null })})`;
        for (const [place, reason] of [
          [{ channel: "release" }, INBOX_REFUSAL.UNKNOWN_CHANNEL],
          [{ channel: "old" }, INBOX_REFUSAL.ARCHIVED_CHANNEL],
          [{ to: person(`user-${randomUUID()}`) }, INBOX_REFUSAL.NO_ADDRESSEE],
          [{ to: agentLink }, INBOX_REFUSAL.NO_MEMBER],
        ] as const) {
          assert.deepEqual(
            yield* post(agent, { ...QUEUE, key: "elsewhere", ...place }),
            { status: ACTION_RESULT_STATUS.REJECTED, reason },
            JSON.stringify(place),
          );
        }
        assert.equal((yield* onlyItem(agent)).key, QUEUE.key);
      }),
  );

  it.effect(
    "a first post naming no title is refused and writes nothing; a first post that asks nothing opens a notice the agent reads as no ask of its own, which no withdrawal finds",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const { title: _title, ...untitled } = QUEUE;
        assert.equal(refusalOf(yield* post(agent, untitled)), INBOX_REFUSAL.NO_TITLE);
        assert.deepEqual(yield* taskInboxItems(agent.userId, agent.taskId), []);

        const noted = yield* post(agent, { key: "pr-ready", title: "PR ready", body: "Opened." });
        const notice = yield* onlyItem(agent);
        assert.deepEqual(noted, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          inbox: [
            {
              id: notice.id,
              key: "pr-ready",
              title: "PR ready",
              mention: mentionOf(agent, "PR ready", notice.id),
              status: INBOX_STATUS.OPEN,
              thread: [{ from: "you", text: "Opened." }],
            },
          ],
        });
        assert.deepEqual([notice.status, notice.needsReply], [INBOX_STATUS.OPEN, false]);
        assert.equal(
          refusalOf(yield* withdrawAsk(agent, input({ key: "pr-ready", reason: "Merged." }))),
          INBOX_REFUSAL.NO_OPEN_ASK,
        );
        for (let at = 1; at < INBOX_BOUNDS.MAX_OPEN_PER_AGENT; at += 1) {
          yield* post(agent, { key: `pr-${at}`, title: "PR ready", body: "Opened." });
        }
        assert.equal(
          refusalOf(yield* post(agent, { key: "pr-more", title: "PR ready", body: "Opened." })),
          INBOX_REFUSAL.TOO_MANY_NOTICES,
        );
      }),
  );

  it.effect(
    "a decide and an answer are always heard back, even where the post says not to wait, and a do only where it says so",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const cases = [
          ["decide", QUEUE.ask, undefined, true],
          ["decide-quiet", QUEUE.ask, false, true],
          ["answer", { type: INBOX_ASK.ANSWER }, undefined, true],
          ["answer-quiet", { type: INBOX_ASK.ANSWER }, false, true],
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
    "an ask its shape admits but cannot ask is refused, and a select field keeps the option it recommends",
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
          [
            decide({ ...QUEUE.ask, multiple: true, recommended: ["Redis", "Kafka"] }),
            INBOX_REFUSAL.UNKNOWN_RECOMMENDATION,
          ],
          [
            decide({ ...QUEUE.ask, recommended: ["Postgres outbox", "Redis"] }),
            INBOX_REFUSAL.SEVERAL_RECOMMENDED,
          ],
          [
            decide({ ...QUEUE.ask, multiple: true, recommended: ["Redis", "Redis"] }),
            INBOX_REFUSAL.SEVERAL_RECOMMENDED,
          ],
          [answer([{ type: INBOX_FIELD.SELECT, label: "Channel" }]), INBOX_REFUSAL.SELECT_OPTIONS],
          [
            answer([
              {
                type: INBOX_FIELD.SELECT,
                label: "Channel",
                options: ["Email", "Slack"],
                recommended: "SMS",
              },
            ]),
            INBOX_REFUSAL.SELECT_RECOMMENDATION,
          ],
          [
            answer([{ type: INBOX_FIELD.TEXT, label: "Channel", recommended: "Slack" }]),
            INBOX_REFUSAL.SELECT_RECOMMENDATION,
          ],
          [
            answer([
              { type: INBOX_FIELD.TEXT, label: "Channel" },
              { type: INBOX_FIELD.BOOLEAN, label: "Channel" },
            ]),
            INBOX_REFUSAL.FIELD_LABELS,
          ],
          [{ key: "Not A Slug", title: "T", body: "B" }, INBOX_REFUSAL.UNREADABLE_POST],
          [{ key: "empty", title: "T", body: "" }, INBOX_REFUSAL.UNREADABLE_POST],
          [{ key: "blank", title: "T", body: " \n\t " }, INBOX_REFUSAL.UNREADABLE_POST],
        ] as const;
        for (const [value, reason] of refusals) {
          assert.equal(refusalOf(yield* post(agent, value)), reason);
        }
        assert.deepEqual(yield* taskInboxItems(agent.userId, agent.taskId), []);

        const channel = {
          type: INBOX_FIELD.SELECT,
          label: "Channel",
          options: ["Email", "Slack"],
          recommended: "Slack",
        };
        yield* post(agent, answer([channel]));
        const item = yield* onlyItem(agent);
        assert.deepEqual(openAsk(item).ask, {
          type: INBOX_ASK.ANSWER,
          fields: [channel],
          status: INBOX_ASK_STATUS.OPEN,
        });
      }),
  );

  it.effect(
    "a decide that takes several recommends several, kept as its first label and every label, and a list of one is kept as its label",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const options = [{ label: "Email" }, { label: "Slack" }, { label: "SMS" }];
        yield* post(agent, {
          key: "invite-channels",
          title: "Which channels send invitations?",
          body: "Pick any.",
          ask: { type: INBOX_ASK.DECIDE, options, multiple: true, recommended: ["Slack", "Email"] },
        });
        const several = yield* onlyItem(agent);
        const kept = {
          type: INBOX_ASK.DECIDE,
          options,
          multiple: true,
          recommended: "Slack",
          recommendations: ["Slack", "Email"],
        };
        assert.deepEqual(openAsk(several).ask, { ...kept, status: INBOX_ASK_STATUS.OPEN });

        yield* TestClock.adjust(Duration.seconds(1));
        yield* post(agent, {
          key: "invite-channels",
          body: "Only one, then.",
          ask: { type: INBOX_ASK.DECIDE, options, recommended: ["SMS"] },
        });
        const one = yield* onlyItem(agent);
        assert.deepEqual(openAsk(one).ask, {
          type: INBOX_ASK.DECIDE,
          options,
          recommended: "SMS",
          status: INBOX_ASK_STATUS.OPEN,
        });
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
    "a recording a body draws is kept as a WebM past a picture's and a file's bound and read back as one, and a desktop before version 5 is shown no image block for it",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        // Past a message's file bound too, which the item's table held a recording to before.
        const recording = paddedTo(webmBytes(1280, 800), CODING_AGENT_BOUNDS.MAX_PDF_BYTES + 1);
        const sandbox = sandboxWith({ "/tmp/video/flow.webm": recording });

        const posted = yield* post(
          agent,
          { ...QUEUE, body: '![Inviting a member](/tmp/video/flow.webm "The invite flow")' },
          sandbox,
        );

        assert.equal(posted.status, ACTION_RESULT_STATUS.ACCEPTED);
        const item = yield* onlyItem(agent);
        const [message] = item.thread ?? [];
        assert.deepEqual(
          message?.files?.map((file) => [file.name, file.mediaType]),
          [["flow.webm", INBOX_FILE_TYPE.WEBM]],
        );
        const kept = yield* readInboxAttachment(
          agent.userId,
          item.id,
          message?.files?.[0]?.attachmentId ?? "",
        );
        assert.deepEqual(
          Option.map(kept, (file) => [file.contentType, file.bytes.byteLength]),
          Option.some([INBOX_FILE_TYPE.WEBM, recording.byteLength]),
        );
      }),
  );

  it.effect(
    "a picture past a picture's bound, a recording past a video's, and one that states no size are refused with the path named",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const sandbox = sandboxWith({
          "shots/huge.png": paddedTo(PNG, INBOX_BOUNDS.MAX_IMAGE_BYTES + 1),
          "/tmp/video/long.webm": paddedTo(webmBytes(1280, 800), INBOX_BOUNDS.MAX_VIDEO_BYTES + 1),
          "/tmp/video/flow.mkv": webmBytes(640, 480, "matroska"),
        });
        const tooLarge =
          "Not posted: a picture names a file larger than 1.5 MB, or a video larger than 4.0 MB; render it smaller, or record a shorter flow:";
        const refusals = [
          ["shots/huge.png", `${tooLarge} shots/huge.png`],
          ["/tmp/video/long.webm", `${tooLarge} /tmp/video/long.webm`],
          [
            "/tmp/video/flow.mkv",
            "Not posted: a picture names a file that is not a PNG, JPEG, or WebP image, or a WebM video that states its size: /tmp/video/flow.mkv",
          ],
        ] as const;
        for (const [path, reason] of refusals) {
          const refused = yield* post(agent, { ...QUEUE, body: `![Shot](${path})` }, sandbox);
          assert.equal(refusalOf(refused), reason);
        }
        assert.deepEqual(yield* taskInboxItems(agent.userId, agent.taskId), []);
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
            "Not posted: a picture names a file that is not a PNG, JPEG, or WebP image, or a WebM video that states its size: notes.txt",
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
        const settings = yield* onlyItem(agent);
        assert.deepEqual(withdrawn, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          inbox: [
            {
              id: settings.id,
              key: SETTINGS.key,
              title: SETTINGS.title,
              mention: mentionOf(agent, SETTINGS.title, settings.id),
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

        for (const text of ["Thanks.", "Shipping it."]) {
          yield* TestClock.adjust(Duration.seconds(1));
          yield* post(agent, { key: QUEUE.key, body: text });
        }
        // The agent's words after the answer bring the thread back as a notice, which the member's reply on it settles.
        const notice = yield* onlyItem(agent);
        assert.equal(notice.status, INBOX_STATUS.OPEN);
        yield* TestClock.adjust(Duration.seconds(1));
        yield* postInboxMessage(agent.userId, asked.id, {
          text: "Great.",
          clientKey: randomUUID(),
          revision: notice.revision,
        });

        const settled = yield* readOwnInbox(agent);
        assert.equal(settled.status, ACTION_RESULT_STATUS.ACCEPTED);
        assert.deepEqual(settled.inbox, [
          {
            id: asked.id,
            key: QUEUE.key,
            title: QUEUE.title,
            mention: mentionOf(agent, QUEUE.title, asked.id),
            status: INBOX_STATUS.ANSWERED,
            earlier: 2,
            thread: [
              {
                from: "you",
                text: QUEUE.body,
                ask: { type: INBOX_ASK.DECIDE, status: INBOX_ASK_STATUS.ANSWERED },
              },
              {
                from: "Test User",
                text: "Go with the outbox.",
                answers: { reply: INBOX_REPLY.CHOSE, choices: ["Postgres outbox"] },
              },
              { from: "you", text: "Thanks." },
              { from: "you", text: "Shipping it." },
              { from: "Test User", text: "Great." },
            ],
          },
        ]);
      }),
  );

  it.effect(
    "a settled do reads back its steps beside the places of those the member ticked, so the agent knows which are left",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        yield* post(agent, SETTINGS);
        const asked = yield* onlyItem(agent);
        yield* TestClock.adjust(Duration.seconds(1));
        yield* answerInboxAsk(agent.userId, asked.id, {
          answers: { ask: openAsk(asked).id, reply: INBOX_REPLY.NOT_DONE, steps: [0] },
          text: "No admin rights for the rule.",
          clientKey: randomUUID(),
        });

        const read = yield* readOwnInbox(agent);

        assert.equal(read.status, ACTION_RESULT_STATUS.ACCEPTED);
        assert.deepEqual(
          read.inbox?.[0]?.thread.map((line) => [line.ask, line.answers]),
          [
            [
              { type: INBOX_ASK.DO, status: INBOX_ASK_STATUS.ANSWERED, steps: SETTINGS.ask.steps },
              undefined,
            ],
            [undefined, { reply: INBOX_REPLY.NOT_DONE, steps: [0] }],
          ],
        );
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
    "the agent reads back a notice the member nodded as answered, with nothing beside its own message, and one closed before threads by its reason alone",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        yield* post(agent, { key: "pr-ready", title: "PR ready", body: "Opened." });
        yield* post(agent, { key: "pr-merged", title: "PR merged", body: "Merged." });
        const items = yield* taskInboxItems(agent.userId, agent.taskId);
        const itemOf = (key: string) => items.find((item) => item.key === key);
        const ready = itemOf("pr-ready");
        const merged = itemOf("pr-merged");
        assert.ok(ready && merged);
        const nodded = yield* acknowledgeInboxItem(
          agent.userId,
          ready.id,
          ready.revision,
          randomUUID(),
        );
        assert.ok(Option.isSome(nodded));
        // A deployment from before threads closed a notice with why; no tool from version 5 closes one.
        yield* Database.use((db) =>
          db
            .update(inboxItem)
            .set({ status: INBOX_STATUS.CLOSED, closedReason: "Merged by hand." })
            .where(eq(inboxItem.id, merged.id)),
        );

        const read = yield* readOwnInbox(agent);

        assert.equal(read.status, ACTION_RESULT_STATUS.ACCEPTED);
        assert.deepEqual(
          read.inbox?.toSorted((left, right) => left.key.localeCompare(right.key)),
          [
            {
              id: merged.id,
              key: "pr-merged",
              title: "PR merged",
              mention: mentionOf(agent, "PR merged", merged.id),
              status: INBOX_STATUS.CLOSED,
              thread: [{ from: "you", text: "Merged." }],
              closedReason: "Merged by hand.",
            },
            {
              id: ready.id,
              key: "pr-ready",
              title: "PR ready",
              mention: mentionOf(agent, "PR ready", ready.id),
              status: INBOX_STATUS.ANSWERED,
              thread: [{ from: "you", text: "Opened." }],
            },
          ],
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

  it.effect(
    "create_channel makes an open channel and answers the open channels; a name an open channel goes by, #general's among them, one no slug, and a workspace the developer left are refused",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const made = yield* createAgentChannel(
          agent,
          input({ name: "release", purpose: "Shipping notes.", project: true }),
        );
        assert.deepEqual(made, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          channels: [
            { name: GENERAL_CHANNEL.NAME, purpose: GENERAL_CHANNEL.PURPOSE, project: false },
            { name: "release", purpose: "Shipping notes.", project: true },
          ],
        });

        for (const [value, reason] of [
          [{ name: "release", purpose: "Again." }, CHANNEL_REFUSAL.NAME_TAKEN],
          [{ name: GENERAL_CHANNEL.NAME, purpose: "Mine." }, CHANNEL_REFUSAL.NAME_TAKEN],
          [{ name: "#Release Notes", purpose: "Notes." }, CHANNEL_REFUSAL.UNREADABLE_CREATE],
        ] as const) {
          assert.equal(refusalOf(yield* createAgentChannel(agent, input(value))), reason);
        }
        yield* leaveWorkspace(agent.organizationId, agent.userId);
        assert.equal(
          refusalOf(yield* createAgentChannel(agent, input({ name: "late", purpose: "Late." }))),
          CHANNEL_REFUSAL.NO_WORKSPACE,
        );
      }),
  );

  it.effect(
    "update_channel renames, edits, archives, and unarchives a channel by its name; an unknown or another workspace's channel, an edit of an archived one, #general's name, and a taken name are refused, and a refused change writes nothing of itself",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const update = (value: WireBoundaryInput) => updateAgentChannel(agent, input(value));
        yield* madeChannel(agent.userId, agent.organizationId, "app");
        yield* madeChannel(agent.userId, agent.organizationId, "docs");
        const stranger = yield* openAgent;
        yield* madeChannel(stranger.userId, stranger.organizationId, "secret");

        assert.deepEqual(
          channelNames(yield* update({ channel: "#app", name: "web", purpose: "The web app." })),
          ["docs", GENERAL_CHANNEL.NAME, "web"],
        );
        assert.deepEqual(channelNames(yield* update({ channel: "web", archived: true })), [
          "docs",
          GENERAL_CHANNEL.NAME,
        ]);
        assert.deepEqual(
          channelNames(yield* update({ channel: "web", archived: false, name: "site" })),
          ["docs", GENERAL_CHANNEL.NAME, "site"],
        );
        const general = yield* update({
          channel: GENERAL_CHANNEL.NAME,
          purpose: "Everything else.",
        });
        assert.equal(general.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(general));

        yield* update({ channel: "site", archived: true });
        for (const [value, reason] of [
          [{ channel: "nowhere", archived: true }, CHANNEL_REFUSAL.UNKNOWN_CHANNEL],
          [{ channel: "secret", purpose: "Mine now." }, CHANNEL_REFUSAL.UNKNOWN_CHANNEL],
          [{ channel: "site", purpose: "Still here." }, CHANNEL_REFUSAL.ARCHIVED_CHANNEL],
          [{ channel: GENERAL_CHANNEL.NAME, name: "lobby" }, CHANNEL_REFUSAL.GENERAL],
          [{ channel: GENERAL_CHANNEL.NAME, archived: true }, CHANNEL_REFUSAL.GENERAL],
          [{ channel: "site", archived: false, name: "docs" }, CHANNEL_REFUSAL.NAME_TAKEN],
          [{ channel: "docs" }, CHANNEL_REFUSAL.NO_CHANGE],
        ] as const) {
          assert.equal(refusalOf(yield* update(value)), reason, JSON.stringify(value));
        }
        assert.deepEqual(
          channelNames(yield* update({ channel: "docs", purpose: "The docs." })),
          ["docs", GENERAL_CHANNEL.NAME],
          "the refused unarchive under a taken name left #site archived",
        );
      }),
  );

  it.effect(
    "move_thread moves the agent's own thread by its key, and any thread it may read by its id, into an open channel, where the channel's threads read it; an unknown or archived channel, a thread it may not read, and a thread of another workspace are refused",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const move = (value: WireBoundaryInput) => moveAgentThread(agent, input(value));
        const app = yield* madeChannel(agent.userId, agent.organizationId, "app");
        const old = yield* madeChannel(agent.userId, agent.organizationId, "old");
        const now = yield* DateTime.nowAsDate;
        Result.getOrThrow(yield* archiveChannel(agent.userId, agent.organizationId, old.id, now));
        yield* post(agent, QUEUE);
        const own = yield* onlyItem(agent);

        assert.deepEqual(yield* move({ thread: QUEUE.key, channel: "#app" }), {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          thread: { id: own.id, title: QUEUE.title, channel: "app" },
        });
        assert.deepEqual(
          (yield* firstPage(agent.userId, app.id)).map((thread) => thread.key),
          [QUEUE.key],
        );

        const sibling = yield* agentOn(
          agent.userId,
          yield* startTask(agent.userId, { name: "Billing" }),
        );
        yield* post(sibling, SETTINGS);
        const theirs = yield* onlyItem(sibling);
        const moved = yield* move({ thread: theirs.id, channel: "app" });
        assert.equal(moved.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(moved));

        const stranger = yield* openAgent;
        yield* post(stranger, QUEUE);
        const unreadable = yield* onlyItem(stranger);
        const elsewhere = yield* openWorkspace(agent.userId);
        const away = yield* agentOn(
          agent.userId,
          yield* createTask(agent.userId, { name: "Elsewhere", organizationId: elsewhere }),
        );
        yield* post(away, SETTINGS);
        const awayThread = yield* onlyItem(away);
        for (const [value, reason] of [
          [{ thread: QUEUE.key, channel: "release" }, CHANNEL_REFUSAL.UNKNOWN_CHANNEL],
          [{ thread: QUEUE.key, channel: "old" }, CHANNEL_REFUSAL.MOVE_ARCHIVED],
          [{ thread: "no-such-thread", channel: "app" }, CHANNEL_REFUSAL.NO_THREAD],
          [{ thread: unreadable.id, channel: "app" }, CHANNEL_REFUSAL.NO_THREAD],
          [{ thread: awayThread.id, channel: "app" }, CHANNEL_REFUSAL.OTHER_WORKSPACE],
        ] as const) {
          assert.equal(refusalOf(yield* move(value)), reason, JSON.stringify(value));
        }
        assert.deepEqual(
          (yield* firstPage(agent.userId, app.id)).map((thread) => thread.key).toSorted(),
          [QUEUE.key, SETTINGS.key].toSorted(),
        );
      }),
  );
});
