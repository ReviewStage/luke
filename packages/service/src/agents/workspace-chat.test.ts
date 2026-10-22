import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { writeAccountPreferences } from "@luke/database/models/account-store";
import {
  answerAsk,
  ensureGeneral,
  ensureMember,
  findOrMakeDm,
  LIVE_CHANNEL_MESSAGES,
  openTopicChannel,
  postAsk,
  postMessage,
  readTo,
  type WorkspaceChatLiveStatements,
  workspaceChatLiveStatements,
} from "@luke/database/models/chat-store";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { claimRuntimeSession } from "@luke/database/models/recorded-session";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, joinWorkspace, openWorkspace, startTask } from "@luke/database/testing";
import { HOSTED_API_ERROR } from "@luke/features";
import {
  ASK_STATUS,
  CHANNEL_KIND,
  CHAT_ASK,
  CHAT_BLOCK,
  CHAT_CURSOR_START,
  type ChatWriteRequest,
  chatAnswerSchema,
  chatJoinAnswerSchema,
  MEMBER_KIND,
} from "@luke/features/chat-wire";
import { CODING_AGENT_KIND } from "@luke/features/coding-agent-wire";
import { INBOX_REPLY } from "@luke/features/inbox-wire";
import { workspaceChatLiveRowsSchema, workspaceChatOfLiveRows } from "@luke/features/live-wire";
import { EXPERIMENT } from "@luke/settings";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
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
  Schema,
} from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { recordingProductAnalytics, SERVER_EVENT } from "../events/server-events.js";
import { LINK_OUTCOME } from "../github/github-installations.js";
import { keptAfterResponse } from "../http/after-response.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { HOSTED_REFUSAL } from "../http/http-effect.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { connectAgentApiKeys } from "../testing/agent-credentials.js";
import { announcingClock, driven } from "../testing/clock-driven.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
  openGithubUser,
} from "../testing/github-app-fake.js";
import { queryRecorder } from "../testing/query-recording.js";
import { BRAIN_HOST_HEADER } from "./brain-host/bounds.js";
import { CODER } from "./coder-host/bounds.js";
import { messagesProcedures } from "./messages-procedures.js";
import { joinWorkspaceChatAsPerson, writeWorkspaceChat } from "./workspace-chat.js";

/**
 * The window's read of a workspace's chat, answered by the hosted oRPC
 * router the way the web route answers it, over a real dialect: held while nothing moved past
 * the reader's cursor and answered once a post lands, answered at once
 * where something already has, a changed ask read again, a read past the
 * start writing nothing until the person joins, the live statements
 * delivering what the held read answers from the start, and a workspace
 * the account is not in answered as nothing. The clock is the test's, each
 * wait the route makes announced so the test moves it one step at a time.
 * And a teammate's post to an agent, with no eve handed in, tells the agent
 * through eve as the deployment acting for its starter, under the
 * deployment's own secret and never the cron's the same environment holds.
 * And a member's operator, which a teammate's directory leaves out and their
 * window DMs not at all.
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
    yield* connectAgentApiKeys(id);
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
  const ask = (
    bearer: string | undefined,
    query: Record<string, string>,
    method = "GET",
    sent?: string,
  ) =>
    Effect.gen(function* () {
      const url = new URL(CHAT, ORIGIN);
      for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
      const headers = new Headers();
      if (bearer !== undefined) headers.set("authorization", `Bearer ${bearer}`);
      if (sent !== undefined) headers.set("content-type", "application/json");
      const response = yield* Effect.promise(() =>
        handle(
          new Request(url, {
            method,
            headers,
            ...(sent === undefined ? undefined : { body: sent }),
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
  /** The account joining the workspace's chat. */
  const join = (bearer: string) =>
    ask(bearer, { workspaceId: workspace }, "POST", JSON.stringify({ join: true }));
  return { owner, teammate, stranger, quiet, workspace, asleep, ask, read, post, join };
});

