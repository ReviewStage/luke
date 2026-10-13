import type { WorkspaceSeams } from "@sidecar/database/models/workspace-seams";
import {
  ensurePersonalWorkspace,
  listWorkspaces,
  type Workspace,
} from "@sidecar/database/models/workspace-store";
import { workspaceIdSchema } from "@sidecar/hosted/plan-wire";
import { WORKSPACE_MEMBERS_QUERY } from "@sidecar/hosted/workspace-wire";
import { readEither } from "@sidecar/wire/effect";
import { type Cause, Effect, Layer, Option, Result } from "effect";
import {
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/unstable/http";
import type { SqlClient } from "effect/unstable/sql";
import { unparsedWire } from "./core.js";
import type { GitHubApp } from "./github/github-app.js";
import {
  listAvailableWorkspaces,
  type SyncedInstallations,
  syncInstallations,
} from "./hosted/github-installations.js";
import { HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "./hosted/http-effect.js";
import type { StoreFailure } from "./hosted/store-failure.js";
import { listMembers, membershipOf } from "./hosted/workspace-members.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * workspaces-app.ts -- the workspaces the account is a member of, and the ones it may join, as the Mac reads them.
 *
 * `GET /api/workspaces` answers every workspace the bearer's account is a
 * member of, its personal one first and the rest by name, each with the
 * account's role in it, and the workspaces of the GitHub App installations
 * its GitHub reaches that it is not a member of, which it may join. Before
 * either is read, the personal workspace is ensured and the installations
 * synced (`hosted/github-installations.ts`), so a read is what makes the
 * account's personal workspace and the workspace of an installation nobody
 * reached before, both through the organization plugin's own write the
 * seams hand in. A GitHub the account cannot read right now, or none at
 * all, leaves the installations unsynced and nothing to join, and the
 * workspaces it already has are answered all the same. The bearer is
 * resolved before any row is touched, and both lists are the bearer's
 * account's alone.
 *
 * `GET /api/workspaces/members` answers a workspace's members to a member
 * of it. A workspace the account is not in is not found; a personal one,
 * whose members nobody manages, is not permitted.
 */

const WORKSPACES_PATH = {
  LIST: "/api/workspaces",
  MEMBERS: "/api/workspaces/members",
} as const;

const HTTP_METHOD = { GET: "GET" } as const;

/** No installation synced, so nothing to join. */
const NONE: SyncedInstallations = [];

export interface WorkspacesAppSeams {
  resolveUserId: UserIdResolver;
  workspaces: WorkspaceSeams;
}

/**
 * A write through the plugin, a store failure answered as
 * `hostedStoreOrUnavailable` answers one and the plugin's refusal as the
 * same outage the Mac may retry, logged by its kind alone, since what the
 * plugin threw may quote what it was asked to write.
 */
function pluginWriteOrUnavailable<A, R>(
  effect: Effect.Effect<A, StoreFailure | Cause.UnknownError, R>,
): Effect.Effect<A, HostedRefusal, R> {
  return Effect.catch(effect, (failure) =>
    failure._tag === "UnknownError"
      ? Effect.andThen(
          Effect.logWarning("Workspace not made: UnknownError"),
          Effect.fail(HOSTED_REFUSAL.UNAVAILABLE),
        )
      : hostedStoreOrUnavailable(Effect.fail(failure)),
  );
}

/** The installations synced, or none where GitHub could not be read, logged by the failure's kind alone. */
function installationsSyncedOrNone(
  userId: string,
  seams: WorkspaceSeams,
): Effect.Effect<
  SyncedInstallations,
  HostedRefusal,
  SqlClient.SqlClient | HttpClient.HttpClient | GitHubApp
> {
  return pluginWriteOrUnavailable(
    Effect.catch(syncInstallations(userId, seams), (failure) =>
      // Note that a GitHub read leaves the installations unsynced, and the store or the plugin refuses the request.
      failure._tag === "GitHubAppNotConfigured" ||
      failure._tag === "GitHubUnavailable" ||
      failure._tag === "GitHubSignInRequired"
        ? Effect.as(Effect.logWarning("Installations not synced", { failure: failure._tag }), NONE)
        : Effect.fail(failure),
    ),
  );
}

/** The bearer's account, for a request under the one method the endpoint takes; the web request beside it. */
const signedInAs = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: WorkspacesAppSeams,
  method: string,
): Effect.fn.Return<
  { readonly userId: string; readonly request: Request },
  HostedRefusal,
  HttpServerRequest.HttpServerRequest
> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== method) return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  return { userId: account.value, request };
});

/**
 * The workspace as the account sees it, where it is a member of it and it is
 * one whose members are managed: one it is not in is not found, and a
 * personal one is not permitted.
 */
const managedWorkspace = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  organizationId: string,
): Effect.fn.Return<Workspace, HostedRefusal, SqlClient.SqlClient> {
  const standing = yield* hostedStoreOrUnavailable(membershipOf(userId, organizationId));
  if (Option.isNone(standing)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  if (standing.value.personal) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  return standing.value;
});

const workspacesEndpoint = /* @__PURE__ */ Effect.fn("web/workspacesEndpoint")(function* (
  seams: WorkspacesAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | SqlClient.SqlClient | HttpClient.HttpClient | GitHubApp
> {
  const { userId } = yield* signedInAs(seams, HTTP_METHOD.GET);
  yield* pluginWriteOrUnavailable(ensurePersonalWorkspace(userId, seams.workspaces));
  const synced = yield* installationsSyncedOrNone(userId, seams.workspaces);
  const workspaces = yield* hostedStoreOrUnavailable(listWorkspaces(userId));
  const available = yield* hostedStoreOrUnavailable(listAvailableWorkspaces(userId, synced));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { workspaces, available });
});

/** GET: a workspace's members, to a member of it. */
const membersEndpoint = /* @__PURE__ */ Effect.fn("web/workspaceMembersEndpoint")(function* (
  seams: WorkspacesAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | SqlClient.SqlClient
> {
  const { userId, request } = yield* signedInAs(seams, HTTP_METHOD.GET);
  const named = new URL(request.url).searchParams.getAll(WORKSPACE_MEMBERS_QUERY.WORKSPACE_ID);
  const read = readEither(workspaceIdSchema)(unparsedWire(named[0]));
  if (named.length !== 1 || Result.isFailure(read)) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  yield* managedWorkspace(userId, read.success);
  const members = yield* hostedStoreOrUnavailable(listMembers(read.success));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { members });
});

/** The group: the workspaces paths, and the hosted vocabulary's own refusal for any other. */
export function workspacesApp(
  seams: WorkspacesAppSeams,
): WebRoutes<SqlClient.SqlClient | HttpClient.HttpClient | GitHubApp> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, WORKSPACES_PATH.LIST, hostedRefusing(workspacesEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, WORKSPACES_PATH.MEMBERS, hostedRefusing(membersEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
