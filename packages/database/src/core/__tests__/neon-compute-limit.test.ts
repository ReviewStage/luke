import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import { Cause, Clock, Duration, Effect, Exit, Fiber } from "effect";
import { ConnectionError, SqlError, SqlSyntaxError } from "effect/sql/SqlError";
import { TestClock } from "effect/testing";
import { waitingOutNeonComputeLimit } from "../neon-compute-limit.js";

/** Neon's refusal as `@effect/sql-pg` hands it on: the server's words beneath a failed connect. */
const refused = new SqlError({
  reason: new ConnectionError({
    cause: new Error(
      "You have exceeded the limit of concurrently active endpoints. Please suspend some endpoints and try again.",
    ),
    message: "PgConnection: Failed to connect",
    operation: "connect",
  }),
});

const broken = new SqlError({
  reason: new SqlSyntaxError({
    cause: new Error('syntax error at or near "CREAT"'),
    operation: "execute",
  }),
});

/** A migration that cannot connect until `freesAt` on the clock, and then applies. */
const migrationFreedAt = (freesAt: Duration.Duration) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (now < Duration.toMillis(freesAt)) return yield* Effect.fail(refused);
    return "applied";
  });

describe("waitingOutNeonComputeLimit", () => {
  it.effect("a run Neon refuses a compute connects once another compute suspends", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        waitingOutNeonComputeLimit(migrationFreedAt(Duration.minutes(2))),
      );
      yield* TestClock.adjust(Duration.minutes(3));
      assert.equal(yield* Fiber.join(fiber), "applied");
    }),
  );

  it.effect("a run still refused after six minutes fails with Neon's refusal", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        Effect.exit(waitingOutNeonComputeLimit(migrationFreedAt(Duration.hours(1)))),
      );
      yield* TestClock.adjust(Duration.minutes(7));
      const exit = yield* Fiber.join(fiber);
      assert.deepEqual(exit, Exit.fail(refused));
    }),
  );

  it.effect("a refusal Drizzle carries beneath a statement's failure is waited out too", () =>
    Effect.gen(function* () {
      let refusals = 1;
      const statement = Effect.suspend(() => {
        if (refusals === 0) return Effect.succeed("applied");
        refusals -= 1;
        return Effect.fail(
          new EffectDrizzleQueryError({
            query: "select 1",
            params: [],
            cause: Cause.fail(refused),
          }),
        );
      });
      const fiber = yield* Effect.forkChild(waitingOutNeonComputeLimit(statement));
      yield* TestClock.adjust(Duration.minutes(1));
      assert.equal(yield* Fiber.join(fiber), "applied");
    }),
  );

  it.effect("any other failure fails at once", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(waitingOutNeonComputeLimit(Effect.fail(broken)));
      assert.deepEqual(exit, Exit.fail(broken));
    }),
  );
});
