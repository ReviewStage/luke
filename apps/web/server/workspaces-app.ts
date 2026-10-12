import { Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/unstable/http";
import type { SqlClient } from "effect/unstable/sql";
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
import type { WorkspaceSeams } from "./hosted/workspace-seams.js";
import { ensurePersonalWorkspace, listWorkspaces } from "./hosted/workspace-store.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * workspaces-app.ts -- the workspaces the account is a member of, as the Mac reads them.
 *
 * `GET /api/workspaces` answers every workspace the bearer's account is a
 * member of, its personal one first and the rest by name, each marked
 * personal or not. The personal workspace is ensured before the list is
 * read, so the first read an account makes is the one that creates it,
 * through the organization plugin's own write the seams hand in. The
 * bearer is resolved before any row is touched, and the list is the
 * bearer's account's alone.
 */

const WORKSPACES_PATH = "/api/workspaces";

const HTTP_METHOD = { GET: "GET" } as const;

export interface WorkspacesAppSeams {
  resolveUserId: UserIdResolver;
  workspaces: WorkspaceSeams;
}

/**
 * The account's personal workspace ensured, a store failure answered as
 * `hostedStoreOrUnavailable` answers one and the plugin's refusal as the
 * same outage the Mac may retry, logged by its kind alone, since what the
 * plugin threw may quote what it was asked to write.
 */
function personalEnsuredOrUnavailable(
  userId: string,
  seams: WorkspaceSeams,
): Effect.Effect<void, HostedRefusal, SqlClient.SqlClient> {
  return Effect.catch(ensurePersonalWorkspace(userId, seams), (failure) =>
    failure._tag === "UnknownError"
      ? Effect.andThen(
          Effect.logWarning("Personal workspace not made: UnknownError"),
          Effect.fail(HOSTED_REFUSAL.UNAVAILABLE),
        )
      : hostedStoreOrUnavailable(Effect.fail(failure)),
  ).pipe(Effect.asVoid);
}

const workspacesEndpoint = /* @__PURE__ */ Effect.fn("web/workspacesEndpoint")(function* (
  seams: WorkspacesAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | SqlClient.SqlClient
> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const userId = account.value;
  yield* personalEnsuredOrUnavailable(userId, seams.workspaces);
  const workspaces = yield* hostedStoreOrUnavailable(listWorkspaces(userId));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { workspaces });
});

/** The group: the one workspaces path, and the hosted vocabulary's own refusal for any other. */
export function workspacesApp(seams: WorkspacesAppSeams): WebRoutes<SqlClient.SqlClient> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, WORKSPACES_PATH, hostedRefusing(workspacesEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
