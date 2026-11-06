import { Effect, Stream } from "effect";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";

const BODILESS_STATUS = {
  NO_CONTENT: 204,
  RESET_CONTENT: 205,
  NOT_MODIFIED: 304,
} as const;

const bodilessStatuses: ReadonlySet<number> = new Set(Object.values(BODILESS_STATUS));

export function webResponseFromClientResponse(
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<Response> {
  const init: ResponseInit = { status: response.status, headers: response.headers };
  if (bodilessStatuses.has(response.status)) return Effect.succeed(new Response(null, init));
  return Effect.map(
    Stream.toReadableStreamEffect(response.stream),
    (body) => new Response(body, init),
  );
}
