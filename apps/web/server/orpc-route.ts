import { memberSeams, workspaceSeams } from "@repo/database/models/workspace-seams";
import { accountProcedureSeams } from "@repo/service/accounts/account-seams";
import { supportAccessCalls } from "@repo/service/accounts/support-access-calls";
import { hostedAdminSeams } from "@repo/service/admin/admin-route";
import { agentBrowserServices } from "@repo/service/agents/browser/agent-browser";
import type { NativeAgentSessions } from "@repo/service/agents/coder-host/runtime-sessions";
import {
  type SandboxStopReach,
  sessionSandboxesLayer,
} from "@repo/service/agents/session-sandboxes";
import { agentSandboxLayer } from "@repo/service/agents/terminal/agent-sandbox";
import { auth } from "@repo/service/auth/auth";
import { authDeployment } from "@repo/service/auth/auth-deployment";
import { resolveHostedUserId } from "@repo/service/auth/bearer";
import { resolveBrowserSessionUserId } from "@repo/service/auth/browser-session";
import { githubUnlink } from "@repo/service/github/github-unlink";
import { integrationsAppSeams } from "@repo/service/integrations/integration-seams";
import { clientConsentDelete } from "@repo/service/member-mcp/client-consents";
import { memberMcpResourceUrl } from "@repo/service/member-mcp/resource";
import { type HostedFetch, hostedFetch } from "@repo/service/orpc/handler";
import { type HostedRouterSeams, hostedRouter } from "@repo/service/orpc/router";
import type { Route } from "@repo/service/route";
import type { WebServices } from "@repo/service/runtime";
import { waitUntil } from "@vercel/functions";
import { Effect, type Layer } from "effect";
import { nativeAgents } from "./native-agents.js";
import { routeFromWebServices } from "./route-effect.js";

export function routeFromHostedFetch(
  answer: HostedFetch,
  beside?: Layer.Layer<NativeAgentSessions, never, WebServices>,
): Route {
  return routeFromWebServices((services) => (request) => answer(request, services), beside);
}

const keepAwake: SandboxStopReach["keepAwake"] = <R>(work: Effect.Effect<void, never, R>) =>
  Effect.flatMap(Effect.context<R>(), (context) =>
    Effect.sync(() => waitUntil(Effect.runPromiseExitWith(context)(work))),
  );

const DEPLOYMENT_SEAMS: HostedRouterSeams = {
  ...accountProcedureSeams(),
  ...hostedAdminSeams(auth.api),
  ...integrationsAppSeams(),
  resolveUserId: resolveHostedUserId,
  resolveSessionUserId: resolveBrowserSessionUserId,
  unlinkGitHub: githubUnlink(auth.api),
  deleteClientConsent: clientConsentDelete(auth.api),
  supportAccess: supportAccessCalls(auth.api),
  memberMcpServerUrl: memberMcpResourceUrl(authDeployment(process.env).baseURL),
  workspaces: workspaceSeams(auth.api),
  sandbox: agentSandboxLayer,
  agentBrowser: agentBrowserServices,
  sessionSandboxes: sessionSandboxesLayer,
  keepAwake,
  members: memberSeams(auth.api),
};

export const orpcRoute: Route = routeFromHostedFetch(
  hostedFetch(hostedRouter(DEPLOYMENT_SEAMS)),
  nativeAgents,
);
