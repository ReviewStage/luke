import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { INTEGRATION_ROW_STATUS } from "@repo/database/integration-vocabulary";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import { expectTopicsFire, getTestDB } from "@repo/database/testing";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { noNetwork } from "@repo/wire/testing";
import { DateTime, Effect, Layer } from "effect";
import { openGithubUser } from "../testing/github-app-fake.js";
import { firstIntegrationAccount } from "../testing/integration-connect.js";
import {
  beginIntegrationSignIn,
  completeIntegrationSignIn,
  deleteIntegrationAccount,
  deleteIntegrationConnection,
  endIntegrationSignIn,
  expireIntegrationConnection,
  fillIntegrationLabel,
  readIntegrationConnection,
  readIntegrationConnections,
  renameIntegrationConnection,
} from "./integration-store.js";
import { INTEGRATION_GRANT_HOLDER } from "./integration-token.js";
import { readStoredTools, storeTools } from "./integration-tool-store.js";

const LINEAR = INTEGRATION_PROVIDER.LINEAR;
const NOTION = INTEGRATION_PROVIDER.NOTION;

it.layer(Layer.mergeAll(getTestDB(), noNetwork))("the integration connection rows", (it) => {
  it.effect("an account reads its own rows and never another account's", () =>
    Effect.gen(function* () {
      const mine = yield* openGithubUser();
      const theirs = yield* openGithubUser();
      yield* beginIntegrationSignIn(mine, firstIntegrationAccount(mine, LINEAR), "state-own");
      yield* completeIntegrationSignIn(mine, LINEAR, "state-own");
      yield* beginIntegrationSignIn(theirs, firstIntegrationAccount(theirs, LINEAR), "state-other");

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
        yield* beginIntegrationSignIn(again, firstIntegrationAccount(again, LINEAR), "state-first");
        yield* beginIntegrationSignIn(again, firstIntegrationAccount(again, LINEAR), "state-again");
        yield* beginIntegrationSignIn(
          connected,
          firstIntegrationAccount(connected, LINEAR),
          "state-connected",
        );
        yield* completeIntegrationSignIn(connected, LINEAR, "state-connected");
        yield* beginIntegrationSignIn(
          connected,
          firstIntegrationAccount(connected, LINEAR),
          "state-reconnect",
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
    "two accounts at one provider are two rows, each settled and disconnected on its own",
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
        );
        yield* beginIntegrationSignIn(userId, second, "state-personal-notion");
        yield* beginIntegrationSignIn(
          other,
          firstIntegrationAccount(other, NOTION),
          "state-other-notion",
        );
        yield* completeIntegrationSignIn(userId, "notion-2", "state-personal-notion");

        const rows = yield* readIntegrationConnections(userId);
        assert.deepEqual(
          rows.map((row) => [row.connectionName, row.connectSubject, row.status]),
          [
            ["notion", userId, INTEGRATION_ROW_STATUS.PENDING],
            ["notion-2", "subject-2", INTEGRATION_ROW_STATUS.CONNECTED],
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

  it.effect(
    "a grant's name labels an account that carries none, and never one the developer named",
    () =>
      Effect.gen(function* () {
        const userId = yield* openGithubUser();
        const begin = (state: string) =>
          beginIntegrationSignIn(userId, firstIntegrationAccount(userId, NOTION), state);
        yield* begin("state-label-1");
        yield* completeIntegrationSignIn(userId, NOTION, "state-label-1", "Acme");
        assert.equal((yield* readIntegrationConnection(userId, NOTION))?.label, "Acme");

        yield* renameIntegrationConnection(userId, NOTION, "Work");
        yield* begin("state-label-2");
        yield* completeIntegrationSignIn(userId, NOTION, "state-label-2", "Acme");
        assert.equal((yield* readIntegrationConnection(userId, NOTION))?.label, "Work");
      }),
  );

  it.effect(
    "a sign-in for another account that minted a name already taken does not take, and leaves the account it would have overtaken as it stood",
    () =>
      Effect.gen(function* () {
        const userId = yield* openGithubUser();
        const named = (connectSubject: string) => ({
          provider: NOTION,
          connectionName: "notion-2",
          connectSubject,
        });
        const first = yield* beginIntegrationSignIn(
          userId,
          named("subject-a"),
          `state-race-a-${userId}`,
        );
        const second = yield* beginIntegrationSignIn(
          userId,
          named("subject-b"),
          `state-race-b-${userId}`,
        );
        const row = yield* readIntegrationConnection(userId, "notion-2");
        assert.deepEqual(
          [first !== undefined, second, row?.connectSubject, row?.state],
          [true, undefined, "subject-a", `state-race-a-${userId}`],
        );
      }),
  );

  it.effect(
    "a name read for one account's grant labels only that account, never one that replaced it under the same name",
    () =>
      Effect.gen(function* () {
        const userId = yield* openGithubUser();
        const under = (connectSubject: string, state: string) =>
          Effect.andThen(
            beginIntegrationSignIn(
              userId,
              { provider: NOTION, connectionName: "notion-2", connectSubject },
              state,
            ),
            completeIntegrationSignIn(userId, "notion-2", state),
          );
        yield* under("subject-old", `state-old-${userId}`);
        const old = yield* readIntegrationConnection(userId, "notion-2");
        assert.ok(old !== undefined);
        yield* deleteIntegrationConnection(userId, "notion-2");
        yield* under("subject-new", `state-new-${userId}`);
        yield* fillIntegrationLabel(old, "Acme");
        assert.equal((yield* readIntegrationConnection(userId, "notion-2"))?.label, undefined);
      }),
  );

  it.effect(
    "a disconnect of the account read deletes only that account, never one that replaced it under the same name",
    () =>
      Effect.gen(function* () {
        const userId = yield* openGithubUser();
        const under = (connectSubject: string, state: string) =>
          Effect.andThen(
            beginIntegrationSignIn(
              userId,
              { provider: NOTION, connectionName: "notion-2", connectSubject },
              state,
            ),
            completeIntegrationSignIn(userId, "notion-2", state),
          );
        yield* under("subject-read", `state-read-${userId}`);
        const read = yield* readIntegrationConnection(userId, "notion-2");
        assert.ok(read !== undefined);
        yield* deleteIntegrationConnection(userId, "notion-2");
        yield* under("subject-replacing", `state-replacing-${userId}`);

        assert.equal(yield* deleteIntegrationAccount(read), undefined);
        assert.equal(
          (yield* readIntegrationConnection(userId, "notion-2"))?.connectSubject,
          "subject-replacing",
        );
      }),
  );

  it.effect(
    "each write the integrations read draws notifies the account's integrations topic alone, and a tools listing notifies nothing",
    () =>
      Effect.gen(function* () {
        const userId = yield* openGithubUser();
        const integrations: readonly SyncTopic[] = [[TOPIC.ACCOUNT_INTEGRATIONS, userId]];
        const account = firstIntegrationAccount(userId, LINEAR);
        const fires = <A, E, R>(write: Effect.Effect<A, E, R>) =>
          expectTopicsFire(write, integrations);

        yield* fires(beginIntegrationSignIn(userId, account, `state-begin-${userId}`));
        yield* fires(completeIntegrationSignIn(userId, LINEAR, `state-begin-${userId}`));
        const grant = {
          holder: INTEGRATION_GRANT_HOLDER.ACCOUNT,
          provider: LINEAR,
          userId,
          connectionName: LINEAR,
          connectSubject: userId,
        };
        const listed = [{ name: "list_issues" }];
        yield* expectTopicsFire(storeTools(grant, listed, yield* DateTime.nowAsDate), []);
        assert.ok((yield* readStoredTools(grant)) !== undefined, "the listing was kept");
        yield* fires(renameIntegrationConnection(userId, LINEAR, "Acme"));
        yield* fires(expireIntegrationConnection(userId, LINEAR));
        yield* fires(beginIntegrationSignIn(userId, account, `state-again-${userId}`));
        yield* fires(endIntegrationSignIn(userId, LINEAR, `state-again-${userId}`));
        const read = yield* readIntegrationConnection(userId, LINEAR);
        assert.ok(read !== undefined);
        yield* fires(deleteIntegrationAccount(read));
      }),
  );
});
