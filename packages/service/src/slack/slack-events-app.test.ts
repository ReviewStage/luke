import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { archiveAgent, createAgent, readAgent } from "@repo/database/models/agent-store";
import { claimRuntimeSession } from "@repo/database/models/recorded-session";
import {
  linkSlackInstallation,
  recordSlackAgentThread,
  writeSlackChannelRepository,
} from "@repo/database/models/slack-installation-store";
import { readTask } from "@repo/database/models/task-store";
import { agentTable } from "@repo/database/schemas/agent";
import { user } from "@repo/database/schemas/auth";
import { slackAgentThread } from "@repo/database/schemas/slack-installation";
import { messages } from "@repo/database/schemas/storage";
import {
  CONVERSATION_RUNTIME,
  type ConversationRuntime,
  SLACK_THREAD_ORIGIN,
} from "@repo/database/storage-vocabulary";
import { getTestDB, startTask } from "@repo/database/testing";
import { AGENT_PAYER } from "@repo/features/agent-wire";
import { INBOX_ASK, INBOX_ASK_STATUS, INBOX_MESSAGE_AUTHOR } from "@repo/features/inbox-wire";
import { AGENT_DEFAULT_CHOICE, MODEL_PROVIDER } from "@repo/features/models-wire";
import { TASK_STATUS, UNTITLED_TASK_NAME } from "@repo/features/task-wire";
import { eq } from "drizzle-orm";
import { Clock, DateTime, Effect, Layer, Option, Result } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { type AfterResponse, keptAfterResponse } from "../http/after-response.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { postInboxThread, readInboxItem } from "../inbox/inbox-store.js";
import { modelCatalogOf } from "../providers/model-catalog.js";
import { connectAgentApiKeys } from "../testing/agent-credentials.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
  openGithubUser,
} from "../testing/github-app-fake.js";
import { recordingHarness } from "../testing/native-harness-fake.js";
import { SlackBot, type SlackFileTransfer, type SlackWebApi, slackBotOver } from "./slack-bot.js";
import { slackEventsApp } from "./slack-events-app.js";
import { dmThreadPost } from "./thread-dms.js";

/**
 * Our Slack route, answered by its group the way a function answers it,
 * over a real store, a fake Slack, and a verifier standing in for Vercel's
 * keys: a press of a decide ask's option in the DM the bot wrote is
 * acknowledged before anything is done, then answers
 * the ask as the member it was written to, hands the agent its answer, and
 * rewrites the DM to say the option chosen, and a request Connect did not
 * sign is refused before anything of it is read; and a mention of the bot
 * starts an agent as the member Slack's email names on a task made for it,
 * replying with its link, and starts nothing for a Slack user who is no member; a message in
 * the thread of an archived agent brings it back and hands it the message,
 * and one in the thread of an agent whose session ended continues it in a
 * new agent on the same task, which the thread moves to; a member's reply under the DM of an inbox
 * thread is posted on that thread as theirs and starts no agent; and a
 * direct message sharing an image and no words starts an agent handed the
 * image.
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

/** A Slack that knows every member by their email, as `U-<email>`, and posts every message it is handed, each at the timestamp given. */
function fakeSlack(calls: SlackCall[], postedTs = "1700000000.000100"): SlackWebApi {
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
        return Effect.succeed({ ok: true, channel: "D0001", ts: postedTs });
      default:
        return Effect.succeed({ ok: true });
    }
  };
}

/** A one-pixel PNG, as a member shares a screenshot. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** A Slack whose every private file is the PNG, writing down each address read. */
function fakeFiles(read: string[]): SlackFileTransfer {
  return {
    send: () => Effect.void,
    read: (url) =>
      Effect.sync(() => {
        read.push(url);
        return new Uint8Array(PNG);
      }),
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

/** The decide ask the member is written: one option of two to pick. */
const PICK_ONE = {
  type: INBOX_ASK.DECIDE,
  options: [{ label: "A week" }, { label: "A month" }],
} as const;

/** A member's agent at work on a task in a workspace whose bot is connected, its decide ask written to them in Slack. */
const openAskedMember = (
  bot: Layer.Layer<SlackBot>,
  ask: Parameters<typeof postInboxThread>[1]["ask"] = PICK_ONE,
) =>
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
          ask,
          needsReply: true,
        },
      ),
    );
    yield* dmThreadPost({ organizationId, item, asked: true, wasOpen: false }).pipe(
      Effect.provide(bot),
    );
    return { owner, item };
  });

