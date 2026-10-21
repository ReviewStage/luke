import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { getTestDB, mutableFunctionsOf } from "@luke/database/testing";
import { Effect, Option } from "effect";
import { automationRunsLiveStatements, automationsLiveStatements } from "./automation-live.js";

/**
 * A workspace's automations and an automation's runs, as their live
 * endpoints seal them, call only functions Postgres marks immutable, since
 * Neon Realtime refuses any other ("scalar expression uses a mutable
 * function") where Postgres runs it without a word.
 */

it.layer(getTestDB())("the automations' live statements", (it) => {
  it.effect("call only functions Postgres marks immutable, as Realtime requires", () =>
    Effect.gen(function* () {
      const { automations } = Option.getOrThrow(
        automationsLiveStatements("user-immutable", "workspace-immutable"),
      );
      const { runs } = Option.getOrThrow(
        automationRunsLiveStatements("user-immutable", randomUUID()),
      );
      assert.deepEqual(yield* mutableFunctionsOf(automations), []);
      assert.deepEqual(yield* mutableFunctionsOf(runs), []);
    }),
  );
});
