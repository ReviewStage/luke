import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { writeAccountPreferences } from "@luke/database/models/account-store";
import {
  ensureGeneral,
  ensureMember,
  openTopicChannel,
  postAsk,
  postMessage,
} from "@luke/database/models/chat-store";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { claimRuntimeSession } from "@luke/database/models/recorded-session";
import { createTask } from "@luke/database/models/task-store";
import { type AwaitingLineMetadata, storeWriter } from "@luke/database/models/writer";
import { user } from "@luke/database/schemas/auth";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import {
  getTestDB,
  joinWorkspace,
  openWorkspace,
  startTask,
  turnIntoDm,
} from "@luke/database/testing";
import { HOSTED_API_ERROR } from "@luke/features";
import {
  CHANNEL_KIND,
  CHAT_ASK,
  CHAT_BLOCK,
  CHAT_CURSOR_START,
  chatAnswerSchema,
  MEMBER_KIND,
} from "@luke/features/chat-wire";
import { EXPERIMENT } from "@luke/settings";
import { MESSAGE_AUTHOR, MESSAGE_CHANNEL, unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import {
  Clock,
  type Context,
  DateTime,
  Duration,
  Effect,
  Fiber,
  Layer,
  Option,
  Queue,
  Redacted,
  Result,
} from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { LINK_OUTCOME } from "../github/github-installations.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { announcingClock, driven } from "../testing/clock-driven.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
  openGithubUser,
} from "../testing/github-app-fake.js";
import { agentLineOf } from "./agent-line.js";
import { BRAIN_HOST_HEADER } from "./brain-host/bounds.js";
import { CODER } from "./coder-host/bounds.js";
import { messagesProcedures } from "./messages-procedures.js";
import { writeWorkspaceChat } from "./workspace-chat.js";

/**
 * The window's read of a workspace's chat, answered by the hosted oRPC
 * router the way the web route answers it, over a real dialect: held while nothing moved past
 * the reader's cursor and answered once a post lands, answered at once
 * where something already has, a changed ask read again, and a workspace
 * the account is not in answered as nothing. The clock is the test's, each
 * wait the route makes announced so the test moves it one step at a time.
 * And a teammate's post to an agent, with no eve handed in, tells the agent
 * through eve as the deployment acting for its starter, under the
 * deployment's own secret and never the cron's the same environment holds.
 * Synthetic accounts, bearers, and words throughout.
 */

const ORIGIN = "https://luke.test";
const CHAT = "/api/workspaces/chat";

/** The deployment's environment with no key of its own: nothing here reaches eve. */
const NO_KEYS: HostedEnvironmentValues = {
  openAiKey: undefined,
  anthropicKey: undefined,
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  eveDeploymentSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
};

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** Turns the Chat experiment on or off for the account, as Settings › Experimental does. */
const chooseChat = (userId: string, on: boolean) =>
  writeAccountPreferences(userId, { experiments: { [EXPERIMENT.CHAT]: on } });

/** An account of its own, with a name its handle is a slug of, Chat turned on unless it is asked off. */
const openAccount = (name: string, chat = true) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id, name, email: `${id}@luke.test` });
    if (chat) yield* chooseChat(id, true);
    return id;
  });

/**
 * A workspace its owner and a teammate are in, an account outside it, and
 * the group over the test's database and an announcing clock, answering
 * the bearer as the account it names.
 */
