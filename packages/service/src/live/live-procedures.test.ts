import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { LiveStatement } from "@luke/database/core/live-statement";
import { Database } from "@luke/database/core/query";
import { writeDrawing } from "@luke/database/models/board-store";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { childConversationId } from "@luke/database/models/ids";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, startTask } from "@luke/database/testing";
import { BOARD_ELEMENT_TYPE } from "@luke/features/board-vocabulary";
import {
  accountInboxLiveAnswerSchema,
  agentTranscriptLiveAnswerSchema,
  LIVE_POLL,
  LIVE_POLL_URL,
  LIVE_USER_QUERY,
  liveDigestOf,
  taskBoardLiveAnswerSchema,
  taskBoardLiveRowsSchema,
} from "@luke/features/live-wire";
import type { WireBoundaryInput } from "@luke/wire";
import { Clock, Duration, Effect, Fiber, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedAnswer } from "../testing/hosted-route.js";
import { liveProcedures } from "./live-procedures.js";
import { type LiveSealer, LiveSealing, pollSealer, SealRefused } from "./realtime.js";

/**
 * The reads the desktop follows over Neon Realtime, sealed by the
 * procedure the way the hosted oRPC route answers it:
 * refused without a bearer, and otherwise every part of the account inbox
 * sealed for the bearer's own account, with the address to subscribe at;
 * a task's whiteboard sealed for an account that reaches the task and not
 * found for one that does not; and either answered with its rows inline at
 * the poll address where the reader asks to poll or Realtime is off or
 * cannot seal it.
 *
 * Synthetic accounts and bearers throughout; the secret is a script that
 * seals a statement as the values it was bound to, so a test can read whose
 * rows each sealed statement reads.
 */

const ORIGIN = "https://luke.test";
const LIVE_INBOX = "/api/live/inbox";
const REALTIME_URL = "wss://realtime.example/v1";

/** A sealer that seals a statement as its values, so whose read it is shows. */
const SCRIPTED: LiveSealer = {
  url: REALTIME_URL,
  seal: (statement: LiveStatement) =>
    Effect.succeed({
      capability: JSON.stringify(statement.params),
      queryFingerprint: statement.sql,
      expiresAt: 1_800_000_060_000,
    }),
};

/** A live read's address, naming the account it is for where one is named (`LIVE_USER_QUERY`). */
function readOf(path: string, forUser: string | undefined): URL {
  const url = new URL(path, ORIGIN);
  if (forUser !== undefined) url.searchParams.set(LIVE_USER_QUERY, forUser);
  return url;
}

/** The procedures answering one request as `bearer`, over the deployment's Realtime where it has one. */
const ask = (options: {
  readonly bearer?: string;
  readonly method?: string;
  readonly sealing: Option.Option<LiveSealer>;
}) =>
  Effect.gen(function* () {
    const procedures = liveProcedures({
      resolveUserId: (incoming) => {
        const bearer = incoming.headers.get("authorization") ?? "";
        return Effect.succeed(
          bearer.startsWith("Bearer ") ? Option.some(bearer.slice(7)) : Option.none(),
        );
      },
    });
    const response = yield* hostedAnswer(
      { live: procedures },
      Layer.succeed(LiveSealing, options.sealing),
      new Request(readOf(LIVE_INBOX, options.bearer), {
        method: options.method ?? "GET",
        headers: options.bearer === undefined ? {} : { authorization: `Bearer ${options.bearer}` },
      }),
    );
    const text = yield* Effect.promise(() => response.text());
    // SAFETY: the route answers JSON; the test compares it as the wire value it is.
    const body = JSON.parse(text) as WireBoundaryInput;
    return { status: response.status, body };
  });

it.effect("a request without a bearer is refused, and one by another method is not taken", () =>
  Effect.gen(function* () {
    assert.deepEqual(yield* ask({ sealing: Option.some(SCRIPTED) }), {
      status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
      body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
    });
    assert.deepEqual(
      yield* ask({ bearer: "user-dana", method: "POST", sealing: Option.some(SCRIPTED) }),
      {
        status: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
        body: { error: HOSTED_API_ERROR.METHOD_NOT_ALLOWED },
      },
    );
  }),
);

