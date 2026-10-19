/**
 * workspace-linear-app.ts -- where Vercel Connect returns the browser from a workspace's Linear sign-in.
 *
 * `GET /api/workspaces/linear/connected` is a browser navigation that
 * carries no bearer: the state names the workspace, Connect is asked for a
 * token afresh, and the browser is sent on to the integrations landing page
 * with Linear and one word, as the account sign-ins' callback does. The
 * sign-in it settles is begun, and the connection ended and read, by the
 * hosted procedures (`workspace-linear-procedures.ts`).
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import {
  INTEGRATION_LANDING_STATUS,
  INTEGRATION_PROVIDER,
  type IntegrationLandingStatus,
  integrationLandingPath,
} from "@luke/features/integration-wire";
import { Effect, Layer, Result } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import {
  type HostedRefusal,
  hostedNotFoundRoute,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { INTEGRATION_CONNECT_FAILURE, WorkspaceLinearConnect } from "./integration-connect.js";
import {
  completeWorkspaceIntegrationSignIn,
  endWorkspaceIntegrationSignIn,
  readWorkspaceIntegrationSignIn,
} from "./workspace-integration-store.js";

/** How long a sign-in may stay under way before its state no longer settles it, as the account sign-ins allow. */
const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;

/** The query Connect returns the browser with, which is the one Luke put on the callback. */
const STATE_QUERY = "state";

/** A sign-in's state as one is minted: 32 random bytes, url-safe. */
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A browser is sent on with 303, so whatever Connect sends becomes the GET the page is. */
const SEE_OTHER = 303;

const LINEAR = INTEGRATION_PROVIDER.LINEAR;

export interface WorkspaceLinearAppSeams {
  /** Now, in milliseconds since the epoch. */
  readonly now: () => number;
}

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

/** The group: the callback's path, and the hosted vocabulary's own refusal for any other. */
export function workspaceLinearApp(
  seams: WorkspaceLinearAppSeams,
): WebRoutes<DatabaseServices | WorkspaceLinearConnect> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.WORKSPACE_LINEAR_CONNECTED,
      connectedEndpoint(seams),
    ),
    hostedNotFoundRoute,
  );
}
