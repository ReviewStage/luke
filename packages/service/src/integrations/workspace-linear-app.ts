/**
 * workspace-linear-app.ts -- a workspace's one Linear connection begun, settled, and ended, and the issues it reaches read.
 *
 * Three endpoints the signed-in desktop calls with its bearer, and one
 * browser navigation that carries none:
 *
 * - `POST /api/workspaces/linear/connect` takes an owner or admin of the
 *   workspace, asks Vercel Connect to begin a browser sign-in to Linear
 *   under the workspace's own id as the grant's subject, on the workspace
 *   Linear connector (`WorkspaceLinearConnect`), records the
 *   sign-in's one-time state on the workspace's row, and answers the address
 *   the desktop opens. The grant is the workspace's: every member reads
 *   every issue it reaches, a private team's among them, which the desktop
 *   says before the admin goes on.
 * - `GET /api/workspaces/linear/connected` is where Connect returns the
 *   browser: the state names the workspace, Connect is asked for a token
 *   afresh, and the browser is sent on to the integrations landing page with
 *   Linear and one word, as the account sign-ins' callback does.
 * - `POST /api/workspaces/linear/disconnect` takes an owner or admin, deletes
 *   the workspace's row before anything else, which stops every read
 *   through the grant, then asks Connect to revoke it; it answers the
 *   workspace. What plans already kept of an issue stays with them.
 * - `POST /api/workspaces/linear/issues` takes any member, and answers the
 *   issues the grant reaches, the open ones assigned to the member's own
 *   email first, then newest changed first; or those a search matches; or
 *   the one an identifier names (`linear-issues.ts`).
 *
 * A workspace the account is not in is not found, whatever it asked.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { type Workspace, workspaceOf } from "@luke/database/models/workspace-store";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import {
  INTEGRATION_LANDING_STATUS,
  INTEGRATION_PROVIDER,
  type IntegrationLandingStatus,
  integrationLandingPath,
} from "@luke/features/integration-wire";
import { managesWorkspace } from "@luke/features/workspace-role";
import {
  linearIssuesRequestSchema,
  workspaceLinearRequestSchema,
} from "@luke/features/workspace-wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Option, Result, type Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import type * as HttpClient from "effect/http/HttpClient";
import { listMembers } from "../accounts/workspace-members.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  readJsonBodyEffect,
  type UserIdResolver,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import {
  accountIntegrationConnect,
  INTEGRATION_CONNECT_FAILURE,
  type IntegrationConnect,
  WorkspaceLinearConnect,
} from "./integration-connect.js";
import {
  linearIssueByIdentifier,
  linearOrRefused,
  listLinearIssues,
  throughWorkspaceLinear,
} from "./linear-issues.js";
import {
  beginWorkspaceIntegrationSignIn,
  completeWorkspaceIntegrationSignIn,
  deleteWorkspaceIntegration,
  endWorkspaceIntegrationSignIn,
  readWorkspaceIntegrationSignIn,
} from "./workspace-integration-store.js";

/** How long a sign-in may stay under way before its state no longer settles it, as the account sign-ins allow. */
const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;

/** The most a request body may hold: a workspace id and a search. */
const MAXIMUM_BODY_BYTES = 2_048;

/** The query Connect returns the browser with, which is the one Luke put on the callback. */
const STATE_QUERY = "state";

/** A sign-in's state as one is minted: 32 random bytes, url-safe. */
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const HTTP_METHOD = { GET: "GET", POST: "POST" } as const;

/** A browser is sent on with 303, so whatever Connect sends becomes the GET the page is. */
const SEE_OTHER = 303;

const LINEAR = INTEGRATION_PROVIDER.LINEAR;

export interface WorkspaceLinearAppSeams {
  readonly resolveUserId: UserIdResolver;
  /** A fresh sign-in state; random in production, fixed in a test. */
  readonly mintState: () => string;
  /** Now, in milliseconds since the epoch. */
  readonly now: () => number;
}

type Requirements =
  | HttpServerRequest.HttpServerRequest
  | DatabaseServices
  | IntegrationConnect
  | WorkspaceLinearConnect
  | HttpClient.HttpClient;

/** The bearer resolved against the deployment's own account store, or the invalid-token refusal. */
const accountOf = Effect.fn("web/workspaceLinearAccount")(function* (
  seams: WorkspaceLinearAppSeams,
) {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  return account.value;
});

/** The method asked, or the refusal of any other. */
const onlyMethod = Effect.fn("web/workspaceLinearMethod")(function* (method: string) {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== method) return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
});

