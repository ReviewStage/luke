import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { TRIGGER_PROVIDER } from "@luke/features/trigger-catalog";
import { DateTime, Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { INTEGRATION_INSTALLATION_STATUS } from "../../integration-vocabulary.js";
import { organization, user } from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import {
  activeInstallationWorkspace,
  INSTALLATION_LINK,
  INTEGRATION_INSTALL_INTENT_LIFETIME,
  linkIntegrationInstallation,
  markIntegrationInstallationDeleted,
  openIntegrationInstallIntent,
  spendIntegrationInstallIntent,
  workspaceIntegrationInstallations,
} from "../integration-installation-store.js";

/**
 * Which workspace an integration's installation stands for, over a real
 * dialect: an installation stands for one workspace and is never moved to
 * another while active, an uninstalled one finds no workspace, and an
 * install intent is spent once, inside its hour, at its own provider.
 *
 * Synthetic accounts and workspaces throughout.
 */

const SENTRY = TRIGGER_PROVIDER.SENTRY;

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

const openWorkspace = Effect.gen(function* () {
  const db = yield* Database;
  const id = randomUUID();
  yield* db.insert(organization).values({
    id,
    name: "Test Workspace",
    slug: `workspace-${id}`,
    createdAt: yield* DateTime.nowAsDate,
  });
  return id;
});

it.layer(getTestDB())("the integration installation store", (it) => {
  it.effect(
    "an installation stands for the workspace that linked it, and another workspace neither takes it nor lists it",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const stranger = yield* openAccount;
        const ours = yield* openWorkspace;
        const theirs = yield* openWorkspace;
        const externalId = randomUUID();

        const linked = yield* linkIntegrationInstallation({
          provider: SENTRY,
          externalId,
          organizationId: ours,
          userId: owner,
        });
        const taken = yield* linkIntegrationInstallation({
          provider: SENTRY,
          externalId,
          organizationId: theirs,
          userId: stranger,
        });
        const relinked = yield* linkIntegrationInstallation({
          provider: SENTRY,
          externalId,
          organizationId: ours,
          userId: owner,
        });

        assert.equal(linked, INSTALLATION_LINK.LINKED);
        assert.equal(taken, INSTALLATION_LINK.ALREADY_CONNECTED);
        assert.equal(relinked, INSTALLATION_LINK.LINKED);
        assert.deepEqual(yield* activeInstallationWorkspace(SENTRY, externalId), Option.some(ours));
        assert.deepEqual(
          (yield* workspaceIntegrationInstallations(ours)).map((row) => [
            row.externalId,
            row.status,
            row.linkedByUserId,
          ]),
          [[externalId, INTEGRATION_INSTALLATION_STATUS.ACTIVE, owner]],
        );
        assert.deepEqual(yield* workspaceIntegrationInstallations(theirs), []);
      }),
  );

  it.effect(
    "an uninstalled installation finds no workspace, until a workspace links it again",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const ours = yield* openWorkspace;
        const theirs = yield* openWorkspace;
        const externalId = randomUUID();
        yield* linkIntegrationInstallation({
          provider: SENTRY,
          externalId,
          organizationId: ours,
          userId: owner,
        });

        const deleted = yield* markIntegrationInstallationDeleted(SENTRY, externalId);
        const deletedAgain = yield* markIntegrationInstallationDeleted(SENTRY, externalId);
        const unknown = yield* markIntegrationInstallationDeleted(SENTRY, randomUUID());
        const afterUninstall = yield* activeInstallationWorkspace(SENTRY, externalId);
        const listed = yield* workspaceIntegrationInstallations(ours);
        const moved = yield* linkIntegrationInstallation({
          provider: SENTRY,
          externalId,
          organizationId: theirs,
          userId: owner,
        });

        assert.equal(deleted, true);
        assert.equal(deletedAgain, false, "only an active installation is marked deleted");
        assert.equal(unknown, false);
        assert.ok(Option.isNone(afterUninstall));
        assert.deepEqual(
          listed.map((row) => row.status),
          [INTEGRATION_INSTALLATION_STATUS.DELETED],
        );
        assert.equal(moved, INSTALLATION_LINK.LINKED);
        assert.deepEqual(
          yield* activeInstallationWorkspace(SENTRY, externalId),
          Option.some(theirs),
        );
        assert.deepEqual(yield* workspaceIntegrationInstallations(ours), []);
      }),
  );

  it.effect(
    "a re-link names the installation's account anew, and a link that read no name keeps the one standing",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const ours = yield* openWorkspace;
        const externalId = randomUUID();
        const link = { provider: SENTRY, externalId, organizationId: ours, userId: owner };
        const labelOf = Effect.map(workspaceIntegrationInstallations(ours), (rows) =>
          rows.map((row) => row.accountLabel),
        );

        yield* linkIntegrationInstallation({ ...link, accountLabel: "acme" });
        const first = yield* labelOf;
        yield* markIntegrationInstallationDeleted(SENTRY, externalId);
        yield* linkIntegrationInstallation({ ...link, accountLabel: "acme-renamed" });
        const renamed = yield* labelOf;
        yield* linkIntegrationInstallation(link);
        const kept = yield* labelOf;

        assert.deepEqual(first, ["acme"]);
        assert.deepEqual(renamed, ["acme-renamed"]);
        assert.deepEqual(kept, ["acme-renamed"]);
      }),
  );

  it.effect("an install intent is spent once, at its own provider, inside its hour", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const ours = yield* openWorkspace;

      const state = yield* openIntegrationInstallIntent(SENTRY, owner, ours);
      const spent = yield* spendIntegrationInstallIntent(SENTRY, state);
      const again = yield* spendIntegrationInstallIntent(SENTRY, state);
      const forged = yield* spendIntegrationInstallIntent(SENTRY, `${state}x`);
      const late = yield* openIntegrationInstallIntent(SENTRY, owner, ours);
      yield* TestClock.adjust(
        Duration.sum(INTEGRATION_INSTALL_INTENT_LIFETIME, Duration.seconds(1)),
      );
      const expired = yield* spendIntegrationInstallIntent(SENTRY, late);

      assert.deepEqual(spent, Option.some({ userId: owner, organizationId: ours }));
      assert.ok(Option.isNone(again), "a spent intent links nothing");
      assert.ok(Option.isNone(forged));
      assert.ok(Option.isNone(expired), "an intent past its hour links nothing");
    }),
  );
});