it.effect(
  "every part of the account inbox is sealed for the bearer's own account, with the address to subscribe at",
  () =>
    Effect.gen(function* () {
      const dana = yield* ask({ bearer: "user-dana", sealing: Option.some(SCRIPTED) });
      const eli = yield* ask({ bearer: "user-eli", sealing: Option.some(SCRIPTED) });

      assert.equal(dana.status, HOSTED_HTTP_STATUS.OK);
      const answer = Schema.decodeUnknownSync(accountInboxLiveAnswerSchema)(dana.body);
      assert.equal(answer.url, REALTIME_URL);
      const parts = Object.entries(answer.queries);
      assert.deepEqual(parts.map(([part]) => part).toSorted(), [
        "automations",
        "chatAsks",
        "chatNotices",
        "failedRuns",
        "items",
        "planless",
        "plans",
      ]);
      for (const [part, sealed] of parts) {
        assert.ok(sealed.capability.includes('"user-dana"'), `${part} is read for the bearer`);
        assert.ok(!sealed.capability.includes("user-eli"), `${part} is read for no one else`);
      }
      const theirs = Schema.decodeUnknownSync(accountInboxLiveAnswerSchema)(eli.body);
      assert.ok(
        Object.values(theirs.queries).every((sealed) => sealed.capability.includes('"user-eli"')),
      );
    }),
);

/** One box Luke drew, so the board has a row to read. */
const BOX = [{ type: BOARD_ELEMENT_TYPE.RECTANGLE, id: "api", x: 0, y: 0, label: "API" }] as const;

/** A new account, as the store holds one. */
const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** The procedures answering a task board's live read as `bearer`, over the store and the deployment's Realtime. */
const askBoard = (options: {
  readonly bearer: string;
  /** The account the read names; the bearer's own where left out. */
  readonly forUser?: string;
  readonly taskId?: string;
  readonly poll?: boolean;
  /** The digest the reader last saw, which holds the poll until the rows move past it. */
  readonly after?: string;
  readonly sealing: Option.Option<LiveSealer>;
}) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(LiveSealing, options.sealing),
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      // The test's own clock, so a held poll is moved by `TestClock` rather than waited out.
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
    );
    const procedures = liveProcedures({
      resolveUserId: () => Effect.succeed(Option.some(options.bearer)),
    });
    const url = readOf(
      options.taskId === undefined ? LIVE_INBOX : "/api/live/task-board",
      options.forUser ?? options.bearer,
    );
    if (options.taskId !== undefined) url.searchParams.set("id", options.taskId);
    if (options.poll === true) url.searchParams.set(LIVE_POLL.QUERY, LIVE_POLL.ON);
    if (options.after !== undefined) url.searchParams.set(LIVE_POLL.AFTER, options.after);
    const response = yield* hostedAnswer(
      { live: procedures },
      services,
      new Request(url, { headers: { authorization: `Bearer ${options.bearer}` } }),
    );
    const text = yield* Effect.promise(() => response.text());
    // SAFETY: the route answers JSON; the test compares it as the wire value it is.
    const body = JSON.parse(text) as WireBoundaryInput;
    return { status: response.status, body };
  });

