import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  linkIntegrationInstallation,
  markIntegrationInstallationDeleted,
} from "@repo/database/models/integration-installation-store";
import {
  linkSlackInstallation,
  writeSlackChannelRepository,
  writeSlackDefaultRepository,
} from "@repo/database/models/slack-installation-store";
import { ensurePersonalWorkspace } from "@repo/database/models/workspace-store";
import { user } from "@repo/database/schemas/auth";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import { expectTopicsFire } from "@repo/database/testing";
import {
  GITHUB_ACCOUNT_TYPE,
  GITHUB_INSTALLATION_STATUS,
} from "@repo/features/github-installation-wire";
import { TRIGGER_PROVIDER } from "@repo/features/trigger-catalog";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { Effect, Option } from "effect";
import { linkInstallation, setInstallationStatus } from "../github/github-installations.js";
import { workspaceIntegrationsRead } from "../live/reads/workspace-integrations.js";
import { workspacesRead } from "../live/reads/workspaces.js";
import { openWorkspacePlugin } from "../testing/workspace-plugin.js";

/**
 * The account's workspaces (`workspacesRead`) on the migrated capture:
 * each write that moves the account's list of workspaces, through its real
 * writer, notifies a topic the read is woken on, as the read looks its
 * topics up when it is asked for, so a window holding it hears the write
 * within a coalesce window rather than at the hold's end. That holds for a
 * workspace renamed, a teammate added to it, and a GitHub installation
 * linked to it or suspended, which notify the workspace; and for the
 * account's first workspace named its own, which notifies the account.
 * Workspaces and memberships are written by the organization plugin, as
 * our routes write them. A workspace's own integrations
 * (`workspaceIntegrationsRead`) are on a narrower topic of their own, which
 * every write to its Sentry installations or its Slack bot notifies alone.
 *
 * Synthetic accounts, workspaces, and installations throughout.
 */

type WorkspacePlugin = Effect.Success<typeof openWorkspacePlugin>;

/** GitHub's id for the installation linked, and for the account it is on: each test opens a database of its own. */
const INSTALLATION_ID = 4_200_001;

const openAccount = (name: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id, name, email: `${id}@app.test` });
    return id;
  });

/** A workspace the owner makes through the plugin's server-only create, under the slug given. */
const openTeam = (plugin: WorkspacePlugin, ownerId: string, slug = `acme-${ownerId}`) =>
  Effect.map(
    Effect.promise(() =>
      plugin.api.createOrganization({ body: { name: "Acme", slug, userId: ownerId } }),
    ),
    (made) => made.id,
  );

/**
 * Runs the write, held to the topics it notifies, and fails unless one of
 * them wakes the account's workspaces, as the held read looked its topics
 * up before the write.
 */
const wakesTheWorkspaces = <A, E, R>(
  write: Effect.Effect<A, E, R>,
  topics: readonly SyncTopic[],
  userId: string,
) =>
  Effect.gen(function* () {
    const woken = yield* workspacesRead.topics({ userId });
    const fired = yield* expectTopicsFire(write, topics);
    assert.ok(
      topics.some(([kind, id]) => woken.some((topic) => topic[0] === kind && topic[1] === id)),
      "the workspaces read is woken by a topic the write notifies",
    );
    return fired;
  });

it.effect(
  "a workspace renamed, a teammate added, and an installation linked and suspended each notify the workspace",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const owner = yield* openAccount("Ada Lovelace");
        const teammate = yield* openAccount("Grace Hopper");
        const workspaceId = yield* openTeam(plugin, owner);
        const headers = new Headers({
          authorization: `Bearer ${yield* plugin.sessionBearerOf(owner)}`,
        });
        const workspace: SyncTopic = [TOPIC.WORKSPACE, workspaceId];

        yield* wakesTheWorkspaces(
          plugin.members.updateOrganization({
            headers,
            organizationId: workspaceId,
            data: { name: "Acme Robotics" },
          }),
          [workspace],
          owner,
        );
        yield* wakesTheWorkspaces(
          Effect.promise(() =>
            plugin.api.addMember({
              body: { userId: teammate, organizationId: workspaceId, role: WORKSPACE_ROLE.MEMBER },
            }),
          ),
          [workspace, [TOPIC.ACCOUNT, teammate]],
          owner,
        );
        yield* wakesTheWorkspaces(
          linkInstallation(workspaceId, {
            installationId: INSTALLATION_ID,
            accountId: INSTALLATION_ID,
            accountLogin: "acme",
            accountType: GITHUB_ACCOUNT_TYPE.ORGANIZATION,
            suspended: false,
          }),
          [workspace],
          owner,
        );
        yield* wakesTheWorkspaces(
          setInstallationStatus(INSTALLATION_ID, GITHUB_INSTALLATION_STATUS.SUSPENDED),
          [workspace],
          owner,
        );
      }).pipe(Effect.provide(plugin.database));
    }),
);

