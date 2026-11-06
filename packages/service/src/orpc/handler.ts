import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIMatcher } from "@orpc/openapi/standard";
import { ORPCError, type Router } from "@orpc/server";
import { ResponseHeadersHandlerPlugin } from "@orpc/server/plugins";
import type { StandardHandlerInterceptor } from "@orpc/server/standard";
import { getBodyCap, RETIRED_TASK_PATHS } from "@repo/features/contract";
import { HTTP_METHOD } from "@repo/wire";
import type { Context } from "effect";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { HOSTED_REFUSAL, type HostedRefusal } from "../http/http-effect.js";
import type { WebServices } from "../runtime.js";
import type { HostedContext } from "./base.js";
import { encodeHostedError, HOSTED_ERROR_STATUS, hostedRefusalWrap } from "./errors.js";

type HostedRouter = Router<HostedContext>;

export type HostedFetch = (
  request: Request,
  services: Context.Context<WebServices>,
) => Promise<Response>;

const CACHE_CONTROL = "cache-control";
const HOSTED_CACHE_CONTROL = "private, no-store";

const SAME_ORIGIN_ANSWER = {
  "x-content-type-options": "nosniff",
  "cross-origin-resource-policy": "same-origin",
} as const;

export const HOSTED_BODY_CEILING_BYTES = 4_500_000;

const HTTP_METHOD_HEAD = "HEAD";

const ORPC_PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE";

interface BodyAllowance {
  cap: number;
}

const BODY_ALLOWANCES = new WeakMap<Request, BodyAllowance>();

function counted(request: Request): Request {
  if (request.body === null) return request;
  const allowance: BodyAllowance = { cap: HOSTED_BODY_CEILING_BYTES };
  let read = 0;
  const body = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        read += chunk.byteLength;
        if (read > allowance.cap) {
          controller.error(new ORPCError(ORPC_PAYLOAD_TOO_LARGE));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  const init = {
    method: request.method,
    headers: request.headers,
    body,
    signal: request.signal,
    duplex: "half",
  };
  const countedRequest = new Request(request.url, init as RequestInit);
  BODY_ALLOWANCES.set(countedRequest, allowance);
  return countedRequest;
}

const bodyCapInterceptor: StandardHandlerInterceptor<HostedContext> = ({
  next,
  procedure,
  context,
}) => {
  const cap = Math.min(
    getBodyCap(procedure) ?? HOSTED_BODY_CEILING_BYTES,
    HOSTED_BODY_CEILING_BYTES,
  );
  const stated = Number(context.request.headers.get("content-length") ?? 0);
  if (stated > cap) throw new ORPCError(ORPC_PAYLOAD_TOO_LARGE);
  const allowance = BODY_ALLOWANCES.get(context.request);
  if (allowance !== undefined) allowance.cap = cap;
  return next();
};

const PROCEDURE_METHODS: readonly string[] = Object.values(HTTP_METHOD);

function isHttpPath(pathname: string): pathname is `/${string}` {
  return pathname.startsWith("/");
}

function refusalResponse(request: Request, status: number, refusal: HostedRefusal): Response {
  if (request.method === HTTP_METHOD_HEAD) {
    return new Response(null, { status, headers: { "content-type": "application/json" } });
  }
  return Response.json(refusal, { status });
}

function settled(response: Response): Response {
  if (response.status === HOSTED_HTTP_STATUS.INTERNAL_ERROR) {
    return new Response(null, { status: HOSTED_HTTP_STATUS.INTERNAL_ERROR });
  }
  if (response.status < HOSTED_HTTP_STATUS.BAD_REQUEST && !response.headers.has(CACHE_CONTROL)) {
    response.headers.set(CACHE_CONTROL, HOSTED_CACHE_CONTROL);
  }
  return response;
}

function sameOriginOnly(response: Response): Response {
  for (const [name, value] of Object.entries(SAME_ORIGIN_ANSWER)) {
    response.headers.set(name, value);
  }
  return response;
}

export function hostedFetch(router: HostedRouter): HostedFetch {
  const handler = new OpenAPIHandler<HostedContext>(router, {
    errorStatusMap: HOSTED_ERROR_STATUS,
    customErrorResponseBodyEncoder: encodeHostedError,
    interceptors: [bodyCapInterceptor],
    plugins: [new ResponseHeadersHandlerPlugin()],
  });
  const matcher = new OpenAPIMatcher(router);
  const servedUnderAnotherMethod = async (request: Request): Promise<boolean> => {
    const { pathname } = new URL(request.url);
    if (!isHttpPath(pathname)) return false;
    for (const method of PROCEDURE_METHODS) {
      if (method === request.method) continue;
      if ((await matcher.match(method, pathname, undefined)) !== undefined) return true;
    }
    return false;
  };
  return async (incoming, services) => {
    const request = counted(incoming);
    const { matched, response } = await handler.handle(request, {
      context: { "effect/context": services, "effect/wrap": hostedRefusalWrap, request },
    });
    if (matched) return sameOriginOnly(settled(response));
    const { pathname } = new URL(request.url);
    if (RETIRED_TASK_PATHS.some((retired) => retired.test(pathname))) {
      return sameOriginOnly(
        refusalResponse(
          request,
          HOSTED_HTTP_STATUS.UPGRADE_REQUIRED,
          HOSTED_REFUSAL.HOST_UPGRADE_NEEDED,
        ),
      );
    }
    return sameOriginOnly(
      (await servedUnderAnotherMethod(request))
        ? refusalResponse(
            request,
            HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
            HOSTED_REFUSAL.METHOD_NOT_ALLOWED,
          )
        : refusalResponse(request, HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_REFUSAL.NOT_FOUND),
    );
  };
}
