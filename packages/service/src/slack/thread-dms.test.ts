import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import { linkSlackInstallation } from "@repo/database/models/slack-installation-store";
import { organization, user } from "@repo/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, startTask } from "@repo/database/testing";
import { INBOX_ASK, INBOX_ASK_STATUS, INBOX_REPLY } from "@repo/features/inbox-wire";
import { eq } from "drizzle-orm";
import { Effect, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import { answerInboxAsk, postInboxThread } from "../inbox/inbox-store.js";
import { SlackBot, type SlackFileTransfer, type SlackWebApi, slackBotOver } from "./slack-bot.js";
import { dmThreadPost, settleThreadDms, threadStandsOpen } from "./thread-dms.js";

/**
 * A thread an agent posts, written by our Slack bot to the member it waits
 * on, over a real store and a fake Slack: the DM goes to that member's
 * Slack user, says the thread's title and the agent's Markdown in a
 * `markdown` block, a mention chip as a plain link, and links to the thread,
 * the post's picture shared under it; a follow-up lands in that DM's Slack
 * thread; and an answer rewrites the first DM to say it was answered.
 *
 * Synthetic accounts, workspaces, and Slack ids throughout.
 */

/** One Web API call the fake Slack was handed. */
interface SlackCall {
  readonly method: string;
  readonly args: Readonly<Record<string, string>>;
}

/** A Slack that knows every member by their email, as `U-<email>`, and posts every message it is handed. */
function fakeSlack(calls: SlackCall[]): SlackWebApi {
  return (method, args) => {
    calls.push({ method, args });
    switch (method) {
      case "users.lookupByEmail":
        return Effect.succeed({ ok: true, user: { id: `U-${args.email}` } });
      case "chat.postMessage":
        return Effect.succeed({ ok: true, channel: "D0001", ts: "1700000000.000100" });
      case "files.getUploadURLExternal":
        return Effect.succeed({
          ok: true,
          upload_url: `https://files.slack.com/upload/v1/${args.filename}`,
          file_id: "F0001",
        });
      default:
        return Effect.succeed({ ok: true });
    }
  };
}

/** Slack's upload addresses, writing down each file's bytes as sent to its address. */
function fakeFiles(sent: { url: string; bytes: Uint8Array }[]): SlackFileTransfer {
  return {
    send: (url, bytes) => Effect.sync(() => void sent.push({ url, bytes })),
    read: () => Effect.die("no file is read"),
  };
}

/** The picture the agent's post carries, a screenshot from its sandbox. */
const SCREENSHOT = {
  path: "shots/settings.png",
  name: "settings.png",
  contentType: "image/png",
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
} as const;

/** An account, with one agent on a task nobody is assigned, in a workspace whose bot is connected. */
const openConnectedAgent = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  const email = `${userId}@app.test`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email });
  const task = yield* startTask(userId, { name: "Teammate invitations" });
  const started = yield* createAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    repository: "acme/relay",
    planSnapshot: "# Teammate invitations\n",
    prompt: null,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  });
  assert.ok(Option.isSome(started));
  const organizationId = task.workspaceId;
  yield* linkSlackInstallation({ organizationId, teamId: "T0001", teamName: "Team", userId });
  const [workspace] = yield* db
    .select({ slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, organizationId));
  assert.ok(workspace !== undefined);
  const agent = { userId, taskId: task.id, agentId: started.value.agent.id };
  return { agent, organizationId, email, slug: workspace.slug };
});

/** The blocks a call carried, as Slack reads them. */
const blocksOf = (call: SlackCall | undefined) => JSON.parse(call?.args.blocks ?? "[]");

it.layer(getTestDB())("a thread's Slack DM", (it) => {
  it.effect(
    "writes the member it waits on, replies with a follow-up in that DM's thread, and says it was answered once they answer",
    () => {
      const calls: SlackCall[] = [];
      const sent: { url: string; bytes: Uint8Array }[] = [];
      return Effect.gen(function* () {
        const { agent, organizationId, email, slug } = yield* openConnectedAgent;
        const ask = {
          key: "branch-protection",
          title: "Require a review on main",
          body: "Turn it on in [@settings](https://github.com/acme/relay/settings).",
          ask: { type: INBOX_ASK.DO, steps: [] },
          needsReply: true,
        };
        const item = Result.getOrThrow(yield* postInboxThread(agent, ask, [SCREENSHOT]));
        yield* dmThreadPost({ organizationId, item, asked: true, wasOpen: false });
        const wasOpen = yield* threadStandsOpen(agent, ask.key);
        // The follow-up comes later than the ask, as an agent's next post does.
        yield* TestClock.adjust("1 second");
        const followUp = Result.getOrThrow(
          yield* postInboxThread(agent, { key: ask.key, body: "Still needed." }),
        );
        yield* dmThreadPost({ organizationId, item: followUp, asked: false, wasOpen });

        const link = `https://vespin.dev/${slug}/inbox/${item.id}`;
        const posted = calls.filter((call) => call.method === "chat.postMessage");
        assert.equal(posted.length, 2);
        assert.equal(posted[0]?.args.channel, `U-${email}`);
        assert.equal(posted[0]?.args.thread_ts, undefined);
        assert.equal(posted[1]?.args.channel, "D0001");
        assert.equal(posted[1]?.args.thread_ts, "1700000000.000100");
        assert.deepEqual(blocksOf(posted[1])[1], { type: "markdown", text: "Still needed." });
        assert.equal(posted[0]?.args.text, "Require a review on main");
        assert.deepEqual(sent, [
          { url: "https://files.slack.com/upload/v1/settings.png", bytes: SCREENSHOT.bytes },
        ]);
        const shared = calls.filter((call) => call.method === "files.completeUploadExternal");
        assert.deepEqual(
          shared.map((call) => call.args),
          [
            {
              files: JSON.stringify([{ id: "F0001", title: "settings.png" }]),
              channel_id: "D0001",
              thread_ts: "1700000000.000100",
            },
          ],
        );
        assert.deepEqual(blocksOf(posted[0]), [
          { type: "header", text: { type: "plain_text", text: "Require a review on main" } },
          {
            type: "markdown",
            text: "Turn it on in [settings](https://github.com/acme/relay/settings).",
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Open in Vespin" },
                url: link,
              },
            ],
          },
        ]);

        const askId =
          item.thread?.find((message) => message.ask?.status === INBOX_ASK_STATUS.OPEN)?.id ?? "";
        yield* answerInboxAsk(agent.userId, item.id, {
          answers: { ask: askId, reply: INBOX_REPLY.DONE },
          text: "",
          clientKey: randomUUID(),
        });
        yield* settleThreadDms(item.id);
        yield* settleThreadDms(item.id);

        const updated = calls.filter((call) => call.method === "chat.update");
        assert.equal(updated.length, 1);
        assert.equal(updated[0]?.args.channel, "D0001");
        assert.equal(updated[0]?.args.ts, "1700000000.000100");
        assert.equal(updated[0]?.args.text, "Require a review on main · Answered in Vespin");
        assert.deepEqual(blocksOf(updated[0])[2], {
          type: "context",
          elements: [{ type: "plain_text", text: "Answered in Vespin" }],
        });
      }).pipe(Effect.provideService(SlackBot, slackBotOver(fakeSlack(calls), fakeFiles(sent))));
    },
  );
});
