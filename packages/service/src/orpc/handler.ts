/**
 * handler.ts -- the hosted router behind oRPC's `OpenAPIHandler`, answering the bytes the old route groups answered.
 *
 * Beside the encoder (`errors.ts`), three answers the handler alone would
 * give differently are made here: a success carries `cache-control:
 * private, no-store`, as `hostedJsonResponse` set it, unless its procedure
 * set a `cache-control` of its own through the context's `resHeaders` (the
 * admin gate's `no-store`, on its refusals too), and a refusal does not;
 * a request the router does not match is the hosted vocabulary's own 405 when
 * the path is a procedure's under another method and its 404 otherwise, as
 * the old groups' method check and `hostedNotFoundRoute` answered them, where the handler
 * would answer it unmatched; and a defect is a bare 500 with no body, as the
 * platform's web handler answered one, where oRPC would describe it.
 *
 * Every answer, a refusal and an unmatched path's among them, is also marked
 * as this origin's alone (`SAME_ORIGIN_ANSWER`), which no old group said.
 *
 * Every body is counted once, as it is read, against the matched
 * procedure's own cap (`bodyCap` in `@luke/features/contract`), or the
 * platform's ceiling for a procedure that names none: a `content-length`
 * past the cap is refused before anything is read, and a body that states
 * none, or understates it, is refused the moment the bytes read pass the
 * cap, before any of it is parsed. Either way the refusal is the hosted
 * vocabulary's `request-too-large`, as the old groups' bounded body read
 * answered it.
 */

import { getBodyCap } from "@luke/features/contract";
import { HTTP_METHOD } from "@luke/wire";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIMatcher } from "@orpc/openapi/standard";
import { ORPCError, type Router } from "@orpc/server";
import { ResponseHeadersHandlerPlugin } from "@orpc/server/plugins";
import type { StandardHandlerInterceptor } from "@orpc/server/standard";
import type { Context } from "effect";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { HOSTED_REFUSAL, type HostedRefusal } from "../http/http-effect.js";
import type { WebServices } from "../runtime.js";
import type { HostedContext } from "./base.js";
import { encodeHostedError, HOSTED_ERROR_STATUS, hostedRefusalWrap } from "./errors.js";

/** A hosted router, whatever its contract: every procedure taking the hosted context. */
type HostedRouter = Router<HostedContext>;

/** One request answered, with the web runtime's services it runs on. */
export type HostedFetch = (
  request: Request,
  services: Context.Context<WebServices>,
) => Promise<Response>;

const CACHE_CONTROL = "cache-control";
const HOSTED_CACHE_CONTROL = "private, no-store";

/**
 * The headers every answer carries: its type is never sniffed for another,
 * and no other site's page may load it as a resource (an `<img>` or a
 * `<script>` naming an `/api/` path), since a browser would send the session
 * cookie of whoever is looking with it (`auth/bearer.ts`'s
 * `resolveHostedUserId`). Every reader is same-origin: the web app's tab and
 * the site's pages `fetch` this origin, and the Mac's host calls from its
 * main process with its bearer.
 */
const SAME_ORIGIN_ANSWER = {
  "x-content-type-options": "nosniff",
  "cross-origin-resource-policy": "same-origin",
} as const;

/**
 * The most any request's body may carry, in bytes: Vercel's own limit on a
 * function's request body (4.5 MB), which no hosted request passes anyway,
 * and above the largest cap any hosted endpoint holds (a task's Start, about
 * 4.2 MB, which carries an agent's Start with its files).
 */
export const HOSTED_BODY_CEILING_BYTES = 4_500_000;

const HTTP_METHOD_HEAD = "HEAD";

/** oRPC's own code for a body past its cap, which the encoder answers as the hosted vocabulary's `request-too-large` (`errors.ts`). */
const ORPC_PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE";

/** The most bytes a request's body may still carry: the ceiling until its procedure is matched, then that procedure's cap. */
interface BodyAllowance {
  cap: number;
}

/** The allowance each counted request is read against, by the request the procedures are handed. */
const BODY_ALLOWANCES = new WeakMap<Request, BodyAllowance>();

/**
 * The request with its body counted as it is read, against an allowance
 * that starts at the ceiling and is narrowed to the matched procedure's cap
 * (`bodyCapInterceptor`) before oRPC reads a byte: past it, the stream fails
 * with the too-large error, which oRPC answers as itself rather than as a
 * malformed body. A request with no body is passed on as it is.
 */
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
  // SAFETY: a streamed request body is sent half-duplex, which the DOM's RequestInit does not name.
  const countedRequest = new Request(request.url, init as RequestInit);
  BODY_ALLOWANCES.set(countedRequest, allowance);
  return countedRequest;
}

/**
 * Holds the matched procedure's body to its own cap, read from its meta
 * once routing has found it and before its input is decoded: a stated
 * length past the cap is refused at once, and the count `counted` keeps
 * refuses the rest.
 */
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

/** The methods a procedure may be declared under, which an unmatched request is checked against for a 405. */
const PROCEDURE_METHODS: readonly string[] = Object.values(HTTP_METHOD);

/** A URL's path as the matcher takes it, which every parsed URL's path is. */
function isHttpPath(pathname: string): pathname is `/${string}` {
  return pathname.startsWith("/");
}

/** A refusal as a route group answers it (`hostedRefusing`): the status, the JSON body, and no body for a HEAD. */
function refusalResponse(request: Request, status: number, refusal: HostedRefusal): Response {
  if (request.method === HTTP_METHOD_HEAD) {
    return new Response(null, { status, headers: { "content-type": "application/json" } });
  }
  return Response.json(refusal, { status });
}

/** The matched answer, its headers settled as the old groups set them. */
function settled(response: Response): Response {
  if (response.status === HOSTED_HTTP_STATUS.INTERNAL_ERROR) {
    return new Response(null, { status: HOSTED_HTTP_STATUS.INTERNAL_ERROR });
  }
  if (response.status < HOSTED_HTTP_STATUS.BAD_REQUEST && !response.headers.has(CACHE_CONTROL)) {
    response.headers.set(CACHE_CONTROL, HOSTED_CACHE_CONTROL);
  }
  return response;
}

/** An answer marked as this origin's alone (`SAME_ORIGIN_ANSWER`). */
function sameOriginOnly(response: Response): Response {
  for (const [name, value] of Object.entries(SAME_ORIGIN_ANSWER)) {
    response.headers.set(name, value);
  }
  return response;
}

/** The handler over the router, and the one fetch every migrated route answers through. */
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
