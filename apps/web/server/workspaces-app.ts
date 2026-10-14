import type { DatabaseServices } from "@sidecar/database/core/query";
import type { WorkspaceSeams } from "@sidecar/database/models/workspace-seams";
import {
  createWorkspace,
  ensurePersonalWorkspace,
  listWorkspaces,
  type Workspace,
  workspaceOf,
} from "@sidecar/database/models/workspace-store";
import { workspaceIdSchema } from "@sidecar/hosted/plan-wire";
import {
  WORKSPACE_MEMBERS_QUERY,
  workspaceCreateRequestSchema,
  workspaceGithubRequestSchema,
} from "@sidecar/hosted/workspace-wire";
import { readEither } from "@sidecar/wire/effect";
import { type Cause, Effect, Layer, Option, Result } from "effect";
import {
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/http";
import { unparsedWire } from "./core.js";
import { GitHubApp } from "./github/github-app.js";
import { logGitHubReadFailure } from "./github/github-refusal.js";
import {
  createConnectIntent,
  disconnectInstallation,
  GITHUB_CONNECT_ROLES,
} from "./hosted/github-installations.js";
import { HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  readJsonBodyEffect,
  type UserIdResolver,
} from "./hosted/http-effect.js";
import type { StoreFailure } from "./hosted/store-failure.js";
import { listMembers } from "./hosted/workspace-members.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * workspaces-app.ts -- the account's workspaces as the Mac reads and asks for them: the list, a workspace created, and a GitHub organization connected or disconnected.
 *
 * `GET /api/workspaces` answers every workspace the bearer's account is a
 * member of, its personal one first and the rest by name, each with the
 * account's role and its connected GitHub account; the personal workspace is
 * ensured first, so an account's first read makes it. `POST` creates a
 * workspace with the name given through the organization plugin's
 * server-only create, the account its owner. `POST /api/workspaces/github/connect`
 * answers where the browser goes to connect a GitHub organization: the
 * Luke GitHub App's install address with a single-use intent as its `state`,
 * which the Setup URL spends (`github-install-app.ts`); and
 * `.../disconnect` removes the workspace's connected installation; both take
 * an owner or admin of the workspace, and a workspace the account is not in
 * answers as none does. A personal workspace is never connected, since it
 * takes every repository the account reaches, so its connect is not
 * permitted. `GET /api/workspaces/members` answers a workspace's
 * members to a member of it; a personal one, whose members nobody manages,
 * is not permitted. The bearer is resolved before any row is touched.
 */

const WORKSPACES_PATH = "/api/workspaces";
const GITHUB_CONNECT_PATH = "/api/workspaces/github/connect";
const GITHUB_DISCONNECT_PATH = "/api/workspaces/github/disconnect";
const MEMBERS_PATH = "/api/workspaces/members";

const HTTP_METHOD = { GET: "GET", POST: "POST" } as const;

/** The query GitHub carries back to the Setup URL, which is the connect intent's state. */
const INSTALL_STATE_PARAM = "state";

/** A workspace's name or id is a few dozen characters, so a body past this is not one. */
const MAXIMUM_BODY_BYTES = 1_024;

export interface WorkspacesAppSeams {
  resolveUserId: UserIdResolver;
  workspaces: WorkspaceSeams;
}

type Requirements =
  | HttpServerRequest.HttpServerRequest
  | DatabaseServices
  | HttpClient.HttpClient
  | GitHubApp;

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

/** The bearer's account, or the request refused as unauthenticated. */
const accountOf = Effect.fn("web/workspacesAccount")(function* (seams: WorkspacesAppSeams) {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  return account.value;
});

/** The workspace the body names, where the account is an owner or admin of it; one it is not in is not found. */
const administeredWorkspace = Effect.fn("web/administeredWorkspace")(function* (userId: string) {
  const body = yield* readJsonBodyEffect(MAXIMUM_BODY_BYTES);
  const asked = readEither(workspaceGithubRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const workspace = yield* hostedStoreOrUnavailable(workspaceOf(userId, asked.success.workspaceId));
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  if (!GITHUB_CONNECT_ROLES.has(workspace.value.role)) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  }
  return workspace.value;
});

/** GET: the account's workspaces; POST: one created. */
const workspacesEndpoint = Effect.fn("web/workspacesEndpoint")(function* (
  seams: WorkspacesAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET && incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const userId = yield* accountOf(seams);
  yield* pluginWriteOrUnavailable(ensurePersonalWorkspace(userId, seams.workspaces));
  if (incoming.method === HTTP_METHOD.GET) {
    const workspaces = yield* hostedStoreOrUnavailable(listWorkspaces(userId));
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { workspaces });
  }
  const body = yield* readJsonBodyEffect(MAXIMUM_BODY_BYTES);
  const asked = readEither(workspaceCreateRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const organizationId = yield* pluginWriteOrUnavailable(
    createWorkspace(userId, asked.success.name, seams.workspaces),
  );
  const workspace = yield* answeredWorkspace(userId, organizationId);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.CREATED, { workspace });
});