/** The installation the mention's workspace connects, reaching the repository its channel defaults to. */
const RELAY_INSTALLATION: InstallationFixture = {
  id: 8_100,
  login: "Acme",
  repositories: [{ owner: "Acme", name: "Relay" }],
};

/** The installation the thread agent below works through, its own since an installation stands in one workspace. */
const BEACON_INSTALLATION: InstallationFixture = {
  id: 8_101,
  login: "Acme",
  repositories: [{ owner: "Acme", name: "Beacon" }],
};

/** The group over the test's store, the bot, and the verifier, answering one request; its after-response work runs in place unless kept. */
const answer = (
  bot: Layer.Layer<SlackBot>,
  request: Request,
  after: Layer.Layer<AfterResponse> | Layer.Layer<never> = Layer.empty,
) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      Layer.succeed(HostedEnvironment, ENVIRONMENT),
      githubReaching([RELAY_INSTALLATION, BEACON_INSTALLATION]).layer,
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
      after,
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

/** Slack's press of the button, form-encoded as interactivity arrives, with Connect's bearer or none, and the message's checkboxes as they stand. */
function press(
  button: { readonly action_id: string; readonly value: string },
  slackUserId: string,
  bearer: string | undefined,
  state: Record<string, unknown> = {},
): Request {
  const payload = {
    type: "block_actions",
    user: { id: slackUserId, team_id: "T0001" },
    team: { id: "T0001", domain: "team" },
    container: { type: "message", channel_id: "D0001", message_ts: "1700000000.000100" },
    actions: [{ ...button, type: "button", block_id: "b", action_ts: "1700000001.000200" }],
    state: { values: state },
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

/** Slack's mention of the bot in the thread given by the Slack user given, as Connect forwards it with its bearer. */
function threadMention(slackUserId: string, eventId: string, threadTs: string): Request {
  const payload = {
    type: "event_callback",
    team_id: "T0001",
    event_id: eventId,
    authorizations: [{ user_id: "UBOT" }],
    event: {
      type: "app_mention",
      user: slackUserId,
      text: "<@UBOT> now make it faster",
      ts: "1700000003.000400",
      thread_ts: threadTs,
      channel: "C0001",
    },
  };
  return new Request(new URL(EVENTS, ORIGIN), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${CONNECT_TOKEN}` },
    body: JSON.stringify(payload),
  });
}

/** Slack's direct message to the bot by the Slack user given, sharing a PNG screenshot, a Mac's HEIC one, and a PDF with no words, as Connect forwards it. */
function directShare(slackUserId: string, eventId: string): Request {
  const shared = (name: string, mimetype: string) => ({
    name,
    mimetype,
    size: 120,
    url_private_download: `https://files.slack.com/files-pri/T0001-F0001/download/${name}`,
  });
  const payload = {
    type: "event_callback",
    team_id: "T0001",
    event_id: eventId,
    authorizations: [{ user_id: "UBOT" }],
    event: {
      type: "message",
      subtype: "file_share",
      channel_type: "im",
      user: slackUserId,
      text: "",
      ts: "1700000003.000400",
      channel: "D0002",
      files: [
        shared("screen.png", "image/png"),
        {
          ...shared("mac.heic", "image/heic"),
          thumb_720: "https://files.slack.com/files-tmb/T0001-F0002/mac_720.png",
        },
        shared("notes.pdf", "application/pdf"),
      ],
    },
  };
  return new Request(new URL(EVENTS, ORIGIN), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${CONNECT_TOKEN}` },
    body: JSON.stringify(payload),
  });
}

/** Slack's direct message to the bot by the Slack user given, in the thread of the DM given, as Connect forwards it. */
function dmReply(
  slackUserId: string,
  eventId: string,
  dm: { channel: string; ts: string },
): Request {
  const payload = {
    type: "event_callback",
    team_id: "T0001",
    event_id: eventId,
    authorizations: [{ user_id: "UBOT" }],
    event: {
      type: "message",
      channel_type: "im",
      user: slackUserId,
      text: "A week, but let admins extend it",
      ts: "1700000005.000600",
      thread_ts: dm.ts,
      channel: dm.channel,
    },
  };
  return new Request(new URL(EVENTS, ORIGIN), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${CONNECT_TOKEN}` },
    body: JSON.stringify(payload),
  });
}

