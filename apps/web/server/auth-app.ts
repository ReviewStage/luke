import {
  type HttpApp,
  type HttpMethod,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform";
import { Effect } from "effect";
import { HOSTED_REFUSAL, hostedRefusalResponse } from "./hosted/http-effect.js";

/**
 * The auth surface as the one route group this function serves: Better Auth's
 * own `fetch` handler, mounted on the path set `vercel.json` routes here.
 *
 * Better Auth owns every answer under that path — the endpoints, the
 * redirects, the cookies, and its own refusals — so the group holds it as a
 * passthrough rather than describing its endpoints: an `HttpApi` that
 * declared them would be a second copy of a contract Better Auth already
 * versions, and the first one to drift would be the one Luke ships.
 */

/** The path set `vercel.json`'s `/api/auth/(.*)` entry sends to this function. */
const AUTH_PATH_SET = "/api/auth/*";

/**
 * The method the web handler answers with no body, taking the status and the
 * headers from the `HttpServerResponse` rather than from the answer beneath it.
 */
const BODYLESS_METHOD = { HEAD: "HEAD" } as const satisfies Record<string, HttpMethod.HttpMethod>;

const RESPONSE_HEADER = { SET_COOKIE: "set-cookie" } as const;

/** A handler shaped the way the platform's own `fetch` is, which is what Better Auth exposes. */
export type WebRequestHandler = (request: Request) => Promise<Response>;

/**
 * A HEAD answer's status and headers, carried on the `HttpServerResponse`
 * because `HttpApp`'s web handler builds a HEAD response from those alone.
 *
 * `set-cookie` is left behind: the platform's own header record holds one
 * value per name, so two cookies would be joined into a byte no client asked
 * for, and a HEAD is not how Better Auth sets one.
 */
function bodylessAnswer(answer: Response): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.empty({
    status: answer.status,
    statusText: answer.statusText,
    headers: [...answer.headers].filter(([name]) => name !== RESPONSE_HEADER.SET_COOKIE),
  });
}

/**
 * The handler's own `Response`, answered unchanged.
 *
 * The request handed over is the very `Request` this edge was invoked with,
 * because the platform keeps the web request it was built from, and the
 * response travels back as a raw body, which the web handler answers with the
 * same object — status, headers, every `set-cookie`, and bytes as they came.
 *
 * Nothing is mirrored onto the `HttpServerResponse` beside it: the platform
 * writes an accompanying header record onto the answer's own `Headers`, and a
 * redirect's are immutable, so mirroring would refuse the very answers the
 * OAuth callbacks are made of. A HEAD is the exception the helper above
 * covers, since there the record is all the web handler reads.
 */
function authPassthrough(handle: WebRequestHandler): HttpApp.Default {
  return Effect.gen(function* () {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
    const answer = yield* Effect.promise(() => handle(request));
    return incoming.method === BODYLESS_METHOD.HEAD
      ? bodylessAnswer(answer)
      : HttpServerResponse.raw(answer);
  });
}

/**
 * The group, which is the passthrough on the auth path set and the hosted
 * vocabulary's own refusal anywhere else. Nothing routes another path to this
 * function, so the refusal says what the group declares rather than what a
 * caller can reach.
 */
export function authApp(handle: WebRequestHandler): HttpApp.Default {
  return HttpRouter.empty.pipe(
    HttpRouter.all(AUTH_PATH_SET, authPassthrough(handle)),
    Effect.catchTag("RouteNotFound", () =>
      Effect.succeed(hostedRefusalResponse(HOSTED_REFUSAL.NOT_FOUND)),
    ),
  );
}