/** The body read as the schema says, or the invalid-request refusal. */
const bodyAs = <A>(schema: Schema.Codec<A, unknown>) =>
  Effect.flatMap(readJsonBodyEffect(MAXIMUM_BODY_BYTES), (body) =>
    Result.match(readEither(schema)(body), {
      onFailure: () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST),
      onSuccess: Effect.succeed,
    }),
  );

/** The workspace named, as the account sees it; one it is not in is not found. */
const memberWorkspace = Effect.fn("web/workspaceLinearWorkspace")(function* (
  userId: string,
  workspaceId: string,
): Effect.fn.Return<Workspace, HostedRefusal, DatabaseServices> {
  const workspace = yield* hostedStoreOrUnavailable(workspaceOf(userId, workspaceId));
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return workspace.value;
});

/** The email of the member's Luke account, which their own Linear issues are matched by. */
const memberEmailOf = Effect.fn("web/workspaceLinearMemberEmail")(function* (
  userId: string,
  workspaceId: string,
): Effect.fn.Return<string | undefined, HostedRefusal, DatabaseServices> {
  const members = yield* hostedStoreOrUnavailable(listMembers(workspaceId));
  return members.find((each) => each.userId === userId)?.email;
});

/** The workspace named, where the account is an owner or admin of it. */
const administeredWorkspace = Effect.fn("web/workspaceLinearAdministered")(function* (
  userId: string,
) {
  const asked = yield* bodyAs(workspaceLinearRequestSchema);
  const workspace = yield* memberWorkspace(userId, asked.workspaceId);
  if (!managesWorkspace(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  return workspace;
});

/** The callback Connect returns the browser to, on the host the desktop asked through. */
function callbackUrl(requestUrl: string, state: string): string {
  const url = new URL(HOSTED_SERVICE_PATH.WORKSPACE_LINEAR_CONNECTED, requestUrl);
  url.searchParams.set(STATE_QUERY, state);
  return url.toString();
}

/**
 * POST: begins the workspace's Linear sign-in, on the workspace Linear
 * connector. Linear must be offered to the admin's own account here
 * (`accountIntegrationConnect`), so a deployment that keeps Linear to some
 * accounts keeps its workspaces to them too. Connect is asked first, so a
 * sign-in it refused leaves the row as it stood.
 */
const connectEndpoint = Effect.fn("web/workspaceLinearConnectEndpoint")(function* (
  seams: WorkspaceLinearAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  yield* onlyMethod(HTTP_METHOD.POST);
  const userId = yield* accountOf(seams);
  const workspace = yield* administeredWorkspace(userId);
  const offered = (yield* hostedStoreOrUnavailable(accountIntegrationConnect(userId)))[LINEAR];
  const connector = yield* WorkspaceLinearConnect;
  if (!offered.configured || !connector.configured) {
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const state = seams.mintState();
  const { url, verifier } = yield* connector
    .authorize(workspace.id, callbackUrl(request.url, state))
    .pipe(
      Effect.tapError((failure) =>
        Effect.logWarning(
          "Vercel Connect could not begin a workspace Linear sign-in",
          failure.message,
        ),
      ),
      Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
    );
  yield* hostedStoreOrUnavailable(
    beginWorkspaceIntegrationSignIn(workspace.id, LINEAR, userId, state, verifier),
  );
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { url });
});

/** How the sign-in the browser returned from settled. */
const callbackLanding = Effect.fn("web/workspaceLinearCallbackLanding")(function* (
  seams: WorkspaceLinearAppSeams,
  state: string | null,
): Effect.fn.Return<
  IntegrationLandingStatus,
  HostedRefusal,
  DatabaseServices | WorkspaceLinearConnect
> {
  if (state === null || !STATE_PATTERN.test(state)) return INTEGRATION_LANDING_STATUS.EXPIRED;
  const row = yield* hostedStoreOrUnavailable(readWorkspaceIntegrationSignIn(state));
  if (row === undefined) return INTEGRATION_LANDING_STATUS.EXPIRED;
  const issuedAt = row.stateIssuedAt?.getTime();
  if (issuedAt === undefined || seams.now() - issuedAt > SIGN_IN_WINDOW_MS) {
    return INTEGRATION_LANDING_STATUS.EXPIRED;
  }
  const connector = yield* WorkspaceLinearConnect;
  if (!connector.configured) return INTEGRATION_LANDING_STATUS.UNAVAILABLE;
  const issued = yield* Effect.result(connector.token(row.organizationId, { fresh: true }));
  if (Result.isFailure(issued)) {
    if (issued.failure.reason === INTEGRATION_CONNECT_FAILURE.NOT_AUTHORIZED) {
      // Back without a grant: the sign-in is over.
      yield* hostedStoreOrUnavailable(
        endWorkspaceIntegrationSignIn(row.organizationId, LINEAR, state),
      );
      return INTEGRATION_LANDING_STATUS.NOT_COMPLETED;
    }
    yield* Effect.logWarning(
      "Vercel Connect could not settle a workspace Linear sign-in",
      issued.failure.message,
    );
    return INTEGRATION_LANDING_STATUS.UNAVAILABLE;
  }
  const completed = yield* hostedStoreOrUnavailable(
    completeWorkspaceIntegrationSignIn(row.organizationId, LINEAR, state),
  );
  // A Disconnect pressed while the browser was away, or a sign-in begun again, wins.
  return completed
    ? INTEGRATION_LANDING_STATUS.CONNECTED
    : INTEGRATION_LANDING_STATUS.NOT_COMPLETED;
});

/** GET: Connect's return. Whatever it brought, the browser lands on the page with a word. */
const connectedEndpoint = Effect.fn("web/workspaceLinearConnectedEndpoint")(function* (
  seams: WorkspaceLinearAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest | DatabaseServices | WorkspaceLinearConnect
> {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const query = new URL(request.url, "https://localhost").searchParams;
  const status = yield* callbackLanding(seams, query.get(STATE_QUERY)).pipe(
    Effect.catch(() => Effect.succeed(INTEGRATION_LANDING_STATUS.UNAVAILABLE)),
  );
  return HttpServerResponse.redirect(integrationLandingPath(LINEAR, status), {
    status: SEE_OTHER,
  });
});

/**
 * POST: ends the workspace's Linear. The row goes first, so whatever
 * Connect answers, nobody reads through the grant again; a failed revoke is
 * logged rather than answered.
 */
const disconnectEndpoint = Effect.fn("web/workspaceLinearDisconnectEndpoint")(function* (
  seams: WorkspaceLinearAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  yield* onlyMethod(HTTP_METHOD.POST);
  const userId = yield* accountOf(seams);
  const workspace = yield* administeredWorkspace(userId);
  yield* hostedStoreOrUnavailable(deleteWorkspaceIntegration(workspace.id, LINEAR));
  const connector = yield* WorkspaceLinearConnect;
  if (connector.configured) {
    yield* connector
      .revoke(workspace.id)
      .pipe(
        Effect.catch((failure) =>
          Effect.logWarning(
            "Vercel Connect could not revoke a workspace Linear grant",
            failure.message,
          ),
        ),
      );
  }
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    workspace: yield* memberWorkspace(userId, workspace.id),
  });
});

/**
 * POST: the issues the workspace's grant reaches, the member's own open ones
 * first where nothing is searched, or the one an identifier names, to any
 * member of it.
 */
const issuesEndpoint = Effect.fn("web/workspaceLinearIssuesEndpoint")(function* (
  seams: WorkspaceLinearAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  yield* onlyMethod(HTTP_METHOD.POST);
  const userId = yield* accountOf(seams);
  const asked = yield* bodyAs(linearIssuesRequestSchema);
  const workspace = yield* memberWorkspace(userId, asked.workspaceId);
  const { identifier, query } = asked;
  const searched = identifier !== undefined || (query?.trim() ?? "") !== "";
  const email = searched ? undefined : yield* memberEmailOf(userId, workspace.id);
  const issues = yield* linearOrRefused(
    throughWorkspaceLinear(workspace.id, (token) =>
      identifier === undefined
        ? listLinearIssues(token, query, email)
        : linearIssueByIdentifier(token, identifier),
    ),
    "Linear listed no issues",
  );
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { issues });
});

/** The group: the four paths, and the hosted vocabulary's own refusal for any other. */
export function workspaceLinearApp(
  seams: WorkspaceLinearAppSeams,
): WebRoutes<
  DatabaseServices | IntegrationConnect | WorkspaceLinearConnect | HttpClient.HttpClient
> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.WORKSPACE_LINEAR_CONNECT,
      hostedRefusing(connectEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.WORKSPACE_LINEAR_CONNECTED,
      connectedEndpoint(seams),
    ),
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.WORKSPACE_LINEAR_DISCONNECT,
      hostedRefusing(disconnectEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.WORKSPACE_LINEAR_ISSUES,
      hostedRefusing(issuesEndpoint(seams)),
    ),
    hostedNotFoundRoute,
  );
}
