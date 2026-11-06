import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent, renameAgent } from "@repo/database/models/agent-store";
import { createAutomation } from "@repo/database/models/automation-store";
import { createTask, updateTask } from "@repo/database/models/task-store";
import { user } from "@repo/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import { expectTopicsFire } from "@repo/database/testing";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
} from "@repo/features/automation-wire";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { eq } from "drizzle-orm";
import { Effect, Option, Result } from "effect";
import { memberIdOf } from "../accounts/workspace-members.js";
import { postInboxThread } from "../inbox/inbox-store.js";
import { openWorkspacePlugin } from "../testing/workspace-plugin.js";
import { workspaceInvitationsLive, workspaceMembersLive } from "./live-queries.js";

type WorkspacePlugin = Effect.Success<typeof openWorkspacePlugin>;

const WORKSPACE_READS = [workspaceMembersLive, workspaceInvitationsLive];

const openAccount = (name: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id, name, email: `${id}@app.test` });
    return id;
  });

const sessionOf = (plugin: WorkspacePlugin, userId: string) =>
  Effect.map(
    plugin.sessionBearerOf(userId),
    (bearer) => new Headers({ authorization: `Bearer ${bearer}` }),
  );

const openTeam = (plugin: WorkspacePlugin, ownerId: string) =>
  Effect.map(
    Effect.promise(() =>
      plugin.api.createOrganization({
        body: { name: "Acme", slug: `acme-${ownerId}`, userId: ownerId },
      }),
    ),
    (made) => made.id,
  );

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
        const started = yield* createAgent(teammate, {
          taskId: task.id,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: "acme/api",
          descriptionSnapshot: "# Invites\n",
          prompt: null,
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
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
          renameAgent(teammate, agentId, "Invite flow"),
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
            action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Fix one flaky test." },
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
