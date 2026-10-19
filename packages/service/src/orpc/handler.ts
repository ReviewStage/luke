/**
 * handler.ts -- the hosted router behind oRPC's `OpenAPIHandler`, answering the bytes the old route groups answered.
 *
 * Beside the encoder (`errors.ts`), three answers the handler alone would
 * give differently are made here: a success carries `cache-control:
 * private, no-store`, as `hostedJsonResponse` set it, and a refusal does not;
 * a request the router does not match is the hosted vocabulary's own 405 when
 * the path is a procedure's under another method and its 404 otherwise, as
 * `hostedMethod` and `hostedNotFoundRoute` answered them, where the handler
 * would answer it unmatched; and a defect is a bare 500 with no body, as the
 * platform's web handler answered one, where oRPC would describe it.
 */

import { HTTP_METHOD } from "@luke/wire";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIMatcher } from "@orpc/openapi/standard";
import type { Router } from "@orpc/server";
import { RequestLimitHandlerPlugin } from "@orpc/server/plugins";
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

const HOSTED_CACHE_CONTROL = "private, no-store";

/**
 * The most any request's body may carry, in bytes: Vercel's own limit on a
 * function's request body (4.5 MB), which no hosted request passes anyway,
 * and above the largest cap any hosted endpoint holds (a task's Start, about
 * 4.2 MB, which carries an agent's Start with its files).
 */
const HOSTED_BODY_CEILING_BYTES = 4_500_000;

const HTTP_METHOD_HEAD = "HEAD";

/** The methods a procedure may be declared under, which an unmatched request is checked against for a 405. */
const PROCEDURE_METHODS: readonly string[] = Object.values(HTTP_METHOD);

/** A URL's path as the matcher takes it, which every parsed URL's path is. */
function isHttpPath(pathname: string): pathname is `/${string}` {
  return pathname.startsWith("/");
}

/** A refusal as `hostedRefusalResponse` answered it: the status, the JSON body, and no body for a HEAD. */
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
  if (response.status < HOSTED_HTTP_STATUS.BAD_REQUEST) {
    response.headers.set("cache-control", HOSTED_CACHE_CONTROL);
  }
  return response;
}

/** The handler over the router, and the one fetch every migrated route answers through. */
export function hostedFetch(router: HostedRouter): HostedFetch {
  const handler = new OpenAPIHandler<HostedContext>(router, {
    errorStatusMap: HOSTED_ERROR_STATUS,
    customErrorResponseBodyEncoder: encodeHostedError,
    plugins: [new RequestLimitHandlerPlugin({ maxBodySize: HOSTED_BODY_CEILING_BYTES })],
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
  return async (request, services) => {
    const { matched, response } = await handler.handle(request, {
      context: { "effect/context": services, "effect/wrap": hostedRefusalWrap, request },
    });
    if (matched) return settled(response);
    return (await servedUnderAnotherMethod(request))
      ? refusalResponse(
          request,
          HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
          HOSTED_REFUSAL.METHOD_NOT_ALLOWED,
        )
      : refusalResponse(request, HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_REFUSAL.NOT_FOUND);
  };
}
