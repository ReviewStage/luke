import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  ensureGeneral,
  ensureMember,
  postAsk,
  postMessage,
} from "@luke/database/models/chat-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, joinWorkspace, openWorkspace } from "@luke/database/testing";
import { HOSTED_API_ERROR } from "@luke/features";
import {
  CHANNEL_KIND,
  CHAT_ASK,
  CHAT_BLOCK,
  CHAT_CURSOR_START,
  chatAnswerSchema,
  MEMBER_KIND,
} from "@luke/features/chat-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Clock, Effect, Layer, Option, Queue, Result } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { announcingClock, driven } from "../testing/clock-driven.js";
import { githubReaching } from "../testing/github-app-fake.js";
import { chatApp } from "./chat-app.js";
import { CODER } from "./coder-host/bounds.js";

/**
 * The window's read of a workspace's chat, answered by the group the way a
 * function answers it, over a real dialect: held while nothing moved past
 * the reader's cursor and answered once a post lands, answered at once
 * where something already has, a changed ask read again, and a workspace
 * the account is not in answered as nothing. The clock is the test's, each
 * wait the route makes announced so the test moves it one step at a time.
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
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
};

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** An account of its own, with a name its handle is a slug of. */
const openAccount = (name: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id, name, email: `${id}@luke.test` });
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
  const workspace = yield* openWorkspace(owner);
  yield* joinWorkspace(workspace, teammate);
  const { clock, asleep } = yield* announcingClock;
  const client = yield* SqlClient.SqlClient;
  const services = Layer.mergeAll(
    Layer.succeed(SqlClient.SqlClient, client),
    Layer.succeed(Database, yield* Database),
    Layer.succeed(Clock.Clock, clock),
    githubReaching([]).layer,
    Layer.succeed(HostedEnvironment, NO_KEYS),
  );
  const handler = HttpRouter.toWebHandler(
    chatApp({
      eveOrigin: () => undefined,
      resolveUserId: (incoming: Request) =>
        Effect.succeed(
          Option.fromNullishOr(
            new Map([owner, teammate, stranger].map((id) => [`Bearer ${id}`, id])).get(
              incoming.headers.get("authorization") ?? "",
            ),
          ),
        ),
    }).pipe(HttpRouter.provideRequest(services)),
    { disableLogger: true },
  );
  yield* Effect.addFinalizer(() => Effect.promise(() => handler.dispose()));
  const ask = (bearer: string | undefined, query: Record<string, string>, method = "GET") =>
    Effect.gen(function* () {
      const url = new URL(CHAT, ORIGIN);
      for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
      const response = yield* Effect.promise(() =>
        handler.handler(
          new Request(url, {
            method,
            headers: bearer === undefined ? {} : { authorization: `Bearer ${bearer}` },
          }),
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
        mentions: [],
        clientKey: randomUUID(),
      });
      return { grace, general, message: Result.getOrThrow(posted).message };
    });
  return { owner, teammate, stranger, workspace, asleep, ask, read, post };
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
              mentions: [],
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
});
