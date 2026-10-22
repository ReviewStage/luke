/**
 * workspace-access.ts -- a workspace as an account may act on it, and a write through the organization plugin answered as a refusal.
 *
 * Shared by the workspace procedures: the workspace as the account sees it,
 * one it manages as an owner or an admin, and a plugin call made under the
 * Mac's session, its failure read as the refusal the Mac draws.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import type { OrganizationRefused } from "@luke/database/models/workspace-seams";
import { type Workspace, workspaceOf } from "@luke/database/models/workspace-store";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { type Cause, Effect, Option } from "effect";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";

/** The plugin's codes for an address it will not invite because it already is, or already was. */
const ALREADY_INVITED_CODES: ReadonlySet<string> = new Set([
  "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION",
  "USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION",
]);

/** The roles that rename the workspace, set its photo, or invite people to it. */
const MANAGING_ROLES: ReadonlySet<string> = new Set([WORKSPACE_ROLE.OWNER, WORKSPACE_ROLE.ADMIN]);

/**
 * A plugin call under the session: its refusal of the session as
 * unauthenticated, an address already in or invited as such, any other
 * refusal as not permitted, since Luke's own rules already passed, and a
 * failure that is not a refusal as the outage the Mac may retry, logged by
 * its kind alone.
 */
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

/** The workspace as the account now sees it; one it is not in, or one that vanished between a write and this read, is not found. */
export const answeredWorkspace = Effect.fn("web/answeredWorkspace")(function* (
  userId: string,
  organizationId: string,
): Effect.fn.Return<Workspace, HostedRefusal, DatabaseServices> {
  const workspace = yield* hostedStoreOrUnavailable(workspaceOf(userId, organizationId));
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return workspace.value;
});

/** A workspace the account is an owner or an admin of; the one whose invitations it manages, that it renames, or whose photo it sets. */
export const managedWorkspace = Effect.fn("web/managedWorkspace")(function* (
  userId: string,
  organizationId: string,
): Effect.fn.Return<Workspace, HostedRefusal, DatabaseServices> {
  const workspace = yield* answeredWorkspace(userId, organizationId);
  if (!MANAGING_ROLES.has(workspace.role)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  return workspace;
});
