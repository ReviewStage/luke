// retire-sessions.test.ts -- a delete's retires end within their budget, whatever eve does, so the delete behind them still runs.
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { StandingSession } from "@luke/database/models/recorded-session";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { noNetwork } from "@luke/wire/testing";
import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { EVE_RESET_OUTCOME } from "./brain-host/eve-sessions.js";
import { type EveAt, retireSessions } from "./retire-sessions.js";

/**
 * eve is a fake that writes down each session it retired, and answers a
 * session named in `hanging` never, as an eve whose reset waits on an inbox
 * that does not let go would. Synthetic session ids throughout.
 */

function sessionsNamed(count: number, prefix: string): StandingSession[] {
  return Array.from({ length: count }, (_, index) => ({
    sessionId: `${prefix}-${index}`,
    kind: CONVERSATION_KIND.CODING_AGENT,
  }));
}

function eveRetiring(hanging: ReadonlySet<string>) {
  const retired: string[] = [];
  const eveAt: EveAt = () =>
    Effect.succeed({
      reset: (sessionId) =>
        hanging.has(sessionId)
          ? Effect.never
          : Effect.sync(() => {
              retired.push(sessionId);
              return { outcome: EVE_RESET_OUTCOME.RESET } as const;
            }),
    });
  return { eveAt, retired };
}

it.effect(
  "a large account's retires end a minute in, however many eve leaves waiting, so the erase behind them runs",
  () =>
    Effect.gen(function* () {
      // Twelve sessions eve never answers: each alone would give up at thirty-five seconds, four
      // at a time, so the three rounds without a budget would run to a hundred and five.
      const hung = sessionsNamed(12, "hung");
      const { eveAt } = eveRetiring(new Set(hung.map(({ sessionId }) => sessionId)));
      const retiring = yield* Effect.forkChild(retireSessions(eveAt, hung));

      yield* TestClock.adjust(Duration.seconds(59));
      assert.equal(retiring.pollUnsafe(), undefined, "still retiring before the minute");
      yield* TestClock.adjust(Duration.seconds(1));
      assert.notEqual(retiring.pollUnsafe(), undefined, "done at the minute");
    }).pipe(Effect.provide(noNetwork)),
);

it.effect(
  "the sessions eve answers within the budget are retired, beside one it never answers",
  () =>
    Effect.gen(function* () {
      const answered = sessionsNamed(5, "answered");
      const { eveAt, retired } = eveRetiring(new Set(["hung-0"]));
      const retiring = yield* Effect.forkChild(
        retireSessions(eveAt, [...sessionsNamed(1, "hung"), ...answered]),
      );

      yield* TestClock.adjust(Duration.seconds(60));
      yield* Fiber.join(retiring);
      assert.deepEqual(
        [...retired].sort(),
        answered.map(({ sessionId }) => sessionId),
      );
    }).pipe(Effect.provide(noNetwork)),
);
