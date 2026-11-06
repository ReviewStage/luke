// retire-sessions.test.ts -- a delete's retires end within their budget, whatever the sessions do, so the delete behind them still runs.
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { StandingSession } from "@repo/database/models/recorded-session";
import { CONVERSATION_KIND } from "@repo/database/storage-vocabulary";
import { getTestDB } from "@repo/database/testing";
import { noNetwork } from "@repo/wire/testing";
import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { type Retiring, retireSessions } from "./retire-sessions.js";
import { SESSION_RESET_OUTCOME } from "./sessions/agent-sessions.js";

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

function sessionsRetiring(hanging: ReadonlySet<string>) {
  const retired: string[] = [];
  const sessionsAt: Retiring = {
    reset: (sessionId) =>
      hanging.has(sessionId)
        ? Effect.never
        : Effect.sync(() => {
            retired.push(sessionId);
            return { outcome: SESSION_RESET_OUTCOME.RESET } as const;
          }),
  };
  return { sessionsAt, retired };
}

it.layer(getTestDB())("sessions retired", (it) => {
  it.effect(
    "a large account's retires end eight seconds in, however many are left waiting, so the erase behind them runs",
    () =>
      Effect.gen(function* () {
        // Twelve sessions never answered: each alone would give up at five seconds, four at a
        // time, so the three rounds without a budget would run to fifteen.
        const hung = sessionsNamed(12, "hung");
        const { sessionsAt } = sessionsRetiring(new Set(hung.map(({ sessionId }) => sessionId)));
        const retiring = yield* Effect.forkChild(retireSessions(sessionsAt, hung));

        yield* TestClock.adjust(Duration.seconds(7));
        assert.equal(retiring.pollUnsafe(), undefined, "still retiring before the budget");
        yield* TestClock.adjust(Duration.seconds(1));
        assert.notEqual(retiring.pollUnsafe(), undefined, "done at the budget");
      }).pipe(Effect.provide(noNetwork)),
  );

  it.effect("the sessions answered within the budget are retired, beside one never answered", () =>
    Effect.gen(function* () {
      const answered = sessionsNamed(5, "answered");
      const { sessionsAt, retired } = sessionsRetiring(new Set(["hung-0"]));
      const retiring = yield* Effect.forkChild(
        retireSessions(sessionsAt, [...sessionsNamed(1, "hung"), ...answered]),
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
