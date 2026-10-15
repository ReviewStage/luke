import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { getTestDB } from "@luke/database/testing";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { Effect, Layer, Redacted } from "effect";
import { openGithubUser } from "../testing/github-app-fake.js";
import { firstIntegrationAccount } from "../testing/integration-connect.js";
import { noNetwork } from "../testing/no-network.js";
import {
  beginIntegrationSignIn,
  completeIntegrationSignIn,
  deleteIntegrationConnection,
  endIntegrationSignIn,
  expireIntegrationConnection,
  INTEGRATION_ROW_STATUS,
  readIntegrationConnection,
  readIntegrationConnections,
} from "./integration-store.js";

/**
 * An account's integration rows over the real migration on PGlite: a
 * sign-in is found by its state alone and by no other account's, it settles
 * once, whether with a grant or without one, an account reads only its own rows, and the rows go with the account
 * that owns them. Connect's handle on a sign-in stands and goes with its state.
 */

const LINEAR = INTEGRATION_PROVIDER.LINEAR;
const NOTION = INTEGRATION_PROVIDER.NOTION;

it.layer(Layer.mergeAll(getTestDB(), noNetwork))("the integration connection rows", (it) => {
  it.effect("Connect's handle on a sign-in stands while it is under way and goes with it", () =>
    Effect.gen(function* () {
      const completing = yield* openGithubUser();
      const reconnecting = yield* openGithubUser();
      yield* beginIntegrationSignIn(
        completing,
        firstIntegrationAccount(completing, LINEAR),
        "state-h1",
        Redacted.make("verifier-1"),
      );
      yield* beginIntegrationSignIn(
        reconnecting,
        firstIntegrationAccount(reconnecting, LINEAR),
        "state-h2",
        Redacted.make("verifier-2"),
      );
      yield* completeIntegrationSignIn(reconnecting, LINEAR, "state-h2");
      yield* beginIntegrationSignIn(
        reconnecting,
        firstIntegrationAccount(reconnecting, LINEAR),
        "state-h3",
        Redacted.make("verifier-3"),
      );

      const verifierOf = (userId: string) =>
        Effect.map(readIntegrationConnection(userId, LINEAR), (row) =>
          row?.verifier === undefined ? undefined : Redacted.value(row.verifier),
        );
      assert.equal(yield* verifierOf(completing), "verifier-1");
      // A sign-in begun again holds its own handle.
      assert.equal(yield* verifierOf(reconnecting), "verifier-3");

      yield* completeIntegrationSignIn(completing, LINEAR, "state-h1");
      yield* endIntegrationSignIn(reconnecting, LINEAR, "state-h3");
      assert.equal(yield* verifierOf(completing), undefined);
      // The connected row it ended over stands, without the handle.
      const standing = yield* readIntegrationConnection(reconnecting, LINEAR);
      assert.deepEqual(
        [standing?.status, standing?.verifier],
        [INTEGRATION_ROW_STATUS.CONNECTED, undefined],
      );
    }),
  );

  it.effect("an account reads its own rows and never another account's", () =>
    Effect.gen(function* () {
      const mine = yield* openGithubUser();
      const theirs = yield* openGithubUser();
      yield* beginIntegrationSignIn(
        mine,
        firstIntegrationAccount(mine, LINEAR),
        "state-own",
        Redacted.make("connect-verifier"),
      );
      yield* completeIntegrationSignIn(mine, LINEAR, "state-own");
      yield* beginIntegrationSignIn(
        theirs,
        firstIntegrationAccount(theirs, LINEAR),
        "state-other",
        Redacted.make("connect-verifier"),
      );

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

  it.effect(
    "a sign-in ended without a grant leaves alone a sign-in begun again since, and a row that stood before it",
    () =>
      Effect.gen(function* () {
        const again = yield* openGithubUser();
        const connected = yield* openGithubUser();
        yield* beginIntegrationSignIn(
          again,
          firstIntegrationAccount(again, LINEAR),
          "state-first",
          Redacted.make("connect-verifier"),
        );
        yield* beginIntegrationSignIn(
          again,
          firstIntegrationAccount(again, LINEAR),
          "state-again",
          Redacted.make("connect-verifier"),
        );
        yield* beginIntegrationSignIn(
          connected,
          firstIntegrationAccount(connected, LINEAR),
          "state-connected",
          Redacted.make("connect-verifier"),
        );
        yield* completeIntegrationSignIn(connected, LINEAR, "state-connected");
        yield* beginIntegrationSignIn(
          connected,
          firstIntegrationAccount(connected, LINEAR),
          "state-reconnect",
          Redacted.make("connect-verifier"),
        );

        yield* endIntegrationSignIn(again, LINEAR, "state-first");
        yield* endIntegrationSignIn(connected, LINEAR, "state-reconnect");

        const standing = yield* readIntegrationConnection(again, LINEAR);
        assert.deepEqual(
          [standing?.status, standing?.state],
          [INTEGRATION_ROW_STATUS.PENDING, "state-again"],
        );
        const kept = yield* readIntegrationConnection(connected, LINEAR);
        assert.deepEqual(
          [kept?.status, kept?.state],
          [INTEGRATION_ROW_STATUS.CONNECTED, undefined],
        );
        yield* endIntegrationSignIn(again, LINEAR, "state-again");
        assert.equal(yield* readIntegrationConnection(again, LINEAR), undefined);
      }),
  );

  it.effect(
    "two accounts at one provider are two rows, each settled and disconnected on its own, the first of them primary",
    () =>
      Effect.gen(function* () {
        const userId = yield* openGithubUser();
        const other = yield* openGithubUser();
        const second = {
          provider: NOTION,
          connectionName: "notion-2",
          connectSubject: "subject-2",
        };
        yield* beginIntegrationSignIn(
          userId,
          firstIntegrationAccount(userId, NOTION),
          "state-acme-notion",
          Redacted.make("verifier-acme"),
        );
        yield* beginIntegrationSignIn(
          userId,
          second,
          "state-personal-notion",
          Redacted.make("verifier-2"),
        );
        // Another account's first Notion takes the same name as this one's, which names no row of this one's.
        yield* beginIntegrationSignIn(
          other,
          firstIntegrationAccount(other, NOTION),
          "state-other-notion",
          Redacted.make("verifier-other"),
        );
        yield* completeIntegrationSignIn(userId, "notion-2", "state-personal-notion");

        const rows = yield* readIntegrationConnections(userId);
        assert.deepEqual(
          rows.map((row) => [row.connectionName, row.connectSubject, row.primary, row.status]),
          [
            ["notion", userId, true, INTEGRATION_ROW_STATUS.PENDING],
            ["notion-2", "subject-2", false, INTEGRATION_ROW_STATUS.CONNECTED],
          ],
        );
        assert.notEqual(rows[0]?.id, rows[1]?.id);

        yield* deleteIntegrationConnection(userId, "notion-2");
        assert.deepEqual(
          (yield* readIntegrationConnections(userId)).map((row) => row.connectionName),
          ["notion"],
        );
        assert.equal((yield* readIntegrationConnection(other, NOTION))?.connectSubject, other);
      }),
  );

  it.effect(
    "an account's first account at each of two providers asks under its own user id at both",
    () =>
      Effect.gen(function* () {
        const userId = yield* openGithubUser();
        for (const provider of [LINEAR, NOTION]) {
          yield* beginIntegrationSignIn(
            userId,
            firstIntegrationAccount(userId, provider),
            `state-first-${provider}-${userId}`,
            Redacted.make("verifier"),
          );
          yield* completeIntegrationSignIn(userId, provider, `state-first-${provider}-${userId}`);
        }
        assert.deepEqual(
          (yield* readIntegrationConnections(userId)).map((row) => [
            row.provider,
            row.connectSubject,
            row.status,
          ]),
          [
            [LINEAR, userId, INTEGRATION_ROW_STATUS.CONNECTED],
            [NOTION, userId, INTEGRATION_ROW_STATUS.CONNECTED],
          ],
        );
      }),
  );
});