it.layer(getTestDB())("the task board's live read", (it) => {
  it.effect(
    "a task's board is sealed for an account that reaches it, not found for one that does not, and unavailable without Realtime",
    () =>
      Effect.gen(function* () {
        const dana = yield* openUser;
        const eli = yield* openUser;
        const started = yield* startTask(dana, { name: "Teammate invitations" });

        const own = yield* askBoard({
          bearer: dana,
          taskId: started.id,
          sealing: Option.some(SCRIPTED),
        });
        assert.equal(own.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(taskBoardLiveAnswerSchema)(own.body);
        assert.equal(answer.url, REALTIME_URL);
        assert.ok(answer.queries.board.capability.includes(`"${dana}"`), "read for the bearer");
        assert.ok(answer.queries.board.capability.includes(`"${started.id}"`), "read for the task");

        const notFound = {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          body: { error: HOSTED_API_ERROR.NOT_FOUND },
        };
        assert.deepEqual(
          yield* askBoard({ bearer: eli, taskId: started.id, sealing: Option.some(SCRIPTED) }),
          notFound,
        );
        assert.deepEqual(
          yield* askBoard({ bearer: dana, taskId: "not-a-task", sealing: Option.some(SCRIPTED) }),
          notFound,
        );
      }),
  );

  it.effect(
    "a board asked to poll, or one Realtime is off for or cannot seal, is answered with its rows inline at the poll address, as the statement reads them",
    () =>
      Effect.gen(function* () {
        const dana = yield* openUser;
        const started = yield* startTask(dana, { name: "Teammate invitations" });
        yield* writeDrawing(dana, started.id, BOX);
        const refusing: LiveSealer = {
          url: REALTIME_URL,
          seal: () => Effect.fail(new SealRefused({ reason: "refused" })),
        };
        for (const [why, sealing, poll] of [
          ["asked to poll", Option.some(SCRIPTED), true],
          ["Realtime off", Option.none(), false],
          ["Realtime refusing", Option.some(refusing), false],
        ] as const) {
          const polled = yield* askBoard({ bearer: dana, taskId: started.id, poll, sealing });
          assert.equal(polled.status, HOSTED_HTTP_STATUS.OK, why);
          const answer = Schema.decodeUnknownSync(taskBoardLiveAnswerSchema)(polled.body);
          assert.equal(answer.url, LIVE_POLL_URL, why);
          assert.deepEqual(
            Schema.decodeUnknownSync(taskBoardLiveRowsSchema)({ board: answer.queries.board.rows }),
            {
              board: [{ taskId: started.id, drawingNumber: 1, appliedDrawing: 0, imaged: false }],
            },
            why,
          );
        }
        const sealed = yield* askBoard({
          bearer: dana,
          taskId: started.id,
          sealing: Option.some(SCRIPTED),
        });
        const answer = Schema.decodeUnknownSync(taskBoardLiveAnswerSchema)(sealed.body);
        assert.equal(answer.url, REALTIME_URL, "sealed where Realtime seals and nobody polls");
        assert.equal(answer.queries.board.rows, undefined);
      }),
  );

  it.effect("the account inbox Realtime is off for is answered with every part's rows inline", () =>
    Effect.gen(function* () {
      const dana = yield* openUser;
      const polled = yield* askBoard({ bearer: dana, sealing: Option.none() });
      assert.equal(polled.status, HOSTED_HTTP_STATUS.OK);
      const answer = Schema.decodeUnknownSync(accountInboxLiveAnswerSchema)(polled.body);
      assert.equal(answer.url, LIVE_POLL_URL);
      for (const [part, sealed] of Object.entries(answer.queries)) {
        assert.deepEqual(sealed.rows, [], `${part} holds nothing yet`);
      }
    }),
  );
});

/** The procedures answering an agent's transcript's live read as `bearer`, the worker's where `call` names one. */
const askTranscript = (options: {
  readonly bearer: string;
  readonly agentId: string;
  readonly call?: string;
  readonly sealing: Option.Option<LiveSealer>;
}) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(LiveSealing, options.sealing),
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
    );
    const procedures = liveProcedures({
      resolveUserId: () => Effect.succeed(Option.some(options.bearer)),
    });
    const url = readOf("/api/live/agent-transcript", options.bearer);
    url.searchParams.set("id", options.agentId);
    if (options.call !== undefined) url.searchParams.set("call", options.call);
    const response = yield* hostedAnswer(
      { live: procedures },
      services,
      new Request(url, { headers: { authorization: `Bearer ${options.bearer}` } }),
    );
    const text = yield* Effect.promise(() => response.text());
    // SAFETY: the route answers JSON; the test compares it as the wire value it is.
    const body = JSON.parse(text) as WireBoundaryInput;
    return { status: response.status, body };
  });

