import { readEither } from "@sidecar/wire/effect";
import { Cause, Effect, Layer, Option, Result } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/unstable/http";
import type { SqlClient } from "effect/unstable/sql";
import { HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedMethod,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  readJsonBodyEffect,
} from "./hosted/http-effect.js";
import {
  WORKSPACE_MEMBERS_PATH,
  workspaceMemberRequestSchema,
} from "./hosted/workspace-members-wire.js";
import type { WorkspaceMemberSeams } from "./hosted/workspace-seams.js";
import { accountOfEmail, isPersonalWorkspace } from "./hosted/workspace-store.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * workspaces-members-app.ts -- the Workspaces page adds an existing Luke account to a workspace by its email.
 *
 * `POST /api/workspaces/members { organizationId, email, role }` rides on the
 * browser's Better Auth session, never the desktop's bearer: the page is the
 * one place members are managed. The caller must hold the plugin's
 * `member:create` permission in the workspace, which its default roles give
 * an owner and an admin; a workspace the caller is not in, or holds no such
 * right in, answers `not-found` alike, so the route says nothing of a
 * workspace to someone outside it. A personal workspace is refused, since it
 * is its account's alone. There are no invitations: the address must be one
 * an account already signs in with, and the plugin's server-only `addMember`
 * writes the row, refusing an account already a member in words of its own.
 */

/** An id, an address, and a role word; a body past this is not one. */
const MAXIMUM_MEMBER_BODY_BYTES = 1_024;

const HTTP_METHOD = { POST: "POST" } as const;

export type WorkspacesMembersAppSeams = WorkspaceMemberSeams;

/** An auth service that cannot answer is an outage the page may retry, not a signed-out caller. */
function authOrUnavailable<A>(
  effect: Effect.Effect<A, Cause.UnknownError | HostedRefusal>,
): Effect.Effect<A, HostedRefusal> {
  return Effect.catchIf(effect, Cause.isUnknownError, (failure) =>
    Effect.logError("web/workspacesMembers: the auth service failed", failure).pipe(
      Effect.andThen(Effect.fail(HOSTED_REFUSAL.UNAVAILABLE)),
    ),
  );
}

const addMemberEndpoint = /* @__PURE__ */ Effect.fn("web/addWorkspaceMember")(function* (
  seams: WorkspacesMembersAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | SqlClient.SqlClient
> {
  yield* hostedMethod(HTTP_METHOD.POST);
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const caller = yield* authOrUnavailable(seams.sessionAccount(request.headers));
  if (Option.isNone(caller)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const body = yield* readJsonBodyEffect(MAXIMUM_MEMBER_BODY_BYTES);
  const asked = readEither(workspaceMemberRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { organizationId, email, role } = asked.success;
  const permitted = yield* authOrUnavailable(seams.mayAddMembers(request.headers, organizationId));
  if (!permitted) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  if (yield* hostedStoreOrUnavailable(isPersonalWorkspace(organizationId))) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const account = yield* hostedStoreOrUnavailable(accountOfEmail(email));
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const added = yield* seams.addMember({ userId: account.value, organizationId, role }).pipe(
    Effect.catchTag("MemberRefused", () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)),
    authOrUnavailable,
  );
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { memberId: added.id });
});

/** The group: the one members path, and the hosted vocabulary's own refusal for any other. */
export function workspacesMembersApp(
  seams: WorkspacesMembersAppSeams,
): WebRoutes<SqlClient.SqlClient> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, WORKSPACE_MEMBERS_PATH, hostedRefusing(addMemberEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