/** An answer read as the chat's, failing the test where it is not one. */
function chatOf(answered: Answer) {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK, JSON.stringify(answered.body));
  const read = readEither(chatAnswerSchema)(unparsedWire(answered.body));
  if (Result.isFailure(read)) return assert.fail(`not the wire's: ${read.failure.refusal}`);
  return read.success;
}

/** Every part of a workspace's chat live statements run as Realtime runs them, their SQL and values as they are, read back under the schema the desktop decodes them with. */
const liveRowsOf = (statements: Option.Option<WorkspaceChatLiveStatements>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const parts = Option.getOrThrow(statements);
    const rows = yield* Effect.all({
      self: sql.unsafe(parts.self.sql, [...parts.self.params]),
      members: sql.unsafe(parts.members.sql, [...parts.members.params]),
      channels: sql.unsafe(parts.channels.sql, [...parts.channels.params]),
      messages: sql.unsafe(parts.messages.sql, [...parts.messages.params]),
      reads: sql.unsafe(parts.reads.sql, [...parts.reads.params]),
    });
    return yield* Schema.decodeUnknownEffect(workspaceChatLiveRowsSchema)(rows);
  });

/** The newest `LIVE_CHANNEL_MESSAGES` of each channel by place, in the order given. */
function newestOfEachChannel<
  Message extends {
    readonly id: string;
    readonly seq: number;
    readonly channelId: string;
    readonly ask?: { readonly status: string };
  },