/** The workspace as the account now sees it; one that vanished between the write and this read is not found. */
const answeredWorkspace = Effect.fn("web/answeredWorkspace")(function* (
  userId: string,
  organizationId: string,
): Effect.fn.Return<Workspace, HostedRefusal, DatabaseServices> {
  const workspace = yield* hostedStoreOrUnavailable(workspaceOf(userId, organizationId));
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return workspace.value;
});

/** POST: where the browser goes to connect a GitHub organization to the workspace; a personal one is not permitted. */
const connectEndpoint = Effect.fn("web/workspaceGithubConnectEndpoint")(function* (
  seams: WorkspacesAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const userId = yield* accountOf(seams);
  const workspace = yield* administeredWorkspace(userId);
  // Note that a personal workspace is refused, because it takes every repository the account reaches.
  if (workspace.personal) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  const app = yield* GitHubApp;
  const installUrl = yield* app.installUrl.pipe(
    Effect.catch((failure) =>
      Effect.andThen(logGitHubReadFailure(failure), Effect.fail(HOSTED_REFUSAL.UNAVAILABLE)),
    ),
  );
  const state = yield* hostedStoreOrUnavailable(createConnectIntent(userId, workspace.id));
  const url = new URL(installUrl);
  url.searchParams.set(INSTALL_STATE_PARAM, state);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { url: url.toString() });
});

/** POST: the workspace's connected installation removed, answering the workspace. */
const disconnectEndpoint = Effect.fn("web/workspaceGithubDisconnectEndpoint")(function* (
  seams: WorkspacesAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const userId = yield* accountOf(seams);
  const workspace = yield* administeredWorkspace(userId);
  yield* hostedStoreOrUnavailable(disconnectInstallation(workspace.id));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    workspace: yield* answeredWorkspace(userId, workspace.id),
  });
});

/** GET: a workspace's members, to a member of it; a personal one is not permitted. */
const membersEndpoint = Effect.fn("web/workspaceMembersEndpoint")(function* (
  seams: WorkspacesAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const userId = yield* accountOf(seams);
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const named = new URL(request.url).searchParams.getAll(WORKSPACE_MEMBERS_QUERY.WORKSPACE_ID);
  const asked = readEither(workspaceIdSchema)(unparsedWire(named[0]));
  if (named.length !== 1 || Result.isFailure(asked)) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const workspace = yield* answeredWorkspace(userId, asked.success);
  if (workspace.personal) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  const members = yield* hostedStoreOrUnavailable(listMembers(workspace.id));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { members });
});

/** The group: the workspaces path, the two GitHub paths, the members path, and the hosted vocabulary's own refusal for any other. */
export function workspacesApp(
  seams: WorkspacesAppSeams,
): WebRoutes<DatabaseServices | HttpClient.HttpClient | GitHubApp> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, WORKSPACES_PATH, hostedRefusing(workspacesEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, GITHUB_CONNECT_PATH, hostedRefusing(connectEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, GITHUB_DISCONNECT_PATH, hostedRefusing(disconnectEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, MEMBERS_PATH, hostedRefusing(membersEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
