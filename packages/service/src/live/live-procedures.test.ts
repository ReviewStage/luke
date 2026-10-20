import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { LiveStatement } from "@luke/database/core/live-statement";
import { Database } from "@luke/database/core/query";
import { writeDrawing } from "@luke/database/models/board-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, startTask } from "@luke/database/testing";
import { BOARD_ELEMENT_TYPE } from "@luke/features/board-vocabulary";
import {
  accountInboxLiveAnswerSchema,
  LIVE_POLL,
  LIVE_POLL_URL,
  taskBoardLiveAnswerSchema,
  taskBoardLiveRowsSchema,
} from "@luke/features/live-wire";
import type { WireBoundaryInput } from "@luke/wire";
import { Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedAnswer } from "../testing/hosted-route.js";
import { liveProcedures } from "./live-procedures.js";
import { type LiveSealer, LiveSealing, SealRefused } from "./realtime.js";

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
      new Request(new URL(LIVE_INBOX, ORIGIN), {
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
  readonly taskId?: string;
  readonly poll?: boolean;
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
    const url = new URL(options.taskId === undefined ? LIVE_INBOX : "/api/live/task-board", ORIGIN);
    if (options.taskId !== undefined) url.searchParams.set("id", options.taskId);
    if (options.poll === true) url.searchParams.set(LIVE_POLL.QUERY, LIVE_POLL.ON);
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
