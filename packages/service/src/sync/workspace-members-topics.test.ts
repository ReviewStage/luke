import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createAutomation } from "@luke/database/models/automation-store";
import { createCodingAgent, renameCodingAgent } from "@luke/database/models/coding-agent-store";
import { createTask, updateTask } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import { type SyncTopic, TOPIC } from "@luke/database/sync/notification";
import { expectTopicsFire } from "@luke/database/testing";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
} from "@luke/features/automation-wire";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { eq } from "drizzle-orm";
import { Effect, Option, Result } from "effect";
import { memberIdOf } from "../accounts/workspace-members.js";
import { postInboxThread } from "../inbox/inbox-store.js";
import { openWorkspacePlugin } from "../testing/workspace-plugin.js";
import { workspaceInvitationsLive, workspaceMembersLive } from "./live-queries.js";

/**
 * A workspace's people and its invitations (`workspaceMembersLive`,
 * `workspaceInvitationsLive`) on the migrated capture: each write that moves
 * either read, through its real writer, notifies the workspace's topic, which
 * both reads are woken on, so a window holding them hears it within a
 * coalesce window rather than at the hold's end. Memberships and invitations
 * are written by the organization plugin through the seams Luke's routes
 * call; an account's name and its sign-in by the account's own row, as the
 * plugin's adapter writes them; and the work that names a former member by
 * the stores. A sign-in moves no read, so it notifies nothing.
 *
 * Synthetic accounts, workspaces, and work throughout.
 */

type WorkspacePlugin = Effect.Success<typeof openWorkspacePlugin>;

/** The live reads a workspace's settings hold, both bound to the reader and the workspace. */
const WORKSPACE_READS = [workspaceMembersLive, workspaceInvitationsLive];

const openAccount = (name: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id, name, email: `${id}@luke.test` });
    return id;
  });

/** A session of the account's, as the headers the plugin's calls are made under. */
const sessionOf = (plugin: WorkspacePlugin, userId: string) =>
  Effect.map(
    plugin.sessionBearerOf(userId),
    (bearer) => new Headers({ authorization: `Bearer ${bearer}` }),
  );

/** A shared workspace the owner makes through the plugin's server-only create. */
const openTeam = (plugin: WorkspacePlugin, ownerId: string) =>
  Effect.map(
    Effect.promise(() =>
      plugin.api.createOrganization({
        body: { name: "Acme", slug: `acme-${ownerId}`, userId: ownerId },
      }),
    ),
    (made) => made.id,
  );

/**
 * Runs the write, held to the topics it notifies, and fails unless one of
 * them wakes each of the workspace's reads for the reader.
 */
const wakesTheWorkspace = <A, E, R>(
  write: Effect.Effect<A, E, R>,
  topics: readonly SyncTopic[],
  params: { readonly userId: string; readonly workspaceId: string },
) =>
  Effect.gen(function* () {
    const fired = yield* expectTopicsFire(write, topics);
    for (const read of WORKSPACE_READS) {
      const woken = read.topics(params);
      assert.ok(
        topics.some(([kind, id]) => woken.some((topic) => topic[0] === kind && topic[1] === id)),
        `the ${read.name} read is woken by a topic the write notifies`,
      );
    }
    return fired;
  });

it.effect(
  "a teammate added, renamed, given a role, and removed notifies the workspace, and a sign-in notifies nothing",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const owner = yield* openAccount("Ada Lovelace");
        const teammate = yield* openAccount("Grace Hopper");
        const workspaceId = yield* openTeam(plugin, owner);
        const headers = yield* sessionOf(plugin, owner);
        const reader = { userId: owner, workspaceId };
        const moved: readonly SyncTopic[] = [
          [TOPIC.WORKSPACE, workspaceId],
          [TOPIC.ACCOUNT, teammate],
        ];

        yield* wakesTheWorkspace(
          Effect.promise(() =>
            plugin.api.addMember({
              body: { userId: teammate, organizationId: workspaceId, role: WORKSPACE_ROLE.MEMBER },
            }),
          ),
          moved,
          reader,
        );
        yield* wakesTheWorkspace(
          Database.use((db) =>
            db.update(user).set({ name: "Grace B. Hopper" }).where(eq(user.id, teammate)),
          ),
          moved,
          reader,
        );
        yield* expectTopicsFire(
          Database.use((db) =>
            db.update(user).set({ lastLoginMethod: "github" }).where(eq(user.id, teammate)),
          ),
          [],
        );
        const memberId = Option.getOrThrow(yield* memberIdOf(teammate, workspaceId));
        yield* wakesTheWorkspace(
          plugin.members.updateMemberRole({
            headers,
            organizationId: workspaceId,
            memberId,
            role: WORKSPACE_ROLE.ADMIN,
          }),
          moved,
          reader,
        );
        yield* wakesTheWorkspace(
          plugin.members.removeMember({ headers, organizationId: workspaceId, memberId }),
          moved,
          reader,
        );
      }).pipe(Effect.provide(plugin.database));
    }),
);

