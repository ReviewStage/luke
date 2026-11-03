import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import { claimRuntimeSession } from "@repo/database/models/recorded-session";
import { linkSlackInstallation } from "@repo/database/models/slack-installation-store";
import { user } from "@repo/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, startTask } from "@repo/database/testing";
import { AGENT_PAYER } from "@repo/features/agent-wire";
import { INBOX_ASK, INBOX_ASK_STATUS } from "@repo/features/inbox-wire";
import { AGENT_DEFAULT_CHOICE, MODEL_PROVIDER } from "@repo/features/models-wire";
import { eq } from "drizzle-orm";
import { Clock, DateTime, Effect, Layer, Option, Result } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { postInboxThread, readInboxItem } from "../inbox/inbox-store.js";
import { modelCatalogOf } from "../providers/model-catalog.js";
import { connectAgentApiKeys } from "../testing/agent-credentials.js";
import { githubReaching, openGithubUser } from "../testing/github-app-fake.js";
import { recordingHarness } from "../testing/native-harness-fake.js";
import { SlackBot, type SlackWebApi, slackBotOver } from "./slack-bot.js";
import { slackEventsApp } from "./slack-events-app.js";
import { dmThreadPost } from "./thread-dms.js";

/**
 * Our Slack route, answered by its group the way a function answers it,
 * over a real store, a fake Slack, and a verifier standing in for Vercel's
 * keys: a press of a decide ask's option in the DM the bot wrote answers
 * the ask as the member it was written to, hands the agent its answer, and
 * rewrites the DM to say the option chosen, and a request Connect did not
 * sign is refused before anything of it is read; and a mention of the bot
 * starts an agent as the member Slack's email names, replying with its
 * link, and starts nothing for a Slack user who is no member.
 *
 * Synthetic accounts, workspaces, tokens, and Slack ids throughout.
 */

const ORIGIN = "https://app.test";
const EVENTS = "/api/slack/events";
const CONNECT_TOKEN = "connect-oidc-fixture";

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
      case "users.info": {
        const email = args.user?.startsWith("U-") ? args.user.slice(2) : undefined;
        return Effect.succeed({
          ok: true,
          user: { profile: email === undefined ? {} : { email } },
        });
      }
      case "chat.getPermalink":
        return Effect.succeed({ ok: true, permalink: "https://team.slack.com/archives/C0001/p1" });
      case "chat.postMessage":
        return Effect.succeed({ ok: true, channel: "D0001", ts: "1700000000.000100" });
      default:
        return Effect.succeed({ ok: true });
    }
  };
}

/** Connect's bearer as the deployment's verifier holds it: the fixture token alone. */
const verify = (request: Request) =>
  request.headers.get("authorization") === `Bearer ${CONNECT_TOKEN}`;

const ENVIRONMENT: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
};

/** The native harnesses an answer is handed to, writing down each with the account it acted for. */
const HARNESS = recordingHarness();

/** A member's agent at work on a task in a workspace whose bot is connected, its decide ask written to them in Slack. */
const openAskedMember = (bot: Layer.Layer<SlackBot>) =>
  Effect.gen(function* () {
    const owner = yield* openGithubUser();
    yield* connectAgentApiKeys(owner);
    const task = yield* startTask(owner, { name: "Teammate invitations" });
    const started = yield* createAgent(owner, {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      planSnapshot: "# Teammate invitations\n",
      prompt: null,
      repository: null,
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
      payer: AGENT_PAYER.API_KEY,
    });
    assert.ok(Option.isSome(started));
    const agent = started.value.agent;
    yield* claimRuntimeSession(
      { userId: owner, conversationId: agent.conversationId },
      `wrun_${randomUUID()}`,
      yield* DateTime.nowAsDate,
    );
    const organizationId = task.workspaceId;
    yield* linkSlackInstallation({
      organizationId,
      teamId: "T0001",
      teamName: "Team",
      userId: owner,
    });
    const item = Result.getOrThrow(
      yield* postInboxThread(
        { userId: owner, taskId: task.id, agentId: agent.id },
        {
          key: "invite-expiry",
          title: "How long should an invitation last?",
          body: "Pick how long an invitation stays open.",
          ask: { type: INBOX_ASK.DECIDE, options: [{ label: "A week" }, { label: "A month" }] },
          needsReply: true,
        },
      ),
    );
    yield* dmThreadPost({ organizationId, item, asked: true, wasOpen: false }).pipe(
      Effect.provide(bot),
    );
    return { owner, item };
  });

/** The group over the test's store, the bot, and the verifier, answering one request. */
const answer = (bot: Layer.Layer<SlackBot>, request: Request) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      Layer.succeed(HostedEnvironment, ENVIRONMENT),
      githubReaching([]).layer,
      modelCatalogOf([
        {
          id: AGENT_DEFAULT_CHOICE.model,
          name: "Claude Opus 5.5",
          provider: MODEL_PROVIDER.ANTHROPIC,
          efforts: ["low", "medium", "high", "max"],
        },
      ]),
      HARNESS.layer,
      bot,
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      slackEventsApp(verify).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const response = yield* Effect.promise(() => handler(request));
    const body: unknown = yield* Effect.promise(() => response.json());
    yield* Effect.promise(() => dispose());
    return { status: response.status, body };
  });

