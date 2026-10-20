import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { ownFailedRunsLiveStatement } from "@luke/database/models/automation-store";
import { getTestDB, mutableFunctionsOf } from "@luke/database/testing";
import { Effect, Option } from "effect";
import { accountInboxLiveStatements } from "../inbox/inbox-store.js";

/**
 * Every statement the live endpoints seal calls only functions Postgres
 * marks immutable, since Neon Realtime refuses any other ("scalar expression
 * uses a mutable function") where Postgres runs it without a word.
 */

const USER_ID = "user-live-statements";

/** Every live statement the endpoints seal, by the part it answers. */
function liveStatements() {
  const account = Option.getOrThrow(accountInboxLiveStatements(USER_ID));
  return {
    ...Object.fromEntries(
      Object.entries(account).map(([part, query]) => [`account.${part}`, query]),
    ),
    "account.failedRuns": Option.getOrThrow(ownFailedRunsLiveStatement(USER_ID)),
  };
}

it.layer(getTestDB())("the live statements", (it) => {
  it.effect(
    "every statement a live endpoint seals calls only immutable functions, as Realtime requires",
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
