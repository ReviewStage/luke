import { HttpApiSchema, HttpServerRequest, HttpServerResponse } from "@effect/platform";
import { Effect, Schema, Stream } from "effect";
import type { UnparsedWireValue } from "../core.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "./http.js";

/**
 * The hosted response vocabulary as the schemas an `HttpApi` group declares
 * its answers from, answering the same statuses and the same bytes
 * `server/hosted/http.ts` answers with today. The two stand side by side
 * while the routes convert one group at a time, and the goldens in
 * `fixtures/hosted-refusal/` are what hold them to the same bytes.
 *
 * A refusal is declared as the body itself rather than as a
 * `Schema.TaggedError`: `error` is already the discriminant the desktop's
 * hosted clients read, and the `_tag` a tagged error encodes beside it would
 * be a byte those clients never asked for.
 */

/** The status each refusal is answered with, which is a function of the refusal alone. */
const HOSTED_REFUSAL_STATUS = {
  [HOSTED_API_ERROR.INVALID_TOKEN]: HOSTED_HTTP_STATUS.UNAUTHORIZED,
  [HOSTED_API_ERROR.INVALID_REQUEST]: HOSTED_HTTP_STATUS.BAD_REQUEST,
  [HOSTED_API_ERROR.METHOD_NOT_ALLOWED]: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
  [HOSTED_API_ERROR.NOT_FOUND]: HOSTED_HTTP_STATUS.NOT_FOUND,
  [HOSTED_API_ERROR.PROMPT_TOO_LARGE]: HOSTED_HTTP_STATUS.BAD_REQUEST,
  [HOSTED_API_ERROR.QUOTA_EXHAUSTED]: HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS,
  [HOSTED_API_ERROR.UNKNOWN_TOOL]: HOSTED_HTTP_STATUS.BAD_REQUEST,
  [HOSTED_API_ERROR.REQUEST_TOO_LARGE]: HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE,
  [HOSTED_API_ERROR.UNAVAILABLE]: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
} as const;

type HostedRefusalSlug = keyof typeof HOSTED_REFUSAL_STATUS;

function refusalSchema<Slug extends HostedRefusalSlug>(slug: Slug) {
  return Schema.Struct({ error: Schema.Literal(slug) }).annotations(
    HttpApiSchema.annotations({ status: HOSTED_REFUSAL_STATUS[slug] }),
  );
}

export const InvalidTokenRefusal = refusalSchema(HOSTED_API_ERROR.INVALID_TOKEN);
export const InvalidRequestRefusal = refusalSchema(HOSTED_API_ERROR.INVALID_REQUEST);
export const MethodNotAllowedRefusal = refusalSchema(HOSTED_API_ERROR.METHOD_NOT_ALLOWED);
export const NotFoundRefusal = refusalSchema(HOSTED_API_ERROR.NOT_FOUND);
export const PromptTooLargeRefusal = refusalSchema(HOSTED_API_ERROR.PROMPT_TOO_LARGE);
export const QuotaExhaustedRefusal = refusalSchema(HOSTED_API_ERROR.QUOTA_EXHAUSTED);
export const UnknownToolRefusal = refusalSchema(HOSTED_API_ERROR.UNKNOWN_TOOL);
export const RequestTooLargeRefusal = refusalSchema(HOSTED_API_ERROR.REQUEST_TOO_LARGE);
export const UnavailableRefusal = refusalSchema(HOSTED_API_ERROR.UNAVAILABLE);

export type HostedRefusal = { readonly error: HostedRefusalSlug };

/** The refusal values themselves, since not one of them carries a field. */
export const HOSTED_REFUSAL = {
  INVALID_TOKEN: { error: HOSTED_API_ERROR.INVALID_TOKEN },
  INVALID_REQUEST: { error: HOSTED_API_ERROR.INVALID_REQUEST },
  METHOD_NOT_ALLOWED: { error: HOSTED_API_ERROR.METHOD_NOT_ALLOWED },
  /** A path the group the request reached declares no route for. */
  NOT_FOUND: { error: HOSTED_API_ERROR.NOT_FOUND },
  /** The prepared prompt is longer than the brain contract's own envelope; nothing was sent upstream. */
  PROMPT_TOO_LARGE: { error: HOSTED_API_ERROR.PROMPT_TOO_LARGE },
  QUOTA_EXHAUSTED: { error: HOSTED_API_ERROR.QUOTA_EXHAUSTED },
  /** A tool name the brain contract's catalog does not register; no schema was selected. */
  UNKNOWN_TOOL: { error: HOSTED_API_ERROR.UNKNOWN_TOOL },
  REQUEST_TOO_LARGE: { error: HOSTED_API_ERROR.REQUEST_TOO_LARGE },
  UNAVAILABLE: { error: HOSTED_API_ERROR.UNAVAILABLE },
} as const satisfies Record<string, HostedRefusal>;

/** A refusal as the response an `HttpApp` answers with outside an `HttpApi` group. */
export function hostedRefusalResponse(
  refusal: HostedRefusal,
): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.unsafeJson(refusal, {
    status: HOSTED_REFUSAL_STATUS[refusal.error],
  });
}

/** An answer as the response, the way `jsonResponse` answers one today. */
export function hostedJsonResponse<Body extends object>(
  status: number,
  body: Body,
): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.unsafeJson(body, { status });
}

/**
 * The upstream failed, which is one refusal whatever went wrong with it: the
 * status it answered with, when it answered at all, is the whole of what
 * travels onward, and its own words never do.
 */
export function hostedUpstreamErrorResponse(
  upstreamStatus: number | undefined,
): HttpServerResponse.HttpServerResponse {
  return hostedJsonResponse(
    HOSTED_HTTP_STATUS.BAD_GATEWAY,
    upstreamStatus === undefined
      ? { error: HOSTED_API_ERROR.UPSTREAM_ERROR }
      : { error: HOSTED_API_ERROR.UPSTREAM_ERROR, upstreamStatus },
  );
}

/** Refuses a request whose method is not the one the endpoint documents. */
export function hostedMethod(
  method: string,
): Effect.Effect<void, HostedRefusal, HttpServerRequest.HttpServerRequest> {
  return Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
    request.method === method ? Effect.void : Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED),
  );
}

/**
 * The request's JSON body as the unparsed wire value a schema reads next.
 * The stream is counted as it arrives rather than trusting a Content-Length
 * the sender may omit or misstate, and is left the moment the bound is
 * passed, so an oversized request is never held whole.
 */
export function readJsonBodyEffect(
  maximumBytes: number,
): Effect.Effect<UnparsedWireValue, HostedRefusal, HttpServerRequest.HttpServerRequest> {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const chunks: Uint8Array[] = [];
    const received = yield* request.stream.pipe(
      Stream.runFoldWhile(
        0,
        (bytes) => bytes <= maximumBytes,
        (bytes, chunk) => {
          chunks.push(chunk);
          return bytes + chunk.byteLength;
        },
      ),
      Effect.mapError(() => HOSTED_REFUSAL.INVALID_REQUEST),
    );
    if (received > maximumBytes) return yield* Effect.fail(HOSTED_REFUSAL.REQUEST_TOO_LARGE);
    const joined = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return yield* Effect.try({
      // SAFETY: JSON.parse answers a runtime value; the endpoint's schema is what holds it to a shape.
      try: () =>
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined)) as UnparsedWireValue,
      catch: () => HOSTED_REFUSAL.INVALID_REQUEST,
    });
  });
}