/** Slack's press of the button, form-encoded as interactivity arrives, with Connect's bearer or none. */
function press(
  button: { readonly action_id: string; readonly value: string },
  slackUserId: string,
  bearer: string | undefined,
): Request {
  const payload = {
    type: "block_actions",
    user: { id: slackUserId, team_id: "T0001" },
    team: { id: "T0001", domain: "team" },
    container: { type: "message", channel_id: "D0001", message_ts: "1700000000.000100" },
    actions: [{ ...button, type: "button", block_id: "b", action_ts: "1700000001.000200" }],
  };
  return new Request(new URL(EVENTS, ORIGIN), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(bearer === undefined ? undefined : { authorization: `Bearer ${bearer}` }),
    },
    body: new URLSearchParams({ payload: JSON.stringify(payload) }).toString(),
  });
}

/** Slack's mention of the bot in a channel by the Slack user given, as Connect forwards it with its bearer. */
function mention(slackUserId: string, eventId: string): Request {
  const payload = {
    type: "event_callback",
    team_id: "T0001",
    event_id: eventId,
    authorizations: [{ user_id: "UBOT" }],
    event: {
      type: "app_mention",
      user: slackUserId,
      text: "<@UBOT> find the flakiest test and fix it",
      ts: "1700000002.000300",
      channel: "C0001",
    },
  };
  return new Request(new URL(EVENTS, ORIGIN), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${CONNECT_TOKEN}` },
    body: JSON.stringify(payload),
  });
}

it.layer(getTestDB())("our Slack route", (it) => {
  it.effect(
    "a press Connect signed answers the ask as the member it was written to, tells the agent, and says the choice in the DM; one unsigned is refused",
    () => {
      const calls: SlackCall[] = [];
      const bot = Layer.succeed(SlackBot, slackBotOver(fakeSlack(calls)));
      return Effect.gen(function* () {
        const { owner, item } = yield* openAskedMember(bot);
        const posted = calls.find((call) => call.method === "chat.postMessage");
        const [actions] = JSON.parse(posted?.args.blocks ?? "[]").filter(
          (block: { type: string }) => block.type === "actions",
        );
        const [month] = actions.elements.filter(
          (element: { text: { text: string } }) => element.text.text === "A month",
        );
        const slackUserId = posted?.args.channel ?? "";
        const askStatus = Effect.map(
          readInboxItem(owner, item.id),
          (stored) => Option.getOrThrow(stored).item.thread?.find((m) => m.ask)?.ask?.status,
        );

        const unsigned = yield* answer(bot, press(month, slackUserId, undefined));
        const stillOpen = yield* askStatus;
        const signed = yield* answer(bot, press(month, slackUserId, CONNECT_TOKEN));

        assert.deepEqual(unsigned, {
          status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
          body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
        });
        assert.equal(stillOpen, INBOX_ASK_STATUS.OPEN);
        assert.equal(signed.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(yield* askStatus, INBOX_ASK_STATUS.ANSWERED);
        assert.deepEqual(
          HARNESS.heard.filter((heard) => heard.account === owner),
          [{ call: "send", account: owner }],
        );
        const updated = calls.filter((call) => call.method === "chat.update");
        assert.equal(updated.length, 1);
        assert.equal(
          updated[0]?.args.text,
          "How long should an invitation last? · You chose A month",
        );
      });
    },
  );

  it.effect(
    "a mention starts an agent as the member Slack's email names and replies with its link; one from no member starts nothing",
    () => {
      const calls: SlackCall[] = [];
      const bot = Layer.succeed(SlackBot, slackBotOver(fakeSlack(calls)));
      return Effect.gen(function* () {
        const owner = yield* openGithubUser();
        yield* connectAgentApiKeys(owner);
        const task = yield* startTask(owner, { name: "Flaky tests" });
        yield* linkSlackInstallation({
          organizationId: task.workspaceId,
          teamId: "T0001",
          teamName: "Team",
          userId: owner,
        });
        const [row] = yield* (yield* Database)
          .select({ email: user.email })
          .from(user)
          .where(eq(user.id, owner));
        const opened = () => HARNESS.heard.filter((heard) => heard.call === "open").length;
        const replies = () =>
          calls.filter((call) => call.method === "chat.postMessage" && call.args.thread_ts);

        const before = opened();
        const stranger = yield* answer(bot, mention("U-nobody@app.test", `Ev${randomUUID()}`));
        const afterStranger = opened();
        const started = yield* answer(bot, mention(`U-${row?.email}`, `Ev${randomUUID()}`));

        assert.equal(stranger.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(afterStranger, before);
        assert.equal(started.status, HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(HARNESS.heard.at(-1), { call: "open", account: owner });
        const [refused, onIt] = replies();
        assert.match(refused?.args.text ?? "", /couldn't find you/u);
        assert.equal(onIt?.args.thread_ts, "1700000002.000300");
        assert.match(onIt?.args.text ?? "", /^On it: https:\/\/.+\/agent\//u);
      });
    },
  );
});
