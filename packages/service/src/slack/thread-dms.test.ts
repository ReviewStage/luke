import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import { linkSlackInstallation } from "@repo/database/models/slack-installation-store";
import { organization, user } from "@repo/database/schemas/auth";
import { inboxMessage } from "@repo/database/schemas/inbox-message";
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
 * Slack user and says the thread's title; the post is the first reply
 * in its Slack thread, the agent's Markdown in a `markdown` block, a mention
 * chip as a plain link, and a link to the thread, the post's picture shared
 * under it, and the title DM then says the open ask under the title; a
 * follow-up is another reply there; and an answer rewrites the post's reply
 * to say it was answered, and the title DM to say the title alone.
 *
 * Synthetic accounts, workspaces, and Slack ids throughout.
 */

/** One Web API call the fake Slack was handed. */
interface SlackCall {
  readonly method: string;
  readonly args: Readonly<Record<string, string>>;
}

/** A Slack that knows every member by their email, as `U-<email>`, and posts every message it is handed, each at a timestamp of its own; with `refuseFirstReply`, it refuses the first reply in a thread. */
function fakeSlack(calls: SlackCall[], refuseFirstReply = false): SlackWebApi {
  let posted = 0;
  let refused = !refuseFirstReply;
  return (method, args) => {
    calls.push({ method, args });
    switch (method) {
      case "users.lookupByEmail":
        return Effect.succeed({ ok: true, user: { id: `U-${args.email}` } });
      case "chat.postMessage":
        if (args.thread_ts !== undefined && !refused) {
          refused = true;
          return Effect.succeed({ ok: false, error: "ratelimited" });
        }
        posted += 1;
        return Effect.succeed({ ok: true, channel: "D0001", ts: `1700000000.00010${posted}` });
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
    descriptionSnapshot: "# Teammate invitations\n",
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
    "writes the member it waits on the title, the post and a follow-up as replies under it, says the open ask under the title, and says it was answered once they answer",
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
        const [title, reply, later, ...more] = calls.filter(
          (call) => call.method === "chat.postMessage",
        );
        assert.deepEqual(more, []);
        assert.equal(title?.args.channel, `U-${email}`);
        assert.equal(title?.args.thread_ts, undefined);
        assert.equal(title?.args.text, "📥 Require a review on main");
        assert.deepEqual(blocksOf(title), [
          { type: "header", text: { type: "plain_text", text: "📥 Require a review on main" } },
        ]);
        assert.equal(reply?.args.channel, "D0001");
        assert.equal(reply?.args.thread_ts, "1700000000.000101");
        assert.equal(later?.args.channel, "D0001");
        assert.equal(later?.args.thread_ts, "1700000000.000101");
        assert.deepEqual(blocksOf(later)[0], { type: "markdown", text: "Still needed." });
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
              thread_ts: "1700000000.000101",
            },
          ],
        );
        const [words, actions] = blocksOf(reply);
        assert.deepEqual(words, {
          type: "markdown",
          text: "Turn it on in [settings](https://github.com/acme/relay/settings).",
        });
        // The to-do's own buttons, answered by our Slack route, then the open button.
        assert.deepEqual(
          actions.elements.map((element: { text: { text: string } }) => element.text.text),
          ["Mark done", "Couldn't do it", "Open in Vespin"],
        );
        assert.equal(actions.elements.at(-1).url, link);

        const askId =
          item.thread?.find((message) => message.ask?.status === INBOX_ASK_STATUS.OPEN)?.id ?? "";
        yield* answerInboxAsk(agent.userId, item.id, {
          answers: { ask: askId, reply: INBOX_REPLY.DONE },
          text: "",
          clientKey: randomUUID(),
        });
        yield* settleThreadDms(item.id);
        yield* settleThreadDms(item.id);

        const header = {
          type: "header",
          text: { type: "plain_text", text: "📥 Require a review on main" },
        };
        const [asking, answered, untitled, ...again] = calls.filter(
          (call) => call.method === "chat.update",
        );
        assert.deepEqual(again, []);
        // The title DM says the open ask while it waits, and the title alone once it is answered.
        assert.equal(asking?.args.ts, "1700000000.000101");
        assert.deepEqual(blocksOf(asking), [header, words]);
        assert.equal(untitled?.args.ts, "1700000000.000101");
        assert.deepEqual(blocksOf(untitled), [header]);
        assert.equal(answered?.args.channel, "D0001");
        assert.equal(answered?.args.ts, "1700000000.000102");
        assert.equal(answered?.args.text, "Require a review on main · Answered in Vespin");
        assert.deepEqual(blocksOf(answered)[1], {
          type: "context",
          elements: [{ type: "plain_text", text: "Answered in Vespin" }],
        });
      }).pipe(Effect.provideService(SlackBot, slackBotOver(fakeSlack(calls), fakeFiles(sent))));
    },
  );

  it.effect(
    "a post whose reply Slack refused leaves its title DM the thread's, so the next ask replies under it",
    () => {
      const calls: SlackCall[] = [];
      return Effect.gen(function* () {
        const { agent, organizationId } = yield* openConnectedAgent;
        const ask = {
          key: "invite-expiry",
          title: "How long should an invitation last?",
          body: "A week?",
          ask: { type: INBOX_ASK.DECIDE, options: [{ label: "A week" }, { label: "A month" }] },
          needsReply: true,
        };
        const item = Result.getOrThrow(yield* postInboxThread(agent, ask));
        yield* dmThreadPost({ organizationId, item, asked: true, wasOpen: false });
        yield* TestClock.adjust("1 second");
        const again = Result.getOrThrow(
          yield* postInboxThread(agent, { ...ask, body: "Or a month?" }),
        );
        yield* dmThreadPost({ organizationId, item: again, asked: true, wasOpen: true });

        const posted = calls.filter((call) => call.method === "chat.postMessage");
        assert.deepEqual(
          posted.map((call) => call.args.thread_ts),
          [undefined, "1700000000.000101", "1700000000.000101"],
        );
        assert.deepEqual(blocksOf(posted[2])[0], { type: "markdown", text: "Or a month?" });
        // The title DM is never rewritten as a reply: it says the title and the ask now open.
        const updated = calls.filter((call) => call.method === "chat.update");
        assert.deepEqual(
          updated.map((call) => [call.args.ts, blocksOf(call)]),
          [
            [
              "1700000000.000101",
              [
                {
                  type: "header",
                  text: { type: "plain_text", text: "📥 How long should an invitation last?" },
                },
                { type: "markdown", text: "Or a month?" },
              ],
            ],
          ],
        );
      }).pipe(Effect.provideService(SlackBot, slackBotOver(fakeSlack(calls, true), fakeFiles([]))));
    },
  );

  it.effect("a DM from before the title stood alone keeps its title once its ask settles", () => {
    const calls: SlackCall[] = [];
    return Effect.gen(function* () {
      const { agent } = yield* openConnectedAgent;
      const ask = {
        key: "branch-protection",
        title: "Require a review on main",
        body: "Turn it on.",
        ask: { type: INBOX_ASK.DO, steps: [] },
        needsReply: true,
      };
      const item = Result.getOrThrow(yield* postInboxThread(agent, ask));
      const askId =
        item.thread?.find((message) => message.ask?.status === INBOX_ASK_STATUS.OPEN)?.id ?? "";
      // The DM as it was kept before, the post's words in the thread's first message.
      yield* (yield* Database)
        .update(inboxMessage)
        .set({ slackDm: { channel: "D0001", ts: "1700000000.000050", to: agent.userId } })
        .where(eq(inboxMessage.id, askId));
      yield* answerInboxAsk(agent.userId, item.id, {
        answers: { ask: askId, reply: INBOX_REPLY.DONE },
        text: "",
        clientKey: randomUUID(),
      });
      yield* settleThreadDms(item.id);

      const [updated] = calls.filter((call) => call.method === "chat.update");
      assert.equal(updated?.args.ts, "1700000000.000050");
      assert.deepEqual(blocksOf(updated).slice(0, 2), [
        { type: "header", text: { type: "plain_text", text: "📥 Require a review on main" } },
        { type: "markdown", text: "Turn it on." },
      ]);
    }).pipe(Effect.provideService(SlackBot, slackBotOver(fakeSlack(calls), fakeFiles([]))));
  });
});
