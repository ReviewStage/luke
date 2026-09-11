import * as HttpBody from "@effect/platform/HttpBody";
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientError from "@effect/platform/HttpClientError";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import * as HttpClientResponse from "@effect/platform/HttpClientResponse";
import * as HttpMethod from "@effect/platform/HttpMethod";
import { Cause, Effect, Exit, Layer, Stream } from "effect";
import { type CloudFetch, HTTP_METHOD } from "../json.js";

/**
 * The statuses whose answer carries no body at all. `Response` refuses a body
 * for one of these, so the shim below hands it `null` rather than a stream
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
 * What `fetch` computes for itself and refuses to be told. A caller that set
 * `content-length` by hand would have it rejected by the platform's own fetch,
 * so the header is dropped on the way out, exactly as `FetchHttpClient` drops
 * it.
 */
const CONTENT_LENGTH = "content-length";

function sentHeaders(headers: HttpClientRequest.HttpClientRequest["headers"]): Headers {
  const sent = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === CONTENT_LENGTH) continue;
    sent.set(name, value);
  }
  return sent;
}

/**
 * The `HttpClient` a caller holding a {@link CloudFetch} can offer. Everything
 * the fetch observes is what the request declares — its method, its headers,
 * its body, and the abort signal the runtime's own interruption raises — and
 * everything it answers is handed back whole: a status the client never filters
 * (`filterStatusOk` stays the caller's own choice, as it is for the platform's
 * fetch client) and a body the response streams rather than buffers.
 *
 * A rejected fetch is a `RequestError` with `reason: "Transport"`, which is
 * what the platform's own fetch client raises for the same failure, so a caller
 * retrying on transport can read one shape.
 */
export function httpClientFromCloudFetch(fetch: CloudFetch): HttpClient.HttpClient {
  return HttpClient.make((request, url, signal) => {
    const send = (body: BodyInit | undefined) =>
      Effect.map(
        Effect.tryPromise({
          try: () =>
            fetch(url.toString(), {
              method: request.method,
              headers: sentHeaders(request.headers),
              ...(body === undefined ? undefined : { body }),
              ...(request.body._tag === "Stream" ? { duplex: "half" } : undefined),
              signal,
            }),
          catch: (cause) =>
            new HttpClientError.RequestError({ request, reason: "Transport", cause }),
        }),
        (response) => HttpClientResponse.fromWeb(request, response),
      );

    switch (request.body._tag) {
      case "Raw":
      case "Uint8Array":
        // SAFETY: `HttpBody.Raw` carries whatever a caller handed it, and the
        // platform's fetch client passes it to `fetch` the same way; the shim
        // cannot narrow it further without refusing a body fetch accepts.
        return send(request.body.body as BodyInit);
      case "FormData":
        return send(request.body.formData);
      case "Stream":
        return Effect.flatMap(Stream.toReadableStreamEffect(request.body.stream), send);
      default:
        return send(undefined);
    }
  });
}

/** The `HttpClient` a {@link CloudFetch} offers, as the layer a test hands over. */
export function layerFromCloudFetch(fetch: CloudFetch): Layer.Layer<HttpClient.HttpClient> {
  return Layer.succeed(HttpClient.HttpClient, httpClientFromCloudFetch(fetch));
}

function webResponse(response: HttpClientResponse.HttpClientResponse): Effect.Effect<Response> {
  const init: ResponseInit = { status: response.status, headers: response.headers };
  if (bodilessStatuses.has(response.status)) return Effect.succeed(new Response(null, init));
  return Effect.map(
    Stream.toReadableStreamEffect(response.stream),
    (body) => new Response(body, init),
  );
}

/**
 * A {@link CloudFetch} over an `HttpClient`, so a caller not yet migrated keeps
 * its `fetch`-shaped seam while the client beneath it is an Effect one. This is
 * the strangler shim of the HTTP lane and is deleted with `CloudFetch` itself
 * in P12-04.
 *
 * It runs the effect, because a `CloudFetch` answers a promise and a promise
 * has to be run somewhere; the bridge is that place until every caller takes a
 * client instead. Two differences from a real `fetch` are unavoidable and are
 * stated rather than hidden: the client's error is what the promise rejects
 * with, not the platform's `TypeError`, and only the request is covered by the
 * signal — once the `Response` is handed back, its body is read outside the
 * effect the signal interrupted, so an abort mid-body is the reader's own
 * failure rather than this promise's.
 */
export function cloudFetchFromHttpClient(client: HttpClient.HttpClient): CloudFetch {
  return async (url, init) => {
    const method = init.method ?? HTTP_METHOD.GET;
    if (!HttpMethod.isHttpMethod(method)) {
      throw new Error(`the HttpClient bridge cannot carry the method ${method}`);
    }
    const answer = client.execute(
      HttpClientRequest.make(method)(url, {
        headers: new Headers(init.headers),
        ...(init.body === null || init.body === undefined
          ? undefined
          : { body: HttpBody.raw(init.body) }),
      }),
    );
    const exit = await Effect.runPromiseExit(Effect.flatMap(answer, webResponse), {
      ...(init.signal === null || init.signal === undefined ? undefined : { signal: init.signal }),
    });
    if (Exit.isSuccess(exit)) return exit.value;
    if (Cause.isInterruptedOnly(exit.cause) && init.signal?.aborted === true) {
      throw init.signal.reason;
    }
    throw Cause.squash(exit.cause);
  };
}
