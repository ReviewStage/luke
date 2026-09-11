import { type HttpApp, HttpRouter, HttpServerRequest, HttpServerResponse } from "@effect/platform";
import { Effect } from "effect";
import {
  handleAgentAction,
  handleControlAction,
  handleMessageAction,
  handleRenameSessionAction,
  handleRenameWorkspaceAction,
  handleWorkspaceAction,
} from "./hosted/action-session.js";
import { HOSTED_REFUSAL, hostedRefusalResponse } from "./hosted/http-effect.js";
import { type HostedVaultRoute, hostedVaultRoute } from "./hosted/vault-route.js";

/**
 * The actions surface as one route group: the six endpoints through which the
 * phone and desktop ask the hosted tier to act on an observed cloud session,
 * or create one, on the developer's behalf (root AGENTS.md "Acts on a
 * session"). Each endpoint is already the whole of admission, the roster
 * read, and dispatch, so the group only carries the request across the
 * `HttpApi` boundary and back, the way `server/auth-app.ts` carries Better
 * Auth's; nothing about the admission gauntlet, the roster, or the refusal
 * vocabulary in `server/hosted/action-session.ts` changes here.
 */

const ACTIONS_ROUTE_PATH = {
  MESSAGE: "/api/actions/message",
  CONTROL: "/api/actions/control",
  AGENT: "/api/actions/agent",
  RENAME_SESSION: "/api/actions/rename-session",
  RENAME_WORKSPACE: "/api/actions/rename-workspace",
  WORKSPACE: "/api/actions/workspace",
} as const;

/** One action endpoint's handler, the shape every `handle*Action` export already has. */
export type HostedActionHandler = (route: HostedVaultRoute) => Promise<Response>;

export interface ActionsGroupHandlers {
  message: HostedActionHandler;
  control: HostedActionHandler;
  agent: HostedActionHandler;
  renameSession: HostedActionHandler;
  renameWorkspace: HostedActionHandler;
  workspace: HostedActionHandler;
}

/**
 * Carries the handler's own `Response` back unchanged, the way
 * `server/auth-app.ts`'s passthrough does: the request handed to the handler
 * is the very `Request` this edge was invoked with, and nothing is read out
 * of the answer to mirror onto the `HttpServerResponse` beside it.
 */
function actionPassthrough(handle: HostedActionHandler): HttpApp.Default {
  const route = hostedVaultRoute(handle);
  return Effect.gen(function* () {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
    const answer = yield* Effect.promise(() => route.fetch(request));
    return HttpServerResponse.raw(answer);
  });
}

/**
 * The group, built from the handlers named. A path outside the six answers
 * the hosted vocabulary's own `not-found`, since nothing routes another path
 * to one of these functions.
 */
export function buildActionsApp(handlers: ActionsGroupHandlers): HttpApp.Default {
  return HttpRouter.empty.pipe(
    HttpRouter.all(ACTIONS_ROUTE_PATH.MESSAGE, actionPassthrough(handlers.message)),
    HttpRouter.all(ACTIONS_ROUTE_PATH.CONTROL, actionPassthrough(handlers.control)),
    HttpRouter.all(ACTIONS_ROUTE_PATH.AGENT, actionPassthrough(handlers.agent)),
    HttpRouter.all(ACTIONS_ROUTE_PATH.RENAME_SESSION, actionPassthrough(handlers.renameSession)),
    HttpRouter.all(
      ACTIONS_ROUTE_PATH.RENAME_WORKSPACE,
      actionPassthrough(handlers.renameWorkspace),
    ),
    HttpRouter.all(ACTIONS_ROUTE_PATH.WORKSPACE, actionPassthrough(handlers.workspace)),
    Effect.catchTag("RouteNotFound", () =>
      Effect.succeed(hostedRefusalResponse(HOSTED_REFUSAL.NOT_FOUND)),
    ),
  );
}

/** The deployment's own group, wired to the real endpoints every route file answered with before. */
export function actionsApp(): HttpApp.Default {
  return buildActionsApp({
    message: handleMessageAction,
    control: handleControlAction,
    agent: handleAgentAction,
    renameSession: handleRenameSessionAction,
    renameWorkspace: handleRenameWorkspaceAction,
    workspace: handleWorkspaceAction,
  });
}