it.layer(getTestDB())("an agent transcript's live read", (it) => {
  it.effect(
    "an agent's transcript, or a worker's by its call, is sealed as what its pages are read from, for an account that reaches the agent and under the conversation the call opens, and not found otherwise",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const stranger = yield* openUser;
        const task = yield* startTask(owner, { name: "Teammate invitations" });
        const started = yield* createCodingAgent(owner, {
          taskId: task.id,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: "acme/relay",
          planSnapshot: "# Teammate invitations\n",
          prompt: null,
        });
        assert.ok(Option.isSome(started));
        const { agent } = started.value;

        const own = yield* askTranscript({
          bearer: owner,
          agentId: agent.id,
          sealing: Option.some(SCRIPTED),
        });
        assert.equal(own.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(agentTranscriptLiveAnswerSchema)(own.body);
        assert.equal(answer.url, REALTIME_URL);
        assert.deepEqual(Object.keys(answer.queries).toSorted(), [
          "agent",
          "conversation",
          "messages",
          "turns",
          "workers",
        ]);
        for (const query of Object.values(answer.queries)) {
          assert.ok(query.capability.includes(`"${owner}"`), "read for the agent's owner");
        }
        assert.ok(answer.queries.messages.capability.includes(`"${agent.conversationId}"`));

        const worker = Schema.decodeUnknownSync(agentTranscriptLiveAnswerSchema)(
          (yield* askTranscript({
            bearer: owner,
            agentId: agent.id,
            call: "call-7",
            sealing: Option.some(SCRIPTED),
          })).body,
        );
        const child = childConversationId(agent.conversationId, "call-7");
        assert.ok(worker.queries.messages.capability.includes(`"${child}"`));
        assert.ok(worker.queries.workers.capability.includes(`"${agent.conversationId}"`));

        for (const call of [undefined, "call-7"]) {
          const named = call === undefined ? {} : { call };
          assert.deepEqual(
            yield* askTranscript({
              bearer: stranger,
              agentId: agent.id,
              ...named,
              sealing: Option.some(SCRIPTED),
            }),
            { status: HOSTED_HTTP_STATUS.NOT_FOUND, body: { error: HOSTED_API_ERROR.NOT_FOUND } },
          );
          const polled = yield* askTranscript({
            bearer: owner,
            agentId: agent.id,
            ...named,
            sealing: Option.none(),
          });
          // Without Realtime the read is answered polled, its rows inline.
          assert.equal(
            Schema.decodeUnknownSync(agentTranscriptLiveAnswerSchema)(polled.body).url,
            LIVE_POLL_URL,
          );
        }
        assert.deepEqual(
          yield* askTranscript({
            bearer: owner,
            agentId: "not-an-agent",
            sealing: Option.some(SCRIPTED),
          }),
          { status: HOSTED_HTTP_STATUS.NOT_FOUND, body: { error: HOSTED_API_ERROR.NOT_FOUND } },
        );
      }),
  );

  it.effect(
    "a poll past the digest the reader saw is held: answered within a beat of a change, and unchanged, with no rows, at the hold's end",
    () =>
      Effect.gen(function* () {
        const dana = yield* openUser;
        const started = yield* startTask(dana, { name: "Teammate invitations" });
        const poll = (after: string) =>
          askBoard({ bearer: dana, taskId: started.id, poll: true, after, sealing: Option.none() });
        const first = yield* askBoard({ bearer: dana, taskId: started.id, sealing: Option.none() });
        const seen = Schema.decodeUnknownSync(taskBoardLiveAnswerSchema)(first.body);
        const digest = liveDigestOf(seen.queries);
        assert.ok(digest !== undefined);

        const unchanged = yield* Effect.forkChild(poll(digest));
        yield* TestClock.adjust(Duration.seconds(25));
        const held = Schema.decodeUnknownSync(taskBoardLiveAnswerSchema)(
          (yield* Fiber.join(unchanged)).body,
        );
        assert.equal(held.queries.board.rows, undefined, "unchanged carries no rows");
        assert.equal(liveDigestOf(held.queries), digest);

        const moved = yield* Effect.forkChild(poll(digest));
        yield* TestClock.adjust(Duration.seconds(3));
        yield* writeDrawing(dana, started.id, BOX);
        yield* TestClock.adjust(Duration.seconds(1));
        const answer = Schema.decodeUnknownSync(taskBoardLiveAnswerSchema)(
          (yield* Fiber.join(moved)).body,
        );
        assert.deepEqual(
          Schema.decodeUnknownSync(taskBoardLiveRowsSchema)({ board: answer.queries.board.rows }),
          { board: [{ taskId: started.id, drawingNumber: 1, appliedDrawing: 0, imaged: false }] },
        );
        assert.notEqual(liveDigestOf(answer.queries), digest);
      }),
  );

  it.effect("a polled statement's rows in another order digest alike", () =>
    Effect.gen(function* () {
      const sealer = pollSealer(yield* SqlClient.SqlClient);
      const one = yield* sealer.seal({
        sql: "select * from (values (1), (2)) as rows(n) order by n",
        params: [],
      });
      const other = yield* sealer.seal({
        sql: "select * from (values (1), (2)) as rows(n) order by n desc",
        params: [],
      });
      assert.notDeepEqual(one.rows, other.rows);
      assert.equal(one.digest, other.digest);
    }),
  );

  it.effect(
    "a read naming another account than the caller's, or none, is answered as signed out, as no session is",
    () =>
      Effect.gen(function* () {
        const dana = yield* openUser;
        const started = yield* startTask(dana, { name: "Teammate invitations" });
        const signedOut = {
          status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
          body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
        };
        for (const forUser of ["user-eli", ""]) {
          for (const poll of [false, true]) {
            assert.deepEqual(
              yield* askBoard({
                bearer: dana,
                forUser,
                taskId: started.id,
                poll,
                sealing: Option.none(),
              }),
              signedOut,
            );
          }
          assert.deepEqual(
            yield* askBoard({ bearer: dana, forUser, sealing: Option.none() }),
            signedOut,
          );
        }
      }),
  );
});