/** A member's agent on the task a Slack message made, on the runtime given, in the Beacon repository where asked and none otherwise, started from a Slack thread of its own; with that thread and the Slack user their email names. */
const openThreadAgent = (runtime: ConversationRuntime, inBeacon: boolean) =>
  Effect.gen(function* () {
    const owner = yield* openGithubUser();
    yield* connectAgentApiKeys(owner);
    const task = yield* startTask(owner, {
      name: "Flaky tests",
      repository: inBeacon ? "Acme/Beacon" : null,
    });
    const { workspaceId } = task;
    yield* linkSlackInstallation({
      organizationId: workspaceId,
      teamId: "T0001",
      teamName: "Team",
      userId: owner,
    });
    if (inBeacon) yield* connectWorkspaceGitHub(workspaceId, BEACON_INSTALLATION);
    const started = yield* createAgent(owner, {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      model: AGENT_DEFAULT_CHOICE.model,
      effort: "high",
      planSnapshot: null,
      prompt: "find the flakiest test and fix it",
      repository: inBeacon ? "Acme/Beacon" : null,
      runtime,
      payer: AGENT_PAYER.API_KEY,
    });
    assert.ok(Option.isSome(started));
    const agent = started.value.agent;
    yield* claimRuntimeSession(
      { userId: owner, conversationId: agent.conversationId },
      `wrun_${randomUUID()}`,
      yield* DateTime.nowAsDate,
    );
    // Note that each agent's thread is its own, because a message is read against every workspace of the team, oldest first.
    const threadTs = `1700000001.${randomUUID().replace(/\D/gu, "").slice(0, 6)}`;
    yield* recordSlackAgentThread({
      organizationId: workspaceId,
      channelId: "C0001",
      threadTs,
      agentId: agent.id,
      userId: owner,
      origin: SLACK_THREAD_ORIGIN.START,
    });
    const [row] = yield* (yield* Database)
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, owner));
    return { owner, agent, taskId: task.id, threadTs, slackUserId: `U-${row?.email}` };
  });