>(messages: readonly Message[]): readonly Message[] {
  const channels = new Set(messages.map((message) => message.channelId));
  const kept = new Set(
    [...channels].flatMap((channelId) =>
      messages
        .filter((message) => message.channelId === channelId)
        .toSorted((one, other) => other.seq - one.seq)
        .slice(0, LIVE_CHANNEL_MESSAGES)
        .map((message) => message.id),
    ),
  );
  return messages.filter(
    (message) => kept.has(message.id) || message.ask?.status === ASK_STATUS.OPEN,
  );
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
          [self?.kind, self?.name, self?.userId],
          [MEMBER_KIND.HUMAN, "Ada Lovelace", room.owner],
        );
        // A desktop up to v0.18.0 refuses a member with no handle, so each is handed its name under that key.
        assert.ok(first.members.every((member) => member.handle === member.name));
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
        assert.ok(answered.members.some((member) => member.name === "Grace Hopper"));
      }),
  );

  it.effect(
    "a read past the start writes nothing: it is not found until the person joins, which makes their member once",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        yield* room.post("Inside.");
        assert.deepEqual(yield* room.ask(room.owner, { workspaceId: room.workspace, after: "1" }), {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          body: { error: HOSTED_API_ERROR.NOT_FOUND },
        });
        const roster = (yield* room.read(CHAT_CURSOR_START, room.teammate)).members;
        assert.ok(roster.every((member) => member.userId !== room.owner));

        const joined = yield* room.join(room.owner);
        assert.equal(joined.status, HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(yield* room.join(room.owner), joined);
        const self = Result.getOrThrow(readEither(chatJoinAnswerSchema)(unparsedWire(joined.body)));
        const read = yield* room.read("1");
        assert.deepEqual([read.self, wordsOf(read.messages)], [self.self, [markdown("Inside.")]]);
        assert.deepEqual(yield* room.join(room.stranger), {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          body: { error: HOSTED_API_ERROR.NOT_FOUND },
        });
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

  it.effect(
    "a read receipt takes no lock on the workspace: only a join that makes the person's member does",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const { general, message } = yield* room.post("Morning.");
        const recorder = yield* queryRecorder;
        const locks = () =>
          recorder.queries.filter((query) => /"organization".*for update/isu.test(query));
        const join = recorder.record(joinWorkspaceChatAsPerson(room.owner, room.workspace));
        const read = (write: ChatWriteRequest) =>
          recorder
            .record(
              writeWorkspaceChat({ eveOrigin: () => undefined }, room.owner, room.workspace, write),
            )
            .pipe(
              Effect.provide(
                Layer.merge(githubReaching([]).layer, Layer.succeed(HostedEnvironment, NO_KEYS)),
              ),
            );

        yield* join;
        assert.equal(locks().length, 1, "a join that makes the member locks the workspace");
        recorder.queries.length = 0;
        assert.ok("readSeq" in (yield* read({ readTo: message.seq, channelId: general.id })));
        assert.ok("readSeq" in (yield* read({ readTo: message.seq })));
        yield* join;
        assert.ok(recorder.queries.length > 0, "the statements were seen");
        assert.deepEqual(locks(), []);
      }),
  );

  it.effect(
    "the live statements deliver the chat the held read answers from the start, each channel's newest messages alone, to a member, and nothing to an outsider or a member with Chat off",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const { grace, general, message } = yield* room.post("Who owns the invite table?");
        const first = yield* room.read(CHAT_CURSOR_START);
        const ada = Option.getOrThrow(
          yield* ensureMember(room.owner, room.workspace, {
            kind: MEMBER_KIND.HUMAN,
            userId: room.owner,
          }),
        );
        assert.equal(ada.id, first.self);
        // A reply in a thread, a DM, a topic with a purpose, an ask answered, and a channel read past the reader's floor.
        Result.getOrThrow(
          yield* openTopicChannel(room.owner, room.workspace, "launch", ada.id, "Ship notes."),
        );
        Result.getOrThrow(
          yield* postMessage(room.teammate, room.workspace, {
            authorMemberId: grace.id,
            to: { replyTo: message.seq },
            blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: "I do." }],
            clientKey: randomUUID(),
          }),
        );
        const dm = Option.getOrThrow(
          yield* findOrMakeDm(room.owner, room.workspace, ada.id, grace.id),
        );
        const lunchKey = randomUUID();
        const lunch = Result.getOrThrow(
          yield* postMessage(room.owner, room.workspace, {
            authorMemberId: ada.id,
            to: { channelId: dm.id },
            blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: "Lunch?" }],
            clientKey: lunchKey,
          }),
        );
        const asked = Result.getOrThrow(
          yield* postAsk(room.teammate, room.workspace, {
            authorMemberId: grace.id,
            to: { channelId: general.id },
            blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: "Seven days?" }],
            clientKey: randomUUID(),
            key: "invite-expiry",
            ask: { title: "Invite expiry", response: { type: CHAT_ASK.APPROVAL } },
          }),
        );
        assert.ok(
          Result.isSuccess(
            yield* answerAsk(room.owner, room.workspace, {
              answererMemberId: ada.id,
              seq: asked.message.seq,
              revision: 1,
              reply: { reply: INBOX_REPLY.APPROVED },
              clientKey: randomUUID(),
            }),
          ),
        );
        assert.ok(yield* readTo(room.owner, room.workspace, ada.id, dm.id, asked.message.seq));
        // An ask left open before them, which the live read keeps however far back it falls.
        const open = Result.getOrThrow(
          yield* postAsk(room.teammate, room.workspace, {
            authorMemberId: grace.id,
            to: { channelId: general.id },
            blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: "Ship Friday?" }],
            clientKey: randomUUID(),
            key: "ship-day",
            ask: { title: "Ship day", response: { type: CHAT_ASK.APPROVAL } },
          }),
        );
        // More in #general than a live read holds of one channel, so its oldest fall out of it.
        for (const count of Array.from({ length: LIVE_CHANNEL_MESSAGES }, (_, index) => index)) {
          Result.getOrThrow(
            yield* postMessage(room.teammate, room.workspace, {
              authorMemberId: grace.id,
              to: { channelId: general.id },
              blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: `Note ${count}.` }],
              clientKey: randomUUID(),
            }),
          );
        }

        // The held read from the start, page by page, as the window's loop reads it.
        let held = yield* room.read(CHAT_CURSOR_START);
        let messages = held.messages;
        // Note that 200 is the held read's page, so a full page means more wait past it.
        while (held.messages.length === 200) {
          held = yield* room.read(held.cursor);
          messages = [...messages, ...held.messages];
        }
        const statements = workspaceChatLiveStatements(room.owner, ada);
        const live = workspaceChatOfLiveRows(yield* liveRowsOf(statements));
        // Note that the live rows reach only windows past v0.18.0, so they carry no stand-in handle.
        const members = held.members.map(({ handle: _standIn, ...member }) => member);
        assert.deepEqual(live, {
          ...held,
          members,
          messages: newestOfEachChannel(messages),
          cursor: "",
        });
        // Each channel's newest, and the one ask still open behind them.
        assert.equal(
          live?.messages.filter((each) => each.channelId === general.id).length,
          LIVE_CHANNEL_MESSAGES + 1,
        );
        assert.ok(live?.messages.some((each) => each.channelId === dm.id));
        assert.ok(live?.channels.some((each) => each.purpose === "Ship notes."));
        assert.ok(live?.messages.some((each) => each.id === open.message.id));
        assert.ok(held.reads !== undefined && messages.some((each) => each.ask?.answer));
        // The key a post went under is read by its author alone, in the held read and the live one alike.
        for (const read of [messages, live?.messages ?? []]) {
          assert.equal(read.find((each) => each.id === lunch.message.id)?.clientKey, lunchKey);
          assert.deepEqual(
            read.filter((each) => each.authorId !== ada.id && each.clientKey !== undefined),
            [],
          );
        }
        const graces = workspaceChatOfLiveRows(
          yield* liveRowsOf(workspaceChatLiveStatements(room.teammate, grace)),
        );
        const seen = graces?.messages.find((each) => each.id === lunch.message.id);
        assert.ok(seen, "the other side of the DM reads the post");
        assert.equal(seen.clientKey, undefined, "without its author's key");

        for (const outside of [room.stranger, room.quiet]) {
          const rows = yield* liveRowsOf(workspaceChatLiveStatements(outside, ada));
          assert.deepEqual(rows, { self: [], members: [], channels: [], messages: [], reads: [] });
          assert.equal(workspaceChatOfLiveRows(rows), undefined);
        }
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
    "with no eve handed in, a teammate's message to an agent from a window that reads no receipt is answered once committed and then reaches eve once, as the deployment acting for the agent's starter, under the deployment's own secret and never the cron's",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        yield* connectAgentApiKeys(owner);
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
        const poster = Option.getOrThrow(
          yield* ensureMember(teammate, workspace, { kind: MEMBER_KIND.HUMAN, userId: teammate }),
        );
        const agentMember = Option.getOrThrow(
          yield* ensureMember(owner, workspace, { kind: MEMBER_KIND.AGENT, agentId: agent.id }),
        );
        const dm = Option.getOrThrow(
          yield* findOrMakeDm(teammate, workspace, poster.id, agentMember.id),
        );

        // eve answers on the same fake client GitHub does, and every request is written down in `github.sent`.
        const eveAt = `${ORIGIN}/eve/coder/v1/session/`;
        const github = githubReaching([INSTALLATION], undefined, undefined, (sent) =>
          sent.url.startsWith(eveAt)
            ? Response.json({ sessionId, deliveryId: "delivery-1" }, { status: 202 })
            : undefined,
        );
        const after = keptAfterResponse();
        const analytics = recordingProductAnalytics();
        const clientKey = randomUUID();
        const post = writeWorkspaceChat({ eveOrigin: () => ORIGIN }, teammate, workspace, {
          text: "The invite table is yours.",
          channelId: dm.id,
          clientKey,
          receipt: false,
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              github.layer,
              Layer.succeed(HostedEnvironment, BOTH_SECRETS),
              after.layer,
              analytics.layer,
            ),
          ),
        );
        const steers = () => github.sent.filter((sent) => sent.url.startsWith(eveAt));

        // The post answers once it is committed, before eve is told or the event is counted.
        const answer = yield* post;
        assert.ok("posted" in answer && !("receipt" in answer));
        assert.deepEqual([steers().length, analytics.recorded.length], [0, 0]);
        yield* after.run;
        assert.deepEqual(
          analytics.recorded.map((event) => event.name),
          [SERVER_EVENT.CHAT_MESSAGE_SEND],
        );
        // The same post sent again answers the same message, and steers no one twice.
        const again = yield* post;
        assert.ok("posted" in again);
        assert.equal(again.posted.id, answer.posted.id);
        yield* after.run;
        assert.equal(analytics.recorded.length, 1);
        assert.deepEqual(
          steers().map(({ url, headers }) => ({
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

it.layer(getTestDB())("a member's operator in the workspace's chat", (it) => {
  it.effect(
    "a teammate's directory, held and live, leaves out the member's operator and their DM with it, and the teammate's window DMs it not at all, while the member reads both",
    () =>
      Effect.gen(function* () {
        const room = yield* openRoom;
        const { grace } = yield* room.post("Morning.");
        const { agent: operator } = Option.getOrThrow(
          yield* createCodingAgent(room.owner, {
            taskId: null,
            organizationId: room.workspace,
            planSnapshot: null,
            prompt: null,
            kind: CODING_AGENT_KIND.OPERATOR,
            idempotencyKey: randomUUID(),
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            repository: null,
          }),
        );
        const seat = (subject: Parameters<typeof ensureMember>[2]) =>
          Effect.map(ensureMember(room.owner, room.workspace, subject), Option.getOrThrow);
        const ada = yield* seat({ kind: MEMBER_KIND.HUMAN, userId: room.owner });
        const seated = yield* seat({ kind: MEMBER_KIND.AGENT, agentId: operator.id });
        const dm = Option.getOrThrow(
          yield* findOrMakeDm(room.owner, room.workspace, ada.id, seated.id),
        );
        const said = Result.getOrThrow(
          yield* postMessage(room.owner, room.workspace, {
            authorMemberId: ada.id,
            to: { channelId: dm.id },
            blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: "What's on my plate?" }],
            clientKey: randomUUID(),
          }),
        ).message;
        const sees = (chat: {
          readonly members: readonly { readonly agentId?: string | null | undefined }[];
          readonly channels: readonly { readonly id: string }[];
          readonly messages: readonly { readonly id: string }[];
        }) => [
          chat.members.some((member) => member.agentId === operator.id),
          chat.channels.some((channel) => channel.id === dm.id),
          chat.messages.some((message) => message.id === said.id),
        ];

        const teammates = yield* room.read(CHAT_CURSOR_START, room.teammate);
        assert.deepEqual(sees(teammates), [false, false, false]);
        const live = workspaceChatOfLiveRows(
          yield* liveRowsOf(workspaceChatLiveStatements(room.teammate, grace)),
        );
        assert.ok(live !== undefined);
        assert.deepEqual(sees(live), [false, false, false]);
        const refused = yield* writeWorkspaceChat(
          { eveOrigin: () => ORIGIN },
          room.teammate,
          room.workspace,
          {
            text: "What does Ada have on?",
            to: `[@Luke](https://tryluke.dev/w/agent/${operator.id})`,
            clientKey: randomUUID(),
          },
        ).pipe(
          Effect.provide(
            Layer.merge(githubReaching([]).layer, Layer.succeed(HostedEnvironment, BOTH_SECRETS)),
          ),
          Effect.flip,
        );
        assert.equal(refused, HOSTED_REFUSAL.NOT_FOUND);

        assert.deepEqual(sees(yield* room.read(CHAT_CURSOR_START, room.owner)), [true, true, true]);
      }),
  );
});
