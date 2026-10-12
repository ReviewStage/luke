import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { deleteAccount } from "../server/hosted/account-store";
import {
  beginLinearSignIn,
  completeLinearSignIn,
  deleteLinearConnection,
  LINEAR_ROW_STATUS,
  readLinearConnection,
  readLinearSignIn,
} from "../server/hosted/linear-store";
import { openGithubUser } from "./support/github-app-fake";
import { noNetwork } from "./support/no-network";
import { testSqlClient } from "./support/sql-client";

/**
 * An account's Linear row over the real migration on PGlite: a sign-in is
 * found by its state alone and by no other account's, it settles once, and
 * the row goes with the account that owns it.
 */

it.layer(Layer.mergeAll(testSqlClient, noNetwork))("the Linear connection row", (it) => {
  it.effect("a sign-in is found by its own state, and completing it ends it", () =>
    Effect.gen(function* () {
      const mine = yield* openGithubUser();
      const theirs = yield* openGithubUser();
      yield* beginLinearSignIn(mine, "state-mine");
      yield* beginLinearSignIn(theirs, "state-theirs");

      assert.equal((yield* readLinearSignIn("state-mine"))?.userId, mine);
      assert.equal((yield* readLinearSignIn("state-theirs"))?.userId, theirs);
      assert.equal(yield* readLinearSignIn("state-nobody-issued"), undefined);

      assert.equal(yield* completeLinearSignIn(mine), true);
      assert.equal(yield* readLinearSignIn("state-mine"), undefined);
      const settled = yield* readLinearConnection(mine);
      assert.equal(settled?.status, LINEAR_ROW_STATUS.CONNECTED);
      assert.equal(settled?.stateIssuedAt, undefined);
      // A sign-in a Disconnect ended has no row to complete.
      yield* deleteLinearConnection(theirs);
      assert.equal(yield* completeLinearSignIn(theirs), false);
      assert.equal(yield* readLinearConnection(theirs), undefined);
    }),
  );

  it.effect("the row goes with the account", () =>
    Effect.gen(function* () {
      const userId = yield* openGithubUser();
      yield* beginLinearSignIn(userId, "state-erased");
      yield* completeLinearSignIn(userId);
      yield* deleteAccount(userId);
      assert.equal(yield* readLinearConnection(userId), undefined);
    }),
  );
});
