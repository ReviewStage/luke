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
import { answerInboxAsk, postInboxThread } from "../inbox/inbox-store.js";
import { SlackBot, type SlackWebApi, slackBotOver } from "./slack-bot.js";
import { dmThreadPost, settleThreadDms, threadStandsOpen } from "./thread-dms.js";

/**
 * A thread an agent posts, written by our Slack bot to the member it waits
 * on, over a real store and a fake Slack: the DM goes to that member's
 * Slack user, says the thread's title and words, and links to the thread; a
 * follow-up that asks nothing new writes none; and an answer rewrites the
 * DM to say it was answered.
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
      default:
        return Effect.succeed({ ok: true });
    }
  };
}

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
  it.effect("writes the member it waits on once, and says it was answered once they answer", () => {
    const calls: SlackCall[] = [];
    return Effect.gen(function* () {
      const { agent, organizationId, email, slug } = yield* openConnectedAgent;
      const ask = {
        key: "branch-protection",
        title: "Require a review on main",
        body: "Turn it on in [@settings](https://github.com/acme/relay/settings).",
        ask: { type: INBOX_ASK.DO, steps: [] },
        needsReply: true,
      };
      const item = Result.getOrThrow(yield* postInboxThread(agent, ask));
      yield* dmThreadPost({ organizationId, item, asked: true, wasOpen: false });
      const wasOpen = yield* threadStandsOpen(agent, ask.key);
      const followUp = Result.getOrThrow(
        yield* postInboxThread(agent, { key: ask.key, body: "Still needed." }),
      );
      yield* dmThreadPost({ organizationId, item: followUp, asked: false, wasOpen });

      const link = `https://vespin.dev/${slug}/agent/${agent.agentId}/inbox/${item.id}`;
      const posted = calls.filter((call) => call.method === "chat.postMessage");
      assert.equal(posted.length, 1);
      assert.equal(posted[0]?.args.channel, `U-${email}`);
      assert.equal(posted[0]?.args.text, "Require a review on main");
      assert.deepEqual(blocksOf(posted[0]), [
        { type: "header", text: { type: "plain_text", text: "Require a review on main" } },
        { type: "section", text: { type: "plain_text", text: "Turn it on in settings." } },
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
    }).pipe(Effect.provideService(SlackBot, slackBotOver(fakeSlack(calls))));
  });
});
