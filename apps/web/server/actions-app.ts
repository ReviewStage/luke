import { Effect, Layer, type Redacted } from "effect";
import {
  type HttpMethod,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import type { SqlClient } from "effect/unstable/sql";
import {
  type HostedActionEffect,
  handleAgentAction,
  handleControlAction,
  handleMessageAction,
  handleRenameSessionAction,
  handleRenameWorkspaceAction,
  handleWorkspaceAction,
} from "./hosted/action-session.js";
import { HostedEnvironment } from "./hosted/environment.js";
import { hostedNotFoundRoute } from "./hosted/http-effect.js";
import { type HostedVaultRoute, hostedVaultSeams } from "./hosted/vault-route.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * The actions surface as one route group: the six endpoints through which the
 * phone and desktop ask the hosted tier to act on an observed cloud session,
 * or create one, on the developer's behalf (root AGENTS.md "Acts on a
 * session"). Each endpoint is already the whole of admission, the roster
 * read, and dispatch, so the group only carries the request across the
 * `HttpApi` boundary and back; nothing about the admission gauntlet, the
 * roster, or the refusal vocabulary in `server/hosted/action-session.ts`
 * changes here. The handlers are effects, so the group hands each of them
 * the deployment's seams on its own fiber rather than through a `Route`
 * whose promise a runtime would have to be read to settle.
 */

const ACTIONS_ROUTE_PATH = {
  MESSAGE: "/api/actions/message",
  CONTROL: "/api/actions/control",
  AGENT: "/api/actions/agent",
  RENAME_SESSION: "/api/actions/rename-session",
  RENAME_WORKSPACE: "/api/actions/rename-workspace",
  WORKSPACE: "/api/actions/workspace",
} as const;

/**
 * The method the web handler answers with no body, taking the status and the
 * headers from the `HttpServerResponse` rather than from the answer beneath
 * it, exactly as `server/auth-app.ts`'s passthrough does.
 */
const BODYLESS_METHOD = { HEAD: "HEAD" } as const satisfies Record<string, HttpMethod.HttpMethod>;

/** One action endpoint's handler, the shape every `handle*Action` export already has. */
export type HostedActionHandler = (route: HostedVaultRoute) => HostedActionEffect<Response>;

/** What this group answers against: the connection its handlers read on, and the deployment's own environment. */
type ActionsServices = HostedEnvironment | SqlClient.SqlClient;

export interface ActionsGroupHandlers {
  message: HostedActionHandler;
  control: HostedActionHandler;
  agent: HostedActionHandler;
  renameSession: HostedActionHandler;
  renameWorkspace: HostedActionHandler;
  workspace: HostedActionHandler;
}

/**
 * A HEAD answer's status and headers, carried on the `HttpServerResponse`
 * because `HttpApp`'s web handler builds a HEAD response from those alone
 * rather than from the raw `Response` underneath — the same reason
 * `server/auth-app.ts`'s passthrough carries a HEAD answer this way.
 */
function bodylessAnswer(answer: Response): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.empty({
    status: answer.status,
    statusText: answer.statusText,
    headers: [...answer.headers],
  });
}

/**
 * The provider key vault's own secret, as the handler's seams take it: read
 * from the deployment's environment on the group's own fiber, so nothing
 * below runs a runtime to get at it. Its absence is the vault's kill switch,
 * and the handler answers the 503 for it, the same as when
 * `hostedVaultRoute` read it.
 */
const actionEncryptionSecret: Effect.Effect<
  Redacted.Redacted | undefined,
  never,
  HostedEnvironment
> = Effect.map(HostedEnvironment, (environment) => environment.providerKeyEncryptionSecret);

/**
 * Carries the handler's own `Response` back unchanged: the request handed to
 * the handler is the very `Request` this edge was invoked with, and nothing
 * is read out of the answer to mirror onto the `HttpServerResponse` beside
 * it, aside from the HEAD exception above. The handler is an effect, so it
 * runs on this group's fiber and reads the connection the edge already
 * opened; a failed statement is a defect here, as a rejected promise was.
 */
const actionPassthrough = /* @__PURE__ */ Effect.fn("web/actionPassthrough")(function* (
  handle: HostedActionHandler,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  never,
  ActionsServices | HttpServerRequest.HttpServerRequest
> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const encryptionSecret = yield* actionEncryptionSecret;
  const answer = yield* Effect.orDie(handle({ ...hostedVaultSeams, encryptionSecret, request }));
  return incoming.method === BODYLESS_METHOD.HEAD
    ? bodylessAnswer(answer)
    : HttpServerResponse.raw(answer);
});

/**
 * The group, built from the handlers named. A path outside the six answers
 * the hosted vocabulary's own `not-found`, since nothing routes another path
 * to one of these functions.
 */
export function buildActionsApp(handlers: ActionsGroupHandlers): WebRoutes<ActionsServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, ACTIONS_ROUTE_PATH.MESSAGE, actionPassthrough(handlers.message)),
    HttpRouter.add(ANY_METHOD, ACTIONS_ROUTE_PATH.CONTROL, actionPassthrough(handlers.control)),
    HttpRouter.add(ANY_METHOD, ACTIONS_ROUTE_PATH.AGENT, actionPassthrough(handlers.agent)),
    HttpRouter.add(
      ANY_METHOD,
      ACTIONS_ROUTE_PATH.RENAME_SESSION,
      actionPassthrough(handlers.renameSession),
    ),
    HttpRouter.add(
      ANY_METHOD,
      ACTIONS_ROUTE_PATH.RENAME_WORKSPACE,
      actionPassthrough(handlers.renameWorkspace),
    ),
    HttpRouter.add(ANY_METHOD, ACTIONS_ROUTE_PATH.WORKSPACE, actionPassthrough(handlers.workspace)),
    hostedNotFoundRoute,
  );
}

/** The deployment's own group, wired to the real endpoints every route file answered with before. */
export function actionsApp(): WebRoutes<ActionsServices> {
  return buildActionsApp({
    message: handleMessageAction,
    control: handleControlAction,
    agent: handleAgentAction,
    renameSession: handleRenameSessionAction,
    renameWorkspace: handleRenameWorkspaceAction,
    workspace: handleWorkspaceAction,
  });
}
