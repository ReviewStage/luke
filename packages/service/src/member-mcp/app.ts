/**
 * app.ts -- the member MCP server's route group: the server at `/api/mcp`, admitted on an access token minted for it, and its protected resource metadata.
 *
 * An outside MCP client (an agent harness acting for a member) reaches the
 * service here, as a native agent's runner reaches our own tools at
 * `/api/agents/mcp` (`../agents/workspace-mcp/app.ts`) on its bearer. Every
 * request is admitted first (`admission.ts`), and only then handed to the
 * SDK's handler (`createMcpHandler`), which serves 2026-07-28 and the
 * 2025-era revisions on the one endpoint, each request answered by a
 * server instance of its own with no session kept, as a function needs:
 * a GET or a DELETE, the 2025 session operations, answers 405. No browser
 * origin is admitted: a request carrying an `Origin` is refused before its
 * token is read, since a page has no business here.
 *
 * The metadata (RFC 9728) is the resource client's own document, served at
 * `/.well-known/oauth-protected-resource/api/mcp`, the path a client derives
 * from the resource's address, and at the well-known path's root form, both
 * rewritten onto `MEMBER_MCP_METADATA_ROUTE` by `function-rewrites.ts`. It
 * names the resource, the auth service as its one authorization server, the
 * scopes it takes, and that a token travels in the header.
 */

import { createMcpHandler, originValidationResponse } from "@modelcontextprotocol/server";
import { HTTP_METHOD } from "@repo/wire";
import { Effect, Layer, Result } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { AUTH_BASE_PATH } from "../auth/auth-policy.js";
import { HOSTED_REFUSAL, hostedNotFoundRoute, hostedRefusing } from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { admitMember, type MemberMcpResourceClient } from "./admission.js";
import { MEMBER_MCP_PATH, MEMBER_MCP_SCOPE, memberMcpResourceUrl } from "./resource.js";
import { type MemberMcpRequestServices, memberMcpServer } from "./server.js";

/** The route the metadata's public paths are rewritten onto, and answered at. */
export const MEMBER_MCP_METADATA_ROUTE = "/api/mcp/resource-metadata";

/** The well-known path a protected resource's metadata stands under (RFC 9728). */
const PROTECTED_RESOURCE_WELL_KNOWN = "/.well-known/oauth-protected-resource";

/** The public paths the metadata answers at: the one derived from the resource's path, and the well-known root. */
export const MEMBER_MCP_METADATA_PATHS = [
  `${PROTECTED_RESOURCE_WELL_KNOWN}${MEMBER_MCP_PATH}`,
  PROTECTED_RESOURCE_WELL_KNOWN,
] as const;

/** The function the server is deployed as. */
export const MEMBER_MCP_FUNCTION = {
  /** The duration its bundle declares: a call answers once its one tool has, and a tool of a later child may wait on an agent's start, two minutes, with room for the store around it. */
  MAX_DURATION_SECONDS: 300,
} as const;

/** The authorization server a token for the resource names as its issuer, and the metadata names: the auth service, at its base path. */
export function memberMcpIssuer(baseURL: string): string {
  return `${baseURL}${AUTH_BASE_PATH}`;
}

/** The origins a request may carry: none, since no page reaches the server. */
const NO_ORIGINS: readonly string[] = [];

/** How a token for the resource is verified and what its metadata says, over the resource client on the auth service. */
export interface MemberMcpAuth {
  readonly verify: (request: Request) => Promise<unknown>;
  readonly metadata: () => Promise<object>;
}

/**
 * The resource client's actions bound to this deployment's resource: a
 * token must name the resource as its audience and the auth service as its
 * issuer and carry `vespin:mcp`; the metadata names the same, with the
 * scopes a token may carry and the header a token travels in. Every address
 * is the base URL's.
 */
export function memberMcpAuth(client: MemberMcpResourceClient, baseURL: string): MemberMcpAuth {
  const resource = memberMcpResourceUrl(baseURL);
  const issuer = memberMcpIssuer(baseURL);
  return {
    verify: (request) =>
      client.verifyAccessTokenRequest(request, {
        verifyOptions: { audience: resource, issuer },
        requiredScopes: [MEMBER_MCP_SCOPE.MCP],
      }),
    metadata: () =>
      client.getProtectedResourceMetadata({
        resource,
        authorization_servers: [issuer],
        scopes_supported: Object.values(MEMBER_MCP_SCOPE),
        bearer_methods_supported: ["header"],
      }),
  };
}

/** The server: the request admitted on its token, then answered by the SDK's handler over a server of its own as the admitted member. */
const mcpEndpoint = /* @__PURE__ */ Effect.fn("web/memberMcpEndpoint")(function* (
  auth: MemberMcpAuth,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest | MemberMcpRequestServices
> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const crossOrigin = originValidationResponse(request, [...NO_ORIGINS]);
  if (crossOrigin !== undefined) return HttpServerResponse.raw(crossOrigin);
  const admitted = yield* admitMember(auth.verify, request);
  if (Result.isFailure(admitted)) return HttpServerResponse.raw(admitted.failure);
  // Note that the handler is built per request, because the tools run on
  // the services this request's fiber holds, which the SDK's factory is
  // handed nothing of; a handler holds nothing between requests besides.
  const services = yield* Effect.context<MemberMcpRequestServices>();
  const handler = createMcpHandler(() => memberMcpServer(services, admitted.success));
  const answer = yield* Effect.promise(() => handler.fetch(request));
  return HttpServerResponse.raw(answer);
});

/** GET: the metadata document, answered to anyone, since it says where to sign in. */
const metadataEndpoint = /* @__PURE__ */ Effect.fn("web/memberMcpMetadataEndpoint")(function* (
  auth: MemberMcpAuth,
) {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const metadata = yield* Effect.orDie(Effect.tryPromise(auth.metadata));
  return HttpServerResponse.jsonUnsafe(metadata);
});

/** The group: the server and its metadata over the auth service's resource client, and the hosted vocabulary's own refusal for any other path. */
export function memberMcpApp(auth: MemberMcpAuth): WebRoutes<MemberMcpRequestServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, MEMBER_MCP_PATH, mcpEndpoint(auth)),
    HttpRouter.add(ANY_METHOD, MEMBER_MCP_METADATA_ROUTE, hostedRefusing(metadataEndpoint(auth))),
    hostedNotFoundRoute,
  );
}
