import type * as HttpClientResponse from "@effect/platform/HttpClientResponse";
import { Effect, Stream } from "effect";

/**
 * The statuses whose answer carries no body at all. `Response` refuses a body
 * for one of these, so the bridge below hands it `null` rather than a stream
 * that would yield nothing: a stream is what a reader sees, and the
 * constructor throws before a reader exists.
 */
const BODILESS_STATUS = {
  NO_CONTENT: 204,
  RESET_CONTENT: 205,
  NOT_MODIFIED: 304,
} as const;

const bodilessStatuses: ReadonlySet<number> = new Set(Object.values(BODILESS_STATUS));

/**
 * The web `Response` a client's answer carries, for a caller whose own
 * vocabulary is still `Response`'s. The body travels as the stream the answer
 * streams rather than as bytes read here, so a caller reads it exactly once
 * and after this effect has ended, which is where `fetch`'s own reader stands.
 */
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
