// retire-sessions.test.ts -- a delete's retires end within their budget, whatever the sessions do, so the delete behind them still runs.
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { StandingSession } from "@repo/database/models/recorded-session";
import { CONVERSATION_KIND } from "@repo/database/storage-vocabulary";
import { getTestDB } from "@repo/database/testing";
import { noNetwork } from "@repo/wire/testing";
import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { EVE_RESET_OUTCOME } from "./eve-host/eve-sessions.js";
import { type Retiring, retireSessions } from "./retire-sessions.js";

/**
 * The sessions are a fake that writes down each session it retired, and
 * answers a session named in `hanging` never, as a reset that never
 * returns would. Synthetic session ids throughout.
 */

function sessionsNamed(count: number, prefix: string): StandingSession[] {
  return Array.from({ length: count }, (_, index) => ({
    sessionId: `${prefix}-${index}`,
    kind: CONVERSATION_KIND.AGENT,
  }));
}

function eveRetiring(hanging: ReadonlySet<string>) {
  const retired: string[] = [];
  const eveAt: Retiring = {
    reset: (sessionId) =>
      hanging.has(sessionId)
        ? Effect.never
        : Effect.sync(() => {
            retired.push(sessionId);
            return { outcome: EVE_RESET_OUTCOME.RESET } as const;
          }),
  };
  return { eveAt, retired };
}

it.layer(getTestDB())("sessions retired", (it) => {
  it.effect(
    "a large account's retires end eight seconds in, however many are left waiting, so the erase behind them runs",
    () =>
      Effect.gen(function* () {
        // Twelve sessions never answered: each alone would give up at five seconds, four at a
        // time, so the three rounds without a budget would run to fifteen.
        const hung = sessionsNamed(12, "hung");
        const { eveAt } = eveRetiring(new Set(hung.map(({ sessionId }) => sessionId)));
        const retiring = yield* Effect.forkChild(retireSessions(eveAt, hung));

        yield* TestClock.adjust(Duration.seconds(7));
        assert.equal(retiring.pollUnsafe(), undefined, "still retiring before the budget");
        yield* TestClock.adjust(Duration.seconds(1));
        assert.notEqual(retiring.pollUnsafe(), undefined, "done at the budget");
      }).pipe(Effect.provide(noNetwork)),
  );

  it.effect("the sessions answered within the budget are retired, beside one never answered", () =>
    Effect.gen(function* () {
      const answered = sessionsNamed(5, "answered");
      const { eveAt, retired } = eveRetiring(new Set(["hung-0"]));
      const retiring = yield* Effect.forkChild(
        retireSessions(eveAt, [...sessionsNamed(1, "hung"), ...answered]),
      );

      yield* TestClock.adjust(Duration.seconds(8));
      yield* Fiber.join(retiring);
      assert.deepEqual(
        [...retired].sort(),
        answered.map(({ sessionId }) => sessionId),
      );
    }).pipe(Effect.provide(noNetwork)),
  );
});
