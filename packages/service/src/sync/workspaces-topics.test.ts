import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { ensurePersonalWorkspace } from "@luke/database/models/workspace-store";
import { user } from "@luke/database/schemas/auth";
import { type SyncTopic, TOPIC } from "@luke/database/sync/notification";
import { expectTopicsFire } from "@luke/database/testing";
import {
  GITHUB_ACCOUNT_TYPE,
  GITHUB_INSTALLATION_STATUS,
} from "@luke/features/github-installation-wire";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { Effect } from "effect";
import { linkInstallation, setInstallationStatus } from "../github/github-installations.js";
import { openWorkspacePlugin } from "../testing/workspace-plugin.js";
import { workspacesLive } from "./live-queries.js";

/**
 * The account's workspaces (`workspacesLive`) on the migrated capture:
 * each write that moves the account's list of workspaces, through its real
 * writer, notifies a topic the read is woken on, as the read looks its
 * topics up when it is asked for, so a window holding it hears the write
 * within a coalesce window rather than at the hold's end. That holds for a
 * workspace renamed, a teammate added to it, and a GitHub installation
 * linked to it or suspended, which notify the workspace; and for the
 * account's first workspace named its own, which notifies the account.
 * Workspaces and memberships are written by the organization plugin, as
 * Luke's routes write them.
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
    yield* db.insert(user).values({ id, name, email: `${id}@luke.test` });
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
        // Note that the workspace is made first under the account's own slug, as a racing ensure
        // would have made it, so the ensure held below adopts it and writes only the row naming it.
        const workspaceId = yield* openTeam(plugin, userId, `personal-${userId}`);

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
