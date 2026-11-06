import { createMcpHandler, originValidationResponse } from "@modelcontextprotocol/server";
import { HTTP_METHOD } from "@repo/wire";
import { Effect, Layer, Option, Result, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { CREATE_TASK_REFUSAL } from "../agents/task-tools.js";
import { AUTH_BASE_PATH } from "../auth/auth-policy.js";
import { HOSTED_REFUSAL, hostedNotFoundRoute, hostedRefusing } from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { admitMember, type MemberMcpResourceClient } from "./admission.js";
import { MEMBER_MCP_PATH, MEMBER_MCP_SCOPE, memberMcpResourceUrl } from "./resource.js";
import { type MemberMcpRequestServices, memberMcpServer } from "./server.js";
import { MEMBER_MCP_TOOL, RENAMED_MEMBER_MCP_TOOL } from "./tools.js";

export const MEMBER_MCP_METADATA_ROUTE = "/api/mcp/resource-metadata";

const PROTECTED_RESOURCE_WELL_KNOWN = "/.well-known/oauth-protected-resource";

export const MEMBER_MCP_METADATA_PATHS = [
  `${PROTECTED_RESOURCE_WELL_KNOWN}${MEMBER_MCP_PATH}`,
  PROTECTED_RESOURCE_WELL_KNOWN,
] as const;

export const MEMBER_MCP_FUNCTION = {
  MAX_DURATION_SECONDS: 300,
} as const;

export function memberMcpIssuer(baseURL: string): string {
  return `${baseURL}${AUTH_BASE_PATH}`;
}

const NO_ORIGINS: readonly string[] = [];

export interface MemberMcpAuth {
  readonly verify: (request: Request) => Promise<unknown>;
  readonly metadata: () => Promise<object>;
}

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

const toolCallSchema = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Union([Schema.String, Schema.Number]),
  method: Schema.Literal("tools/call"),
  params: Schema.Struct({
    name: Schema.String,
    arguments: Schema.optionalKey(Schema.Struct({ plan: Schema.optionalKey(Schema.Unknown) })),
  }),
});

function renamedWords(params: (typeof toolCallSchema.Type)["params"]): string | undefined {
  const { name } = params;
  const renamed = RENAMED_MEMBER_MCP_TOOL.get(name);
  if (renamed !== undefined) {
    return `\`${name}\` was renamed \`${renamed}\`, and nothing was done: call \`${renamed}\` with the same input.`;
  }
  if (
    name === MEMBER_MCP_TOOL.CREATE_TASK &&
    params.arguments !== undefined &&
    "plan" in params.arguments
  ) {
    return CREATE_TASK_REFUSAL.RENAMED_DESCRIPTION;
  }
  return undefined;
}

const renamedToolAnswer = /* @__PURE__ */ Effect.fn("web/memberMcpRenamedTool")(function* (
  request: Request,
) {
  const body = yield* Effect.promise(() =>
    request
      .clone()
      .json()
      .catch(() => undefined),
  );
  const call = Schema.decodeUnknownOption(toolCallSchema)(body);
  if (Option.isNone(call)) return Option.none<Response>();
  const { id, params } = call.value;
  const text = renamedWords(params);
  if (text === undefined) return Option.none<Response>();
  return Option.some(
    Response.json({
      jsonrpc: "2.0",
      id,
      result: { resultType: "complete", content: [{ type: "text", text }], isError: true },
    }),
  );
});

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
  const renamed = yield* renamedToolAnswer(request);
  if (Option.isSome(renamed)) return HttpServerResponse.raw(renamed.value);
  const services = yield* Effect.context<MemberMcpRequestServices>();
  const handler = createMcpHandler(() => memberMcpServer(services, admitted.success));
  const answer = yield* Effect.promise(() => handler.fetch(request));
  return HttpServerResponse.raw(answer);
});

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

export function memberMcpApp(auth: MemberMcpAuth): WebRoutes<MemberMcpRequestServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, MEMBER_MCP_PATH, mcpEndpoint(auth)),
    HttpRouter.add(ANY_METHOD, MEMBER_MCP_METADATA_ROUTE, hostedRefusing(metadataEndpoint(auth))),
    hostedNotFoundRoute,
  );
}
