import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { macListeningSince, queueMacCommand } from "@luke/database/models/mac-command-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB } from "@luke/database/testing";
import type { WireBoundaryInput } from "@luke/wire";
import { Clock, Effect, Layer, Option } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { macCommandsApp } from "./mac-commands-app.js";

/**
 * An agent's command run on the developer's Mac, end to end over a real
 * dialect: the call refuses where no Mac of the account read lately, a
 * Mac's held read counts it listening and is answered with the command the
 * call queued, the result it posts is what the call answers, and a call
 * that hears nothing says so. A Mac following over Neon Realtime claims a
 * command by its id once, and is counted listening when it says so. The
 * route answers the bearer's account alone.
 *
 * Synthetic accounts, bearers, and commands throughout.
 */

const ORIGIN = "https://luke.test";
const MAC_COMMANDS = "/api/mac-commands";
const CLAIM = "/api/mac-commands/claim";
const LISTENING = "/api/mac-commands/listening";

/** A new account, as the store holds one. */
const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** A POST as `bearer` to the path, carrying the claim's id where one is given. */
const post = (path: string, bearer: string, claim?: { readonly id: string }) => {
  const init: RequestInit = {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
  };
  if (claim !== undefined) init.body = JSON.stringify(claim);
  return new Request(new URL(path, ORIGIN), init);
};

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** The group answering one request, on the fiber's own clock, so a held read waits on the test's. */
const ask = (request: Request) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      macCommandsApp({
        resolveUserId: (incoming) => {
          const bearer = incoming.headers.get("authorization") ?? "";
          return Effect.succeed(
            bearer.startsWith("Bearer ") ? Option.some(bearer.slice(7)) : Option.none(),
          );
        },
      }).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const response = yield* Effect.promise(() => handler(request));
    // SAFETY: the group answers JSON; the test compares it as the wire value it is.
    const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
    yield* Effect.promise(() => dispose());
    return { status: response.status, body } satisfies Answer;
  });

it.layer(getTestDB())("a command run on the developer's Mac", (it) => {
  it.effect("a request without a bearer is refused", () =>
    Effect.gen(function* () {
      const answered = yield* ask(new Request(new URL(MAC_COMMANDS, ORIGIN)));

      assert.deepEqual(answered, {
        status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
        body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
      });
    }),
  );

  it.effect(
    "a command heard of over Realtime is claimed by its id once, by its own account, and answered with what to run",
    () =>
      Effect.gen(function* () {
        const [owner, other] = [yield* openUser, yield* openUser];
        const queued = { id: randomUUID(), command: "git status", timeoutSeconds: 60 };
        yield* queueMacCommand(owner, queued);

        const byOther = yield* ask(post(CLAIM, other, { id: queued.id }));
        const claimed = yield* ask(post(CLAIM, owner, { id: queued.id }));
        const again = yield* ask(post(CLAIM, owner, { id: queued.id }));
        const unreadable = yield* ask(post(CLAIM, owner, { id: "not-an-id" }));

        const notFound = {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          body: { error: HOSTED_API_ERROR.NOT_FOUND },
        };
        assert.deepEqual(byOther, notFound);
        assert.deepEqual(claimed, { status: HOSTED_HTTP_STATUS.OK, body: { command: queued } });
        assert.deepEqual(again, notFound, "a claimed command is not handed out twice");
        assert.equal(unreadable.status, HOSTED_HTTP_STATUS.BAD_REQUEST);
      }),
  );

  it.effect("a Mac that says it listens is counted listening, and only for its own account", () =>
    Effect.gen(function* () {
      const [owner, other] = [yield* openUser, yield* openUser];
      const since = new Date(yield* Clock.currentTimeMillis);

      const said = yield* ask(post(LISTENING, owner));
      const read = yield* ask(new Request(new URL(LISTENING, ORIGIN)));

      assert.deepEqual(said, { status: HOSTED_HTTP_STATUS.OK, body: { listening: true } });
      assert.equal(read.status, HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED);
      assert.equal(yield* macListeningSince(owner, since), true);
      assert.equal(yield* macListeningSince(other, since), false);
    }),
  );
});