const openRoom = Effect.gen(function* () {
  const owner = yield* openAccount("Ada Lovelace");
  const teammate = yield* openAccount("Grace Hopper");
  const stranger = yield* openAccount("Test User");
  const quiet = yield* openAccount("Katherine Johnson", false);
  const workspace = yield* openWorkspace(owner);
  yield* joinWorkspace(workspace, teammate);
  yield* joinWorkspace(workspace, quiet);
  const { clock, asleep } = yield* announcingClock;
  const client = yield* SqlClient.SqlClient;
  const services = Layer.mergeAll(
    Layer.succeed(SqlClient.SqlClient, client),
    Layer.succeed(Database, yield* Database),
    Layer.succeed(Clock.Clock, clock),
    githubReaching([]).layer,
    Layer.succeed(HostedEnvironment, NO_KEYS),
  );
  // SAFETY: the chat's procedures yield the store, GitHub, the clock, and the environment alone, which is all a test provides of the web runtime's services.
  const webServices = (yield* Effect.context<never>().pipe(
    Effect.provide(services),
  )) as Context.Context<WebServices>;
  const handle = hostedFetch({
    messages: messagesProcedures({
      eveOrigin: () => undefined,
      resolveUserId: (incoming: Request) =>
        Effect.succeed(
          Option.fromNullishOr(
            new Map([owner, teammate, stranger, quiet].map((id) => [`Bearer ${id}`, id])).get(
              incoming.headers.get("authorization") ?? "",
            ),
          ),
        ),
    }),
  });
  const ask = (bearer: string | undefined, query: Record<string, string>, method = "GET") =>
    Effect.gen(function* () {
      const url = new URL(CHAT, ORIGIN);
      for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
      const response = yield* Effect.promise(() =>
        handle(
          new Request(url, {
            method,
            headers: bearer === undefined ? {} : { authorization: `Bearer ${bearer}` },
          }),
          webServices,
        ),
      );
      // SAFETY: the group answers JSON; the test compares it as the wire value it is.
      const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
      return { status: response.status, body } satisfies Answer;
    });
  /** The chat as the account reads it past the cursor, read as the wire declares it. */
  const read = (after: string, bearer = owner) =>
    Effect.map(ask(bearer, { workspaceId: workspace, after }), chatOf);
  /** The teammate's words posted in the workspace's general channel. */
  const post = (text: string) =>
    Effect.gen(function* () {
      const general = Option.getOrThrow(yield* ensureGeneral(teammate, workspace));
      const grace = Option.getOrThrow(
        yield* ensureMember(teammate, workspace, { kind: MEMBER_KIND.HUMAN, userId: teammate }),
      );
      const posted = yield* postMessage(teammate, workspace, {
        authorMemberId: grace.id,
        to: { channelId: general.id },
        blocks: [{ type: CHAT_BLOCK.MARKDOWN, text }],
        clientKey: randomUUID(),
      });
      return { grace, general, message: Result.getOrThrow(posted).message };
    });
  return { owner, teammate, stranger, quiet, workspace, asleep, ask, read, post };
});

/** An answer read as the chat's, failing the test where it is not one. */
function chatOf(answered: Answer) {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK, JSON.stringify(answered.body));
  const read = readEither(chatAnswerSchema)(unparsedWire(answered.body));
  if (Result.isFailure(read)) return assert.fail(`not the wire's: ${read.failure.refusal}`);
  return read.success;
}

/** The words of each message, in order. */
const wordsOf = (messages: readonly { readonly blocks: readonly unknown[] }[]) =>
  messages.map((message) => message.blocks.map((block) => JSON.stringify(block)).join());

const markdown = (text: string) => JSON.stringify({ type: CHAT_BLOCK.MARKDOWN, text });

