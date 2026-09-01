import { Effect, Schema } from "effect";
import type { HostedErrorFields } from "./http.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";

export function readBoundedBody(
  request: Request,
  maximumBytes: number,
): Effect.Effect<string | undefined> {
  return Effect.promise(() => request.text().catch(() => undefined)).pipe(
    Effect.map((raw) => {
      if (raw === undefined) return undefined;
      if (new TextEncoder().encode(raw).byteLength > maximumBytes) return undefined;
      return raw;
    }),
  );
}

export function readJsonBody(request: Request): Effect.Effect<unknown | undefined> {
  return Effect.promise(() => request.json().catch(() => undefined));
}

export function decodeBoundedJsonBody<A, I>(
  request: Request,
  maximumBytes: number,
  schema: Schema.Schema<A, I>,
): Effect.Effect<A | undefined> {
  return readBoundedBody(request, maximumBytes).pipe(
    Effect.flatMap((raw) => {
      if (raw === undefined) return Effect.succeed(undefined);
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        return Effect.succeed(undefined);
      }
      const decoded = Schema.decodeUnknownEither(schema)(payload);
      return Effect.succeed(decoded._tag === "Right" ? decoded.right : undefined);
    }),
  );
}

export function decodeJsonBody<A, I>(schema: Schema.Schema<A, I>, payload: unknown): A | undefined {
  const decoded = Schema.decodeUnknownEither(schema)(payload);
  return decoded._tag === "Right" ? decoded.right : undefined;
}

export function jsonResponseEffect<A extends object>(
  status: number,
  body: A,
): Effect.Effect<Response> {
  return Effect.sync(() => jsonResponse(status, body));
}

export function invalidRequest(): Response {
  return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
}

export function unauthorized(): Response {
  return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
}

export function unavailable(): Response {
  return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
}

export function methodNotAllowed(): Response {
  return errorResponse(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED);
}

export function quotaExhausted(quota?: HostedErrorFields["quota"]): Response {
  return errorResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, HOSTED_API_ERROR.QUOTA_EXHAUSTED, {
    quota,
  });
}

export function upstreamError(upstreamStatus?: number): Response {
  return errorResponse(HOSTED_HTTP_STATUS.BAD_GATEWAY, HOSTED_API_ERROR.UPSTREAM_ERROR, {
    upstreamStatus,
  });
}

export { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse };
