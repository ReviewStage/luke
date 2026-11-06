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
import { openWorkspacePlugin } from "../testing/workspace-plugin.js";
import { workspaceIntegrationsLive, workspacesLive } from "./live-queries.js";

type WorkspacePlugin = Effect.Success<typeof openWorkspacePlugin>;

const INSTALLATION_ID = 4_200_001;

const openAccount = (name: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id, name, email: `${id}@app.test` });
    return id;
  });

const openTeam = (plugin: WorkspacePlugin, ownerId: string, slug = `acme-${ownerId}`) =>
  Effect.map(
    Effect.promise(() =>
      plugin.api.createOrganization({ body: { name: "Acme", slug, userId: ownerId } }),
    ),
    (made) => made.id,
  );

const wakesTheWorkspaces = <A, E, R>(
  write: Effect.Effect<A, E, R>,
  topics: readonly SyncTopic[],
  userId: string,
) =>
  Effect.gen(function* () {
    const woken = yield* workspacesLive.topics({ userId });
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
        const woken = workspaceIntegrationsLive.topics({ userId: owner, workspaceId });
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