it.layer(getTestDB())("the window's read of a workspace's chat", (it) => {
  it.effect(
    "a first read makes the reader's member and the general channel, and a read at the head is held until a post lands",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const first = yield* room.read(CHAT_CURSOR_START);
        const self = first.members.find((member) => member.id === first.self);
        assert.deepEqual(
          [self?.kind, self?.handle, self?.userId],
          [MEMBER_KIND.HUMAN, "ada-lovelace", room.owner],
        );
        assert.deepEqual(
          first.channels.map((channel) => [channel.kind, channel.name]),
          [[CHANNEL_KIND.GENERAL, "general"]],
        );
        assert.deepEqual([first.messages, first.cursor], [[], "1"]);

        // A wait the first read armed was announced too; the held read's wait after its first look is the one waited on.
        yield* Queue.clear(room.asleep);
        const held = yield* Effect.forkChild(room.read(first.cursor));
        yield* Queue.take(room.asleep);
        assert.equal(held.pollUnsafe(), undefined);
        const { grace, message } = yield* room.post("Who owns the invite table?");
        const answered = yield* driven({ fiber: held, asleep: room.asleep }, CODER.MESSAGES_POLL);

        assert.deepEqual(wordsOf(answered.messages), [markdown("Who owns the invite table?")]);
        assert.deepEqual(
          [answered.messages[0]?.authorId, answered.cursor],
          [grace.id, String(message.seq + 1)],
        );
        assert.ok(answered.members.some((member) => member.handle === "grace-hopper"));
      }),
  );

  it.effect("a read past nothing moved is let go at the hold, answering the chat unchanged", () =>
    Effect.gen(function* () {
      const room = yield* openRoom;
      yield* room.post("Morning.");
      const { cursor } = yield* room.read(CHAT_CURSOR_START);
      const held = yield* Effect.forkChild(room.read(cursor));
      const answered = yield* driven({ fiber: held, asleep: room.asleep }, CODER.MESSAGES_HOLD);
      assert.deepEqual([answered.messages, answered.cursor], [[], cursor]);
    }),
  );

  it.effect(
    "a line one agent sent another reads beside the chat as the sender's words alone, both ways of the pair in the order sent, a chat notice steered into an agent reads as none of them, and a DM made before the chat kept none is read by no one",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const agentOn = (userId: string, title: string) =>
          Effect.gen(function* () {
            const { id: taskId } = yield* createTask(userId, {
              organizationId: room.workspace,
              name: title,
              repository: "acme/api",
            });
            const started = yield* createCodingAgent(userId, {
              taskId,
              idempotencyKey: randomUUID(),
              model: "anthropic/claude-opus-5.5",
              effort: "high",
              planSnapshot: `# ${title}\n`,
              prompt: null,
              repository: "acme/api",
              title,
            });
            return Option.getOrThrow(started).agent;
          });
        const invites = yield* agentOn(room.owner, "Invites");
        const billing = yield* agentOn(room.teammate, "Billing");
        const writer = yield* storeWriter({ tools: {} });
        type Agent = typeof invites;
        const send = (from: Agent, to: Agent, text: string, metadata?: AwaitingLineMetadata) =>
          Effect.gen(function* () {
            yield* TestClock.adjust("1 second");
            yield* writer.writeAwaitingLine(
              { userId: to.userId, conversationId: to.conversationId },
              {
                text,
                clientKey: randomUUID(),
                sender: {
                  kind: MESSAGE_SENDER.AGENT,
                  agentId: from.id,
                  name: from.title ?? from.model,
                  model: from.model,
                },
                metadata,
              },
              Effect.succeed(true),
            );
          });
        yield* send(
          invites,
          billing,
          agentLineOf(`"Invites" (agent id ${invites.id}), working in acme/api`, "Schema settled?"),
        );
        yield* send(
          billing,
          invites,
          agentLineOf(`"Billing" (agent id ${billing.id}), working in acme/api`, "Yes, merged."),
        );
        yield* send(invites, billing, "Chat notice · Invites in #general (m 4):\n\nHi", {
          author: MESSAGE_AUTHOR.AGENT,
          channel: MESSAGE_CHANNEL.CHAT,
          chat_seq: 4,
          from: "Invites",
        });

        // A DM made before the chat kept none, and what was said in it, is read by no one.
        const teammateMember = Option.getOrThrow(
          yield* ensureMember(room.teammate, room.workspace, {
            kind: MEMBER_KIND.HUMAN,
            userId: room.teammate,
          }),
        );
        const ownerMember = Option.getOrThrow(
          yield* ensureMember(room.owner, room.workspace, {
            kind: MEMBER_KIND.HUMAN,
            userId: room.owner,
          }),
        );
        const dm = Result.getOrThrow(
          yield* openTopicChannel(room.owner, room.workspace, "just-us", ownerMember.id),
        );
        yield* postMessage(room.owner, room.workspace, {
          authorMemberId: ownerMember.id,
          to: { channelId: dm.id },
          blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: "Just between us." }],
          clientKey: randomUUID(),
        });
        yield* turnIntoDm(dm.id, ownerMember.id, teammateMember.id);

        const read = yield* room.read(CHAT_CURSOR_START, room.teammate);
        assert.ok(read.channels.every((channel) => channel.kind !== CHANNEL_KIND.DM));
        assert.ok(read.messages.every((message) => message.channelId !== dm.id));
        assert.deepEqual(
          (read.agentMessages ?? []).map((message) => [
            message.from.name,
            message.from.agentId,
            message.to.name,
            message.to.planId,
            message.text,
          ]),
          [
            ["Invites", invites.id, "Billing", billing.taskId, "Schema settled?"],
            ["Billing", billing.id, "Invites", invites.taskId, "Yes, merged."],
          ],
        );
      }),
  );

  it.effect(
    "a held read is let go exactly at the store's hold, not a poll before, and the oRPC route adds no deadline of its own",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        yield* room.post("Morning.");
        const { cursor } = yield* room.read(CHAT_CURSOR_START);
        yield* Queue.clear(room.asleep);
        const start = yield* Clock.currentTimeMillis;
        const held = yield* Effect.forkChild(room.read(cursor));
        const hold = Duration.toMillis(CODER.MESSAGES_HOLD);
        // Each poll the read sleeps is moved one poll on, never past a wait it has not made yet.
        while ((yield* Clock.currentTimeMillis) - start < hold) {
          const answeredEarly = yield* Effect.raceFirst(
            Effect.as(Fiber.await(held), true),
            Effect.as(Queue.take(room.asleep), false),
          );
          assert.equal(answeredEarly, false, "answered before the hold");
          yield* TestClock.adjust(CODER.MESSAGES_POLL);
        }
        const answered = yield* Fiber.join(held);
        assert.equal((yield* Clock.currentTimeMillis) - start, hold);
        assert.deepEqual([answered.messages, answered.cursor], [[], cursor]);
      }),
  );

  it.effect(
    "a read past a cursor something already moved past answers at once, and an ask written again is read again at its new place",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const { grace, general } = yield* room.post("One.");
        yield* room.post("Two.");
        const read = yield* room.read(CHAT_CURSOR_START);
        assert.deepEqual(wordsOf(read.messages), [markdown("One."), markdown("Two.")]);
        assert.equal(read.cursor, "3");

        const asked = (text: string) =>
          Effect.map(
            postAsk(room.teammate, room.workspace, {
              authorMemberId: grace.id,
              to: { channelId: general.id },
              blocks: [{ type: CHAT_BLOCK.MARKDOWN, text }],
              clientKey: randomUUID(),
              key: "invite-expiry",
              ask: { response: { type: CHAT_ASK.APPROVAL } },
            }),
            Result.getOrThrow,
          );
        const posted = yield* asked("Seven days?");
        const before = yield* room.read(read.cursor);
        yield* asked("Fourteen days?");
        const after = yield* room.read(before.cursor);

        assert.deepEqual(
          after.messages.map((message) => [message.id, message.seq, message.ask?.revision]),
          [[posted.message.id, posted.message.seq, 2]],
        );
        assert.deepEqual(wordsOf(after.messages), [markdown("Fourteen days?")]);
        assert.ok(Number(after.cursor) > Number(before.cursor));
      }),
  );

  it.effect(
    "a workspace the account is not in is not found, a read with no bearer is refused, and a cursor or workspace that is none is invalid",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        yield* room.post("Inside.");
        const notFound = {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          body: { error: HOSTED_API_ERROR.NOT_FOUND },
        };
        const invalid = {
          status: HOSTED_HTTP_STATUS.BAD_REQUEST,
          body: { error: HOSTED_API_ERROR.INVALID_REQUEST },
        };
        assert.deepEqual(
          yield* room.ask(room.stranger, { workspaceId: room.workspace, after: "0" }),
          notFound,
        );
        assert.deepEqual(
          yield* room.ask(room.owner, { workspaceId: randomUUID(), after: "0" }),
          notFound,
        );
        assert.deepEqual(yield* room.ask(undefined, { workspaceId: room.workspace }), {
          status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
          body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
        });
        for (const after of ["-1", "1.5", "01", "abc"]) {
          assert.deepEqual(
            yield* room.ask(room.owner, { workspaceId: room.workspace, after }),
            invalid,
            after,
          );
        }
        assert.deepEqual(yield* room.ask(room.owner, { after: "0" }), invalid);
        assert.deepEqual(yield* room.ask(room.owner, { workspaceId: room.workspace }, "PUT"), {
          status: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
          body: { error: HOSTED_API_ERROR.METHOD_NOT_ALLOWED },
        });
        // The read that is refused made no member of the stranger's.
        assert.ok(
          (yield* room.read("0")).members.every((member) => member.userId !== room.stranger),
        );
      }),
  );

  it.effect(
    "a member who has not turned Chat on reads the workspace's chat as not found, and reads it once they turn it on",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        yield* room.post("Inside.");
        const asQuiet = { workspaceId: room.workspace, after: CHAT_CURSOR_START };

        assert.deepEqual(yield* room.ask(room.quiet, asQuiet), {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          body: { error: HOSTED_API_ERROR.NOT_FOUND },
        });
        yield* chooseChat(room.quiet, true);
        assert.deepEqual(wordsOf((yield* room.read(CHAT_CURSOR_START, room.quiet)).messages), [
          markdown("Inside."),
        ]);
        yield* chooseChat(room.quiet, false);
        assert.equal((yield* room.ask(room.quiet, asQuiet)).status, HOSTED_HTTP_STATUS.NOT_FOUND);
      }),
  );
});