it.effect("an invitation made and canceled through the plugin notifies the workspace", () =>
  Effect.gen(function* () {
    const plugin = yield* openWorkspacePlugin;
    yield* Effect.gen(function* () {
      const owner = yield* openAccount("Ada Lovelace");
      const workspaceId = yield* openTeam(plugin, owner);
      const headers = yield* sessionOf(plugin, owner);
      const reader = { userId: owner, workspaceId };
      const workspace: readonly SyncTopic[] = [[TOPIC.WORKSPACE, workspaceId]];

      const invited = yield* wakesTheWorkspace(
        plugin.members.inviteMember({
          headers,
          organizationId: workspaceId,
          email: "grace@example.com",
          role: WORKSPACE_ROLE.MEMBER,
        }),
        workspace,
        reader,
      );
      yield* wakesTheWorkspace(
        plugin.members.cancelInvitation({ headers, invitationId: invited.value.id }),
        workspace,
        reader,
      );
    }).pipe(Effect.provide(plugin.database));
  }),
);

it.effect(
  "a write to a teammate's task, agent, workspace automation, and the agent's inbox item each notifies the workspace, whose former members that work names",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const owner = yield* openAccount("Ada Lovelace");
        const teammate = yield* openAccount("Grace Hopper");
        const workspaceId = yield* openTeam(plugin, owner);
        yield* Effect.promise(() =>
          plugin.api.addMember({
            body: { userId: teammate, organizationId: workspaceId, role: WORKSPACE_ROLE.MEMBER },
          }),
        );
        const task = yield* createTask(teammate, { organizationId: workspaceId, name: "Invites" });
        const started = yield* createCodingAgent(teammate, {
          taskId: task.id,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: "acme/api",
          planSnapshot: "# Invites\n",
          prompt: null,
        });
        const agentId = Option.getOrThrow(started).agent.id;
        const reader = { userId: owner, workspaceId };
        const workspace: SyncTopic = [TOPIC.WORKSPACE, workspaceId];
        const onTheTask: readonly SyncTopic[] = [[TOPIC.TASK, task.id], workspace];

        yield* wakesTheWorkspace(
          updateTask(teammate, task.id, { name: "Teammate invites" }),
          onTheTask,
          reader,
        );
        yield* wakesTheWorkspace(
          renameCodingAgent(teammate, agentId, "Invite flow"),
          [[TOPIC.AGENT, agentId], ...onTheTask],
          reader,
        );
        yield* wakesTheWorkspace(
          createAutomation(teammate, {
            id: randomUUID(),
            organizationId: workspaceId,
            repositories: ["acme/api"],
            name: "Nightly sweep",
            scope: AUTOMATION_SCOPE.WORKSPACE,
            trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
            action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Fix one flaky test." },
            guards: AUTOMATION_DEFAULT_GUARDS,
            nextRunAt: null,
            webhookSecretHash: null,
          }),
          [workspace, [TOPIC.ACCOUNT, teammate]],
          reader,
        );
        yield* wakesTheWorkspace(
          Effect.map(
            postInboxThread(
              { userId: teammate, taskId: task.id, agentId },
              { key: "heads-up", title: "Main is protected now", body: "Pushes need a review." },
            ),
            Result.getOrThrow,
          ),
          [[TOPIC.AGENT, agentId], ...onTheTask, [TOPIC.ACCOUNT, owner], [TOPIC.ACCOUNT, teammate]],
          reader,
        );
      }).pipe(Effect.provide(plugin.database));
    }),
);
