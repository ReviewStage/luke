/**
 * workspace-environment-procedures.ts -- a workspace's shared environment variables: list their names to a member, and put or delete one as an owner or admin.
 *
 * Every procedure resolves the caller (`accountMiddleware`, on the
 * resource so it runs before an input is read) and the workspace as the
 * caller is a member of it, a workspace it is not in answered as not found;
 * a put or a delete by a member who is no owner or admin is not permitted.
 * A put seals the value under the deployment's ring
 * (`keyRingMiddleware`, so a deployment holding none answers it
 * unavailable) the moment it is read, and nothing logs it. Every answer is
 * the workspace's variable names as they then stand, never a value.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { sealWorkspaceVariable } from "@repo/database/models/provider-key-seal";
import {
  listWorkspaceVariables,
  removeWorkspaceVariable,
  setWorkspaceVariable,
} from "@repo/database/models/workspace-environment-store";
import { type Workspace, workspaceOf } from "@repo/database/models/workspace-store";
import type { WorkspaceEnvironmentAnswer } from "@repo/features/workspace-environment-wire";
import { managesWorkspace } from "@repo/features/workspace-role";
import { DateTime, Effect, Option, Redacted } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted, keyRingMiddleware } from "../orpc/base.js";

export interface WorkspaceEnvironmentProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The workspace named, as the account sees it; one it is not in is not found. */
const memberWorkspace = Effect.fn("web/workspaceEnvironmentWorkspace")(function* (
  userId: string,
  workspaceId: string,
): Effect.fn.Return<Workspace, HostedRefusal, DatabaseServices> {
  const workspace = yield* hostedStoreOrUnavailable(workspaceOf(userId, workspaceId));
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return workspace.value;
});

/** The workspace named, where the account is an owner or admin of it. */
const administeredWorkspace = Effect.fn("web/workspaceEnvironmentAdministered")(function* (
  userId: string,
  workspaceId: string,
) {
  const workspace = yield* memberWorkspace(userId, workspaceId);
  if (!managesWorkspace(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  return workspace;
});

/** The workspace's variable names as they stand, for the wire. */
const environmentAnswer = Effect.fn("web/workspaceEnvironmentAnswer")(function* (
  workspaceId: string,
): Effect.fn.Return<WorkspaceEnvironmentAnswer, HostedRefusal, DatabaseServices> {
  const listed = yield* hostedStoreOrUnavailable(listWorkspaceVariables(workspaceId));
  return {
    variables: listed.map((row) => ({ name: row.name, updatedAt: row.updatedAt.getTime() })),
  };
});

/** The workspace environment resource: every procedure to a signed-in caller, the put on a deployment that holds a ring. */
export function workspaceEnvironmentProcedures(seams: WorkspaceEnvironmentProcedureSeams) {
  const signedIn = hosted.workspaceEnvironment.use(accountMiddleware(seams.resolveUserId));
  const keyed = signedIn.use(keyRingMiddleware);
  return {
    list: signedIn.list.effect(function* ({ input, context: { userId } }) {
      const workspace = yield* memberWorkspace(userId, input.workspaceId);
      return yield* environmentAnswer(workspace.id);
    }),

    put: keyed.put.effect(function* ({ input, context: { userId, ring } }) {
      const workspace = yield* administeredWorkspace(userId, input.workspaceId);
      const owner = { organizationId: workspace.id, name: input.name };
      const sealed = sealWorkspaceVariable(ring, owner, Redacted.make(input.value));
      const now = yield* DateTime.nowAsDate;
      yield* hostedStoreOrUnavailable(setWorkspaceVariable(workspace.id, input.name, sealed, now));
      return yield* environmentAnswer(workspace.id);
    }),

    delete: signedIn.delete.effect(function* ({ input, context: { userId } }) {
      const workspace = yield* administeredWorkspace(userId, input.workspaceId);
      yield* hostedStoreOrUnavailable(removeWorkspaceVariable(workspace.id, input.name));
      return yield* environmentAnswer(workspace.id);
    }),
  };
}
