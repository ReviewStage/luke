import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { getTestDB } from "@sidecar/database/testing";
import { INTEGRATION_PROVIDER } from "@sidecar/hosted/integration-wire";
import { Effect, Layer } from "effect";
import {
  beginIntegrationSignIn,
  completeIntegrationSignIn,
  expireIntegrationConnection,
  INTEGRATION_ROW_STATUS,
  readIntegrationConnection,
  readIntegrationConnections,
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
  it.effect("an account reads its own rows and never another account's", () =>
    Effect.gen(function* () {
      const mine = yield* openGithubUser();
      const theirs = yield* openGithubUser();
      yield* beginIntegrationSignIn(mine, LINEAR, "state-own");
      yield* completeIntegrationSignIn(mine, LINEAR, "state-own");
      yield* beginIntegrationSignIn(theirs, LINEAR, "state-other");

      const mineRows = yield* readIntegrationConnections(mine);
      assert.deepEqual(
        mineRows.map((row) => [row.userId, row.provider, row.status, row.state]),
        [[mine, LINEAR, INTEGRATION_ROW_STATUS.CONNECTED, undefined]],
      );
      assert.ok(mineRows[0]?.connectedAt instanceof Date, "a completed sign-in names its grant");
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
});
