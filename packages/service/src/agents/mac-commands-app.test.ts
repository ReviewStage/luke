import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { queueMacCommand } from "@luke/database/models/mac-command-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB } from "@luke/database/testing";
import type { WireBoundaryInput } from "@luke/wire";
import { Clock, Deferred, Effect, Fiber, Layer, Option } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { LiveWake, type LiveWakeShape } from "../live/live-wake.js";
import { macCommandsFor } from "./mac-command.js";
import { macCommandsApp } from "./mac-commands-app.js";

/**
 * An agent's command run on the developer's Mac, end to end over a real
 * dialect: the call refuses where no Mac of the account read lately, a
 * Mac's held read counts it listening and is answered with the command the
 * call queued, the result it posts is what the call answers, and a call
 * that hears nothing says so. A held read is woken by Neon Realtime's word
 * that the account's unclaimed commands changed, rather than its poll. The
 * route answers the bearer's account alone.
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

  it.effect(
    "the Mac's held read answers a command queued while it is held as soon as Realtime says the account's unclaimed commands changed, without waiting out its poll",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const owner = `user-${randomUUID()}`;
        yield* db
          .insert(user)
          .values({ id: owner, name: "Test User", email: `${owner}@luke.test` });
        const parked = yield* Deferred.make<() => void>();
        const watched: (readonly unknown[])[] = [];
        // Realtime as a script: the watch parks each wait until the test says the rows changed.
        const wake: LiveWakeShape = {
          watch: (statements) =>
            Effect.sync(() => {
              watched.push(...statements.map((statement) => statement.params));
              return {
                changed: Effect.callback<void>((resume) => {
                  Deferred.doneUnsafe(
                    parked,
                    Effect.succeed(() => resume(Effect.void)),
                  );
                }),
              };
            }),
        };
        const read = yield* Effect.forkChild(
          macCommandsFor(owner).pipe(Effect.provideService(LiveWake, wake)),
        );
        const changed = yield* Deferred.await(parked);
        const queued = { id: randomUUID(), command: "git status", timeoutSeconds: 60 };
        yield* queueMacCommand(owner, queued);
        changed();

        assert.deepEqual(yield* Fiber.join(read), [queued]);
        assert.deepEqual(watched, [[owner]], "the account's own unclaimed commands are watched");
      }),
  );
});
