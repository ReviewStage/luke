import type { DatabaseServices } from "@repo/database/core/query";
import type { OrganizationRefused } from "@repo/database/models/workspace-seams";
import { type Workspace, workspaceOf } from "@repo/database/models/workspace-store";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { type Cause, Effect, Option } from "effect";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";

const ALREADY_INVITED_CODES: ReadonlySet<string> = new Set([
  "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION",
  "USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION",
]);

const MANAGING_ROLES: ReadonlySet<string> = new Set([WORKSPACE_ROLE.OWNER, WORKSPACE_ROLE.ADMIN]);

export function pluginCallOrRefused<A, R>(
  write: Effect.Effect<A, OrganizationRefused | Cause.UnknownError, R>,
): Effect.Effect<A, HostedRefusal, R> {
  return Effect.catch(write, (failure): Effect.Effect<never, HostedRefusal> => {
    if (failure._tag === "UnknownError") {
      return Effect.andThen(
        Effect.logWarning("Member write failed: UnknownError"),
        Effect.fail(HOSTED_REFUSAL.UNAVAILABLE),
      );
    }
    if (failure.status === HOSTED_HTTP_STATUS.UNAUTHORIZED) {
      return Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    }
    return Effect.fail(
      failure.code !== undefined && ALREADY_INVITED_CODES.has(failure.code)
        ? HOSTED_REFUSAL.ALREADY_INVITED
        : HOSTED_REFUSAL.NOT_PERMITTED,
    );
  });
}

export const answeredWorkspace = Effect.fn("web/answeredWorkspace")(function* (
  userId: string,
  organizationId: string,
): Effect.fn.Return<Workspace, HostedRefusal, DatabaseServices> {
  const workspace = yield* hostedStoreOrUnavailable(workspaceOf(userId, organizationId));
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return workspace.value;
});

export const managedWorkspace = Effect.fn("web/managedWorkspace")(function* (
  userId: string,
  organizationId: string,
): Effect.fn.Return<Workspace, HostedRefusal, DatabaseServices> {
  const workspace = yield* answeredWorkspace(userId, organizationId);
  if (!MANAGING_ROLES.has(workspace.role)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  return workspace;
});
