import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { deleteAccount } from "@sidecar/database/models/account-store";
import { getTestDB } from "@sidecar/database/testing";
import { INTEGRATION_PROVIDER } from "@sidecar/hosted/integration-wire";
import { Effect, Layer } from "effect";
import {
  beginIntegrationSignIn,
  completeIntegrationSignIn,
  deleteIntegrationConnection,
  expireIntegrationConnection,
  INTEGRATION_ROW_STATUS,
  readIntegrationConnection,
  readIntegrationConnections,
  readIntegrationSignIn,
} from "../server/hosted/integration-store";
import { openGithubUser } from "./support/github-app-fake";
import { noNetwork } from "./support/no-network";

/**
 * An account's integration rows over the real migration on PGlite: a
 * sign-in is found by its state alone and by no other account's, it settles
 * once, an account reads only its own rows, and the rows go with the account
 * that owns them.
 */

const LINEAR = INTEGRATION_PROVIDER.LINEAR;

it.layer(Layer.mergeAll(getTestDB(), noNetwork))("the integration connection rows", (it) => {
  it.effect("a sign-in is found by its own state, and completing it ends it", () =>
    Effect.gen(function* () {
      const mine = yield* openGithubUser();
      const theirs = yield* openGithubUser();
      yield* beginIntegrationSignIn(mine, LINEAR, "state-mine");
      yield* beginIntegrationSignIn(theirs, LINEAR, "state-theirs");

      const signIn = yield* readIntegrationSignIn("state-mine");
      assert.equal(signIn?.userId, mine);
      assert.equal(signIn?.provider, LINEAR);
      assert.equal((yield* readIntegrationSignIn("state-theirs"))?.userId, theirs);
      assert.equal(yield* readIntegrationSignIn("state-nobody-issued"), undefined);

      assert.equal(yield* completeIntegrationSignIn(mine, LINEAR, "state-mine"), true);
      assert.equal(yield* readIntegrationSignIn("state-mine"), undefined);
      const settled = yield* readIntegrationConnection(mine, LINEAR);
      assert.equal(settled?.status, INTEGRATION_ROW_STATUS.CONNECTED);
      assert.equal(settled?.stateIssuedAt, undefined);
      // A sign-in begun again replaces the state, so the older one completes nothing.
      yield* beginIntegrationSignIn(theirs, LINEAR, "state-theirs-again");
      assert.equal(yield* completeIntegrationSignIn(theirs, LINEAR, "state-theirs"), false);
      // A sign-in a Disconnect ended has no row to complete.
      yield* deleteIntegrationConnection(theirs, LINEAR);
      assert.equal(yield* completeIntegrationSignIn(theirs, LINEAR, "state-theirs-again"), false);
      assert.equal(yield* readIntegrationConnection(theirs, LINEAR), undefined);
    }),
  );

  it.effect("an account reads its own rows and never another account's", () =>
    Effect.gen(function* () {
      const mine = yield* openGithubUser();
      const theirs = yield* openGithubUser();
      yield* beginIntegrationSignIn(mine, LINEAR, "state-own");
      yield* completeIntegrationSignIn(mine, LINEAR, "state-own");
      yield* beginIntegrationSignIn(theirs, LINEAR, "state-other");

      assert.deepEqual(yield* readIntegrationConnections(mine), [
        {
          userId: mine,
          provider: LINEAR,
          status: INTEGRATION_ROW_STATUS.CONNECTED,
          state: undefined,
          stateIssuedAt: undefined,
        },
      ]);
      const theirRows = yield* readIntegrationConnections(theirs);
      assert.deepEqual(
        theirRows.map((row) => [row.userId, row.status]),
        [[theirs, INTEGRATION_ROW_STATUS.PENDING]],
      );
      // Only a connected row expires; a sign-in under way stands as it was.
      yield* expireIntegrationConnection(mine, LINEAR);
      yield* expireIntegrationConnection(theirs, LINEAR);
      assert.equal(
        (yield* readIntegrationConnection(mine, LINEAR))?.status,
        INTEGRATION_ROW_STATUS.EXPIRED,
      );
      assert.equal(
        (yield* readIntegrationConnection(theirs, LINEAR))?.status,
        INTEGRATION_ROW_STATUS.PENDING,
      );
    }),
  );

  it.effect("the rows go with the account", () =>
    Effect.gen(function* () {
      const userId = yield* openGithubUser();
      yield* beginIntegrationSignIn(userId, LINEAR, "state-erased");
      yield* completeIntegrationSignIn(userId, LINEAR, "state-erased");
      yield* deleteAccount(userId);
      assert.deepEqual(yield* readIntegrationConnections(userId), []);
    }),
  );
});