const RELAY = { owner: "Acme", name: "Relay" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;
const INSTALLATION: InstallationFixture = { id: 4711, login: RELAY.owner, repositories: [RELAY] };

/** The deployment holding both secrets: the cron's, and its own at eve's door. */
const BOTH_SECRETS: HostedEnvironmentValues = {
  ...NO_KEYS,
  cronSecret: Redacted.make("cron-secret-1"),
  eveDeploymentSecret: Redacted.make("eve-deployment-secret-1"),
};

it.layer(getTestDB())("a person's chat post told to an agent through eve", (it) => {
  it.effect(
    "with no eve handed in, a teammate's message to an agent reaches eve as the deployment acting for the agent's starter, under the deployment's own secret and never the cron's",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        yield* chooseChat(owner, true);
        const task = yield* startTask(owner, { name: "Invites", repository: RELAY_FULL_NAME });
        const workspace = task.workspaceId;
        assert.equal(yield* connectWorkspaceGitHub(workspace, INSTALLATION), LINK_OUTCOME.LINKED);
        const teammate = yield* openAccount("Grace Hopper");
        yield* joinWorkspace(workspace, teammate);
        const { agent } = Option.getOrThrow(
          yield* createCodingAgent(owner, {
            taskId: task.id,
            idempotencyKey: randomUUID(),
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            planSnapshot: "# Invites\n",
            prompt: null,
            repository: RELAY_FULL_NAME,
          }),
        );
        const sessionId = `wrun_${randomUUID()}`;
        yield* claimRuntimeSession(
          { userId: owner, conversationId: agent.conversationId },
          sessionId,
          yield* DateTime.nowAsDate,
        );
        yield* ensureMember(owner, workspace, { kind: MEMBER_KIND.AGENT, agentId: agent.id });

        // eve answers on the same fake client GitHub does, and every request is written down in `github.sent`.
        const eveAt = `${ORIGIN}/eve/coder/v1/session/`;
        const github = githubReaching([INSTALLATION], undefined, undefined, (sent) =>
          sent.url.startsWith(eveAt)
            ? Response.json({ sessionId, deliveryId: "delivery-1" }, { status: 202 })
            : undefined,
        );
        const answer = yield* writeWorkspaceChat({ eveOrigin: () => ORIGIN }, teammate, workspace, {
          text: `[@Invites](https://tryluke.dev/acme/plan/${task.id}/agent/${agent.id}) the invite table is yours.`,
          clientKey: randomUUID(),
        }).pipe(
          Effect.provide(Layer.merge(github.layer, Layer.succeed(HostedEnvironment, BOTH_SECRETS))),
        );

        assert.ok("receipt" in answer);
        assert.deepEqual([answer.receipt.told.length, answer.receipt.held], [1, []]);
        assert.deepEqual(
          github.sent
            .filter((sent) => sent.url.startsWith(eveAt))
            .map(({ url, headers }) => ({
              url,
              authorization: headers.get("authorization"),
              account: headers.get(BRAIN_HOST_HEADER.ACCOUNT),
            })),
          [
            {
              url: `${eveAt}${sessionId}`,
              authorization: "Bearer eve-deployment-secret-1",
              account: owner,
            },
          ],
        );
      }),
  );
});
