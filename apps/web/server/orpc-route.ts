/** orpc-route.ts -- the route every path moved onto the hosted oRPC router answers through. */

import { memberSeams, workspaceSeams } from "@luke/database/models/workspace-seams";
import { accountProcedureSeams } from "@luke/service/accounts/account-seams";
import { deploymentEveOrigin } from "@luke/service/agents/brain-host/eve-origin";
import { agentSandboxLayer } from "@luke/service/agents/terminal/agent-sandbox";
import { auth } from "@luke/service/auth/auth";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { resolveBrowserSessionUserId } from "@luke/service/auth/browser-session";
import { githubUnlink } from "@luke/service/github/github-unlink";
import { cookieOriginGuard } from "@luke/service/http/origin-guard";
import {
  integrationsAppSeams,
  workspaceLinearProcedureSeams,
} from "@luke/service/integrations/integration-seams";
import { type HostedFetch, hostedFetch } from "@luke/service/orpc/handler";
import { type HostedRouterSeams, hostedRouter } from "@luke/service/orpc/router";
import type { Route } from "@luke/service/route";
import type { WebServices } from "@luke/service/runtime";
import { type Context, Effect } from "effect";
import { runWeb } from "./runtime.js";

/**
 * The route every migrated hosted path answers through: the hosted oRPC
 * router behind `OpenAPIHandler` (`packages/service/src/orpc/`), over the
 * deployment's own resolvers. A migrated route file exports `orpcRoute`
 * itself; the dispatcher has already restored the public path the router
 * matches (`function-dispatch.ts`, and `function-rewrites.ts`'s oRPC rows for
 * a path with segments).
 *
 * The services each procedure runs on are read from the one web runtime
 * through `runWeb`, once per instance, and handed to every request as its
 * `effect/context`, as `route-effect.ts` hands them to a route layer; a read
 * that failed is not held, so the next invocation tries again. Every request
 * meets the cookie origin guard first (`packages/service/src/http/origin-guard.ts`).
 */
export function routeFromHostedFetch(answer: HostedFetch): Route {
  const refuseCrossSite = cookieOriginGuard(process.env);
  let reading: Promise<Context.Context<WebServices>> | undefined;
  return {
    async fetch(request: Request): Promise<Response> {
      const refusal = refuseCrossSite(request);
      if (refusal !== undefined) return refusal;
      reading ??= runWeb(Effect.context<WebServices>());
      const attempt = reading;
      let services: Context.Context<WebServices>;
      try {
        services = await attempt;
      } catch (failure) {
        if (reading === attempt) reading = undefined;
        throw failure;
      }
      return answer(request, services);
    },
  };
}

/** The deployment's resolvers, and what the resources ask of the deployment beside them. */
const DEPLOYMENT_SEAMS: HostedRouterSeams = {
  ...accountProcedureSeams(),
  ...integrationsAppSeams(),
  ...workspaceLinearProcedureSeams(),
  resolveUserId: resolveHostedUserId,
  resolveSessionUserId: resolveBrowserSessionUserId,
  unlinkGitHub: githubUnlink(auth.api),
  workspaces: workspaceSeams(auth.api),
  eveOrigin: deploymentEveOrigin,
  sandbox: agentSandboxLayer,
  members: memberSeams(auth.api),
};

/** The deployment's hosted oRPC route. */
export const orpcRoute: Route = routeFromHostedFetch(hostedFetch(hostedRouter(DEPLOYMENT_SEAMS)));
