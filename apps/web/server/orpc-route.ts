/** orpc-route.ts -- the route every path moved onto the hosted oRPC router answers through. */

import { memberSeams, workspaceSeams } from "@luke/database/models/workspace-seams";
import { accountProcedureSeams } from "@luke/service/accounts/account-seams";
import { hostedAdminSeams } from "@luke/service/admin/admin-route";
import { deploymentEveOrigin } from "@luke/service/agents/brain-host/eve-origin";
import { agentBrowserServices } from "@luke/service/agents/browser/agent-browser";
import type { NativeAgentSessions } from "@luke/service/agents/coder-host/runtime-sessions";
import {
  type SandboxStopReach,
  sessionSandboxesLayer,
} from "@luke/service/agents/session-sandboxes";
import { agentSandboxLayer } from "@luke/service/agents/terminal/agent-sandbox";
import { auth } from "@luke/service/auth/auth";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { resolveBrowserSessionUserId } from "@luke/service/auth/browser-session";
import { githubUnlink } from "@luke/service/github/github-unlink";
import {
  integrationsAppSeams,
  workspaceLinearProcedureSeams,
} from "@luke/service/integrations/integration-seams";
import { type HostedFetch, hostedFetch } from "@luke/service/orpc/handler";
import { type HostedRouterSeams, hostedRouter } from "@luke/service/orpc/router";
import type { Route } from "@luke/service/route";
import type { WebServices } from "@luke/service/runtime";
import { waitUntil } from "@vercel/functions";
import { Effect, type Layer } from "effect";
import { nativeAgents } from "./native-agents.js";
import { routeFromWebServices } from "./route-effect.js";

/**
 * The route every hosted path on the oRPC router answers through: the hosted
 * oRPC router behind `OpenAPIHandler` (`packages/service/src/orpc/`), over
 * the deployment's own resolvers. The default function holds it under its
 * own key (`function-bundles.ts`), the fallback rewrite of
 * `function-rewrites.ts` lands every `/api/` path no route file takes on it,
 * and the dispatcher has already restored the public path the router
 * matches (`function-dispatch.ts`).
 *
 * The services each procedure runs on are read from the one web runtime once
 * per instance and handed to every request as its `effect/context`, behind
 * the cookie origin guard and Sentry, as `route-effect.ts`'s
 * `routeFromWebServices` holds them for a route layer.
 */
export function routeFromHostedFetch(
  answer: HostedFetch,
  beside?: Layer.Layer<NativeAgentSessions, never, WebServices>,
): Route {
  return routeFromWebServices((services) => (request) => answer(request, services), beside);
}

/**
 * An archive's stop of the sandbox, handed to Vercel's `waitUntil` once the
 * archive has answered, so the instance is not frozen before the stop has
 * reached Vercel (https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#waituntil).
 * The work runs on the services of the request it was asked in.
 */
const keepAwake: SandboxStopReach["keepAwake"] = <R>(work: Effect.Effect<void, never, R>) =>
  Effect.flatMap(Effect.context<R>(), (context) =>
    Effect.sync(() => waitUntil(Effect.runPromiseExitWith(context)(work))),
  );

/** The deployment's resolvers, and what the resources ask of the deployment beside them. */
const DEPLOYMENT_SEAMS: HostedRouterSeams = {
  ...accountProcedureSeams(),
  ...hostedAdminSeams(auth.api),
  ...integrationsAppSeams(),
  ...workspaceLinearProcedureSeams(),
  resolveUserId: resolveHostedUserId,
  resolveSessionUserId: resolveBrowserSessionUserId,
  unlinkGitHub: githubUnlink(auth.api),
  workspaces: workspaceSeams(auth.api),
  eveOrigin: deploymentEveOrigin,
  sandbox: agentSandboxLayer,
  agentBrowser: agentBrowserServices,
  sessionSandboxes: sessionSandboxesLayer,
  keepAwake,
  members: memberSeams(auth.api),
};

/** The deployment's hosted oRPC route. */
/** The deployment's hosted oRPC route, with the native harnesses its agent procedures reach (`native-agents.ts`). */
export const orpcRoute: Route = routeFromHostedFetch(
  hostedFetch(hostedRouter(DEPLOYMENT_SEAMS)),
  nativeAgents,
);