it.layer(getTestDB())("our Slack route", (it) => {
  it.effect(
    "a press Connect signed is acknowledged first, then answers the ask as the member it was written to, tells the agent, and says the choice in the DM; one unsigned is refused",
    () => {
      const calls: SlackCall[] = [];
      const bot = Layer.succeed(SlackBot, slackBotOver(fakeSlack(calls)));
      return Effect.gen(function* () {
        const { owner, item } = yield* openAskedMember(bot);
        // The DM saying the thread's title, then the ask as a reply under it.
        const [title, posted] = calls.filter((call) => call.method === "chat.postMessage");
        const [actions] = JSON.parse(posted?.args.blocks ?? "[]").filter(
          (block: { type: string }) => block.type === "actions",
        );
        const [month] = actions.elements.filter(
          (element: { text: { text: string } }) => element.text.text === "A month",
        );
        const slackUserId = title?.args.channel ?? "";
        const askStatus = Effect.map(
          readInboxItem(owner, item.id),
          (stored) => Option.getOrThrow(stored).item.thread?.find((m) => m.ask)?.ask?.status,
        );

        const unsigned = yield* answer(bot, press(month, slackUserId, undefined));
        const stillOpen = yield* askStatus;
        const kept = keptAfterResponse();
        const signed = yield* answer(bot, press(month, slackUserId, CONNECT_TOKEN), kept.layer);
        const atAnswer = yield* askStatus;
        // The press's work, then the settle of the DM it hands on once the answer is taken.
        yield* kept.run;
        yield* kept.run;

        assert.deepEqual(unsigned, {
          status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
          body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
        });
        assert.equal(stillOpen, INBOX_ASK_STATUS.OPEN);
        assert.deepEqual(signed, { status: HOSTED_HTTP_STATUS.OK, body: {} });
        assert.equal(atAnswer, INBOX_ASK_STATUS.OPEN);
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
    "a Submit of an ask taking several options answers it with the options ticked in the DM",
    () => {
      const calls: SlackCall[] = [];
      const bot = Layer.succeed(SlackBot, slackBotOver(fakeSlack(calls)));
      return Effect.gen(function* () {
        const { owner, item } = yield* openAskedMember(bot, {
          type: INBOX_ASK.DECIDE,
          options: [{ label: "Email" }, { label: "Slack" }, { label: "SMS" }],
          multiple: true,
        });
        const [title, posted] = calls.filter((call) => call.method === "chat.postMessage");
        const elements = JSON.parse(posted?.args.blocks ?? "[]").flatMap(
          (block: { type: string; elements?: unknown[] }) =>
            block.type === "actions" ? (block.elements ?? []) : [],
        );
        const checkboxes = elements.find(
          (element: { type: string }) => element.type === "checkboxes",
        );
        const submit = elements.find(
          (element: { text?: { text: string } }) => element.text?.text === "Submit",
        );
        const ticked = checkboxes.options.filter(
          (option: { text: { text: string } }) => option.text.text !== "Slack",
        );

        const kept = keptAfterResponse();
        yield* answer(
          bot,
          press(submit, title?.args.channel ?? "", CONNECT_TOKEN, {
            picks: {
              [checkboxes.action_id]: { type: "checkboxes", selected_options: ticked },
            },
          }),
          kept.layer,
        );
        yield* kept.run;
        yield* kept.run;

        const stored = Option.getOrThrow(yield* readInboxItem(owner, item.id));
        const asked = stored.item.thread?.find((message) => message.ask);
        assert.equal(asked?.ask?.status, INBOX_ASK_STATUS.ANSWERED);
        const updated = calls.filter((call) => call.method === "chat.update");
        assert.equal(
          updated[0]?.args.text,
          "How long should an invitation last? · You chose Email, SMS",
        );
      });
    },
  );

  it.effect(
    "a to-do's DM lists its steps, and its Mark done answers it with every step ticked",
    () => {
      const calls: SlackCall[] = [];
      const bot = Layer.succeed(SlackBot, slackBotOver(fakeSlack(calls)));
      return Effect.gen(function* () {
        const { owner, item } = yield* openAskedMember(bot, {
          type: INBOX_ASK.DO,
          steps: ["Open the repository's settings.", "Run this:\n```\npnpm install\n```"],
        });
        const [title, posted] = calls.filter((call) => call.method === "chat.postMessage");
        const blocks = JSON.parse(posted?.args.blocks ?? "[]");
        const done = blocks
          .flatMap((block: { type: string; elements?: unknown[] }) =>
            block.type === "actions" ? (block.elements ?? []) : [],
          )
          .find((element: { text?: { text: string } }) => element.text?.text === "Mark done");

        const kept = keptAfterResponse();
        yield* answer(bot, press(done, title?.args.channel ?? "", CONNECT_TOKEN), kept.layer);
        yield* kept.run;
        yield* kept.run;

        const words =
          "Pick how long an invitation stays open.\n\n1. Open the repository's settings.\n\n2. Run this:\n   ```\n   pnpm install\n   ```";
        assert.equal(blocks[0]?.text, words);
        const stored = Option.getOrThrow(yield* readInboxItem(owner, item.id));
        const asked = stored.item.thread?.find((message) => message.ask);
        assert.equal(asked?.ask?.status, INBOX_ASK_STATUS.ANSWERED);
        const updated = calls.filter((call) => call.method === "chat.update");
        assert.equal(
          updated[0]?.args.text,
          "How long should an invitation last? · You marked it done",
        );
        // The settled DM keeps the steps it asked.
        assert.equal(JSON.parse(updated[0]?.args.blocks ?? "[]")[0]?.text, words);
      });
    },
  );

  it.effect(
    "a mention starts an agent as the member Slack's email names, on an untitled task with a blank plan in its channel's repository, reacts to it with 👀, and replies with the agent's link; one from no member starts nothing",
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
        yield* connectWorkspaceGitHub(task.workspaceId, RELAY_INSTALLATION);
        yield* writeSlackChannelRepository(task.workspaceId, "C0001", "Acme/Relay");
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
        const [refused, ...others] = replies();
        assert.match(refused?.args.text ?? "", /couldn't find you/u);
        const reactions = calls.filter((call) => call.method === "reactions.add");
        assert.deepEqual(
          reactions.map((call) => call.args),
          [{ channel: "C0001", timestamp: "1700000002.000300", name: "eyes" }],
        );
        const [startedAgent] = yield* (yield* Database)
          .select({
            agentId: agentTable.id,
            taskId: agentTable.taskId,
            prompt: agentTable.prompt,
            repository: agentTable.repository,
            source: agentTable.source,
            metadata: messages.metadata,
          })
          .from(slackAgentThread)
          .innerJoin(agentTable, eq(agentTable.id, slackAgentThread.agentId))
          .innerJoin(messages, eq(messages.conversationId, agentTable.conversationId))
          .where(eq(slackAgentThread.userId, owner));
        assert.equal(startedAgent?.repository, "Acme/Relay");
        // The thread links the agent at once, before its first turn settles.
        assert.deepEqual(
          others.map((call) => call.args.thread_ts),
          ["1700000002.000300"],
        );
        assert.ok(
          others[0]?.args.text?.startsWith("On it in Acme/Relay.") &&
            others[0].args.text.includes(`/agent/${startedAgent?.agentId}`),
          "the reply says where the agent works and links it",
        );
        const made = Option.getOrThrow(yield* readTask(owner, startedAgent?.taskId ?? ""));
        assert.deepEqual(
          {
            name: made.task.name,
            assignee: made.task.assignee?.userId,
            repository: made.task.repository,
            status: made.task.status,
            plan: made.text,
          },
          {
            name: UNTITLED_TASK_NAME,
            assignee: owner,
            repository: "Acme/Relay",
            status: TASK_STATUS.IN_PROGRESS,
            plan: "",
          },
          "the agent works on a task the message made, left for its title to name and assigned to its writer",
        );
        assert.ok(
          startedAgent?.prompt?.startsWith("find the flakiest test and fix it"),
          "the message is the agent's prompt",
        );
        // The agent keeps where it came from, which the lists mark it by.
        assert.deepEqual(startedAgent?.source, {
          kind: "slack",
          url: "https://team.slack.com/archives/C0001/p1",
        });
        // The first line says Slack carried it, with the member's own words alone, for a window to draw.
        assert.deepEqual(startedAgent?.metadata, {
          channel: "slack",
          words: "find the flakiest test and fix it",
          url: "https://team.slack.com/archives/C0001/p1",
        });
      });
    },
  );

  it.effect(
    "a message in the thread of an archived agent brings it back, hands it the message, and reacts with 👀",
    () => {
      const calls: SlackCall[] = [];
      const bot = Layer.succeed(SlackBot, slackBotOver(fakeSlack(calls)));
      return Effect.gen(function* () {
        const { owner, agent, threadTs, slackUserId } = yield* openThreadAgent(
          CONVERSATION_RUNTIME.CLAUDE_CODE,
          false,
        );
        yield* archiveAgent(owner, agent.id, true);

        const answered = yield* answer(
          bot,
          threadMention(slackUserId, `Ev${randomUUID()}`, threadTs),
        );

        assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(Option.getOrThrow(yield* readAgent(owner, agent.id)).archivedAt, null);
        assert.deepEqual(HARNESS.heard.at(-1), { call: "send", account: owner });
        assert.deepEqual(
          calls.filter((call) => call.method === "chat.postMessage"),
          [],
        );
        assert.deepEqual(
          calls.filter((call) => call.method === "reactions.add").map((call) => call.args),
          [{ channel: "C0001", timestamp: "1700000003.000400", name: "eyes" }],
        );
      });
    },
  );

  it.effect(
    "a message in the thread of an agent whose session ended continues it in a new agent on the same task, moves the thread to it, and links it once",
    () => {
      const calls: SlackCall[] = [];
      const bot = Layer.succeed(SlackBot, slackBotOver(fakeSlack(calls)));
      return Effect.gen(function* () {
        // An agent left on eve runs on no harness, so its session has ended for good.
        const { owner, agent, taskId, threadTs, slackUserId } = yield* openThreadAgent(
          CONVERSATION_RUNTIME.EVE,
          true,
        );

        const answered = yield* answer(
          bot,
          threadMention(slackUserId, `Ev${randomUUID()}`, threadTs),
        );

        assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
        const [thread] = yield* (yield* Database)
          .select({ agentId: slackAgentThread.agentId })
          .from(slackAgentThread)
          .innerJoin(agentTable, eq(agentTable.id, slackAgentThread.agentId))
          .where(eq(agentTable.userId, owner));
        assert.ok(thread !== undefined && thread.agentId !== agent.id);
        const continued = Option.getOrThrow(yield* readAgent(owner, thread.agentId));
        assert.deepEqual(continued.startedFrom?.agentId, agent.id);
        assert.equal(continued.taskId, taskId, "the new agent works on the ended one's task");
        assert.deepEqual(HARNESS.heard.at(-1), { call: "open", account: owner });
        const replies = calls.filter((call) => call.method === "chat.postMessage");
        assert.equal(replies.length, 1);
        assert.equal(replies[0]?.args.thread_ts, threadTs);
        assert.match(replies[0]?.args.text ?? "", /had stopped/u);
        assert.deepEqual(
          calls.filter((call) => call.method === "reactions.add").map((call) => call.args),
          [{ channel: "C0001", timestamp: "1700000003.000400", name: "eyes" }],
        );
      });
    },
  );

  it.effect(
    "a reply under a thread's DM is posted on that thread as the member it went to, tells the agent, reacts with 👀, and starts no agent",
    () => {
      const calls: SlackCall[] = [];
      // Note that the DM's timestamp is this test's own, because the store is shared with the press above.
      const bot = Layer.succeed(SlackBot, slackBotOver(fakeSlack(calls, "1700000004.000500")));
      return Effect.gen(function* () {
        const { owner, item } = yield* openAskedMember(bot);
        const posted = calls.find((call) => call.method === "chat.postMessage");
        const slackUserId = posted?.args.channel ?? "";
        const opened = HARNESS.heard.filter((heard) => heard.call === "open").length;

        const replied = yield* answer(
          bot,
          dmReply(slackUserId, `Ev${randomUUID()}`, { channel: "D0001", ts: "1700000004.000500" }),
        );

        assert.equal(replied.status, HOSTED_HTTP_STATUS.OK);
        const thread = Option.getOrThrow(yield* readInboxItem(owner, item.id)).item.thread ?? [];
        assert.deepEqual(
          thread
            .filter((message) => message.author === INBOX_MESSAGE_AUTHOR.MEMBER)
            .map((m) => m.text),
          ["A week, but let admins extend it"],
        );
        assert.equal(thread.find((message) => message.ask)?.ask?.status, INBOX_ASK_STATUS.OPEN);
        assert.deepEqual(HARNESS.heard.at(-1), { call: "send", account: owner });
        assert.equal(HARNESS.heard.filter((heard) => heard.call === "open").length, opened);
        assert.deepEqual(
          yield* (yield* Database)
            .select({ agentId: slackAgentThread.agentId })
            .from(slackAgentThread)
            .where(eq(slackAgentThread.threadTs, "1700000004.000500")),
          [],
        );
        assert.deepEqual(
          calls.filter((call) => call.method === "reactions.add").map((call) => call.args),
          [{ channel: "D0001", timestamp: "1700000005.000600", name: "eyes" }],
        );
      });
    },
  );
  it.effect(
    "a direct message sharing images and no words starts an agent handed them, a HEIC one as Slack's thumbnail, and leaves the PDF beside them out",
    () => {
      const calls: SlackCall[] = [];
      const read: string[] = [];
      const bot = Layer.succeed(SlackBot, slackBotOver(fakeSlack(calls), fakeFiles(read)));
      return Effect.gen(function* () {
        const owner = yield* openGithubUser();
        yield* connectAgentApiKeys(owner);
        const task = yield* startTask(owner, { name: "Shared screenshots" });
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

        const started = yield* answer(bot, directShare(`U-${row?.email}`, `Ev${randomUUID()}`));

        assert.equal(started.status, HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(HARNESS.heard.at(-1), { call: "open", account: owner });
        assert.deepEqual(read, [
          "https://files.slack.com/files-pri/T0001-F0001/download/screen.png",
          "https://files.slack.com/files-tmb/T0001-F0002/mac_720.png",
        ]);
        const [first] = yield* (yield* Database)
          .select({ parts: messages.parts })
          .from(slackAgentThread)
          .innerJoin(agentTable, eq(agentTable.id, slackAgentThread.agentId))
          .innerJoin(messages, eq(messages.conversationId, agentTable.conversationId))
          .where(eq(slackAgentThread.channelId, "D0002"));
        const files = (first?.parts ?? []).flatMap((part) =>
          part.type === "file" ? [{ filename: part.filename, mediaType: part.mediaType }] : [],
        );
        assert.deepEqual(files, [
          { filename: "screen.png", mediaType: "image/png" },
          { filename: "mac.heic", mediaType: "image/png" },
        ]);
      });
    },
  );
});