it.effect(
  "the account's first workspace named its own notifies the account and the workspace",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const userId = yield* openAccount("Ada Lovelace");
        // Note that the workspace is made first under the account's own slug and marked personal,
        // as a racing ensure would have made it, so the ensure held below adopts it and writes only
        // the row naming it.
        const { id: workspaceId } = yield* plugin.seams.createOrganization({
          name: "Ada Lovelace",
          slug: "ada-lovelace",
          userId,
          metadata: { personal: true },
        });

        yield* wakesTheWorkspaces(
          ensurePersonalWorkspace(userId, plugin.seams),
          [
            [TOPIC.WORKSPACE, workspaceId],
            [TOPIC.ACCOUNT, userId],
          ],
          userId,
        );
      }).pipe(Effect.provide(plugin.database));
    }),
);

it.effect(
  "a Sentry link, a disconnect, Sentry's uninstall, a Slack connect, a default repository, and a channel's repository forgotten each notify the workspace's integrations alone, and each write that answers its transaction answers the one it notified in",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const owner = yield* openAccount("Ada Lovelace");
        const workspaceId = yield* openTeam(plugin, owner);
        const integrations: readonly SyncTopic[] = [[TOPIC.WORKSPACE_INTEGRATIONS, workspaceId]];
        const woken = workspaceIntegrationsRead.topics({ userId: owner, workspaceId });
        assert.ok(
          woken.some(([kind, id]) => kind === TOPIC.WORKSPACE_INTEGRATIONS && id === workspaceId),
          "the integrations read is woken by the workspace's integrations topic",
        );
        const sentry = (externalId: string) =>
          linkIntegrationInstallation({
            provider: TRIGGER_PROVIDER.SENTRY,
            externalId,
            organizationId: workspaceId,
            userId: owner,
          });
        const [disconnected, uninstalled] = [randomUUID(), randomUUID()];
        /** A write that answers its transaction, which must be the one its notification carries. */
        const answersItsTransaction = (fired: {
          readonly value: Option.Option<string> | string;
          readonly txids: readonly string[];
        }) => {
          const txid =
            typeof fired.value === "string" ? fired.value : Option.getOrThrow(fired.value);
          assert.deepEqual(fired.txids, [txid]);
        };

        yield* expectTopicsFire(sentry(disconnected), integrations);
        answersItsTransaction(
          yield* expectTopicsFire(
            markIntegrationInstallationDeleted(TRIGGER_PROVIDER.SENTRY, disconnected, workspaceId),
            integrations,
          ),
        );
        yield* sentry(uninstalled);
        yield* expectTopicsFire(
          markIntegrationInstallationDeleted(TRIGGER_PROVIDER.SENTRY, uninstalled),
          integrations,
        );
        answersItsTransaction(
          yield* expectTopicsFire(
            linkSlackInstallation({
              organizationId: workspaceId,
              teamId: "T0001",
              teamName: "Acme",
              userId: owner,
            }),
            integrations,
          ),
        );
        answersItsTransaction(
          yield* expectTopicsFire(
            writeSlackDefaultRepository(workspaceId, "acme/relay"),
            integrations,
          ),
        );
        yield* writeSlackChannelRepository(workspaceId, "C0001", "acme/api");
        answersItsTransaction(
          yield* expectTopicsFire(
            writeSlackChannelRepository(workspaceId, "C0001", null),
            integrations,
          ),
        );
      }).pipe(Effect.provide(plugin.database));
    }),
);
