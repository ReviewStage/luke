import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { getTestDB, mutableFunctionsOf } from "@repo/database/testing";
import { LIVE_PARAM } from "@repo/features/live-read";
import { Effect, Option } from "effect";
import { BOUND_READS } from "../sync/live-queries.js";
import type { SyncMoved } from "../sync/live-query.js";

/**
 * Every statement the live endpoints answer calls only functions Postgres
 * marks immutable, so the same rows always read alike: a statement that read
 * the clock or the session would digest anew on every look, and a held read
 * would answer at once rather than hold.
 */

const USER_ID = "user-live-statements";

/** What moved for a delta read's statements: one key of every table, column, and topic kind, so every way it narrows is built. */
const MOVED_EVERYTHING: SyncMoved = { keys: () => [randomUUID()], topics: () => [randomUUID()] };

/** Every bound read's statements (`./live-read-binding.ts`), by its read and part, each param the reader or a fresh id: its whole statements, and a delta read's narrowed ones too. */
function liveStatements() {
  return Object.fromEntries(
    BOUND_READS.flatMap((query) => {
      const params = Object.fromEntries(
        Object.entries(query.declaration.params).map(([key, param]) => [
          key,
          param === LIVE_PARAM.USER ? USER_ID : randomUUID(),
        ]),
      );
      const whole = Object.entries(Option.getOrThrow(query.statements(params)));
      const narrowed =
        query.delta === undefined
          ? []
          : Object.entries(Option.getOrThrow(query.delta.statements(params, MOVED_EVERYTHING))).map(
              ([part, statement]) => [`delta.${part}`, statement] as const,
            );
      return [...whole, ...narrowed].map(([part, statement]) => [
        `${query.name}.${part}`,
        statement,
      ]);
    }),
  );
}

it.layer(getTestDB())("the live statements", (it) => {
  it.effect(
    "every statement a live endpoint answers calls only immutable functions, so its rows digest alike on every look",
    () =>
      Effect.gen(function* () {
        const mutable = yield* Effect.forEach(
          Object.entries(liveStatements()),
          ([part, statement]) =>
            Effect.map(mutableFunctionsOf(statement), (called) => [part, called] as const),
        );
        assert.deepEqual(
          mutable.filter(([, called]) => called.length > 0),
          [],
        );
      }),
  );
});
