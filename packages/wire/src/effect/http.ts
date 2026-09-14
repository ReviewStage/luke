import { Effect, Stream } from "effect";
import type * as HttpClientError from "effect/unstable/http/HttpClientError";
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

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

/**
 * The same `Response`, with its body read to bytes before this effect ends.
 * For a caller that bounds the whole answer with one deadline: a stream would
 * carry the body past that bound, so a server that answered its headers and
 * then stalled would be a request that never ended, while bytes read here
 * either arrive within the deadline or fail it. The body a client could not
 * read is the client's own error, for the caller to name as it names any other
 * transport failure.
 */
export function bufferedWebResponseFromClientResponse(
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<Response, HttpClientError.HttpClientError> {
  const init: ResponseInit = { status: response.status, headers: response.headers };
  if (bodilessStatuses.has(response.status)) return Effect.succeed(new Response(null, init));
  return Effect.map(response.arrayBuffer, (body) => new Response(body, init));
}
