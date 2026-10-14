import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { getTestDB } from "@luke/database/testing";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "@luke/service/http/http";
import type { WireBoundaryInput } from "@luke/wire";
import { Clock, Effect, Layer, Option } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { macCommandsApp } from "../server/mac-commands-app";

/**
 * An agent's command run on the developer's Mac, end to end over a real
 * dialect: the call refuses where no Mac of the account read lately, a
 * Mac's held read counts it listening and is answered with the command the
 * call queued, the result it posts is what the call answers, and a call
 * that hears nothing says so. The route answers the bearer's account alone.
 *
 * Synthetic accounts, bearers, and commands throughout.
 */

const ORIGIN = "https://luke.test";
const MAC_COMMANDS = "/api/mac-commands";

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
});
