import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientError from "@effect/platform/HttpClientError";
import type * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import * as HttpClientResponse from "@effect/platform/HttpClientResponse";
import { Effect, Layer, Stream } from "effect";

/**
 * How a fake answers one request. The vocabulary is the network's own rather
 * than Effect's, because what a test states is a route table over URLs and a
 * `Response` — the client shape around it is this module's business.
 */
export type FakeResponder = (url: string, init: RequestInit) => Response | Promise<Response>;

/**
 * What `fetch` computes for itself and refuses to be told, dropped on the way
 * out exactly as `FetchHttpClient` drops it, so a fake sees the headers a
 * production client would actually have sent.
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
 * The `HttpClient` a test's own route table answers as. Everything the
 * responder observes is what the request declares — its method, its headers,
 * its body, and the abort signal the runtime's own interruption raises — and
 * everything it answers is handed back whole: a status the client never
 * filters (`filterStatusOk` stays the caller's own choice, as it is for the
 * platform's fetch client) and a body the response streams rather than
 * buffers.
 *
 * A responder that rejects or throws reaches the caller as a `RequestError`
 * with `reason: "Transport"`, which is what the platform's own fetch client
 * raises for the same failure, so a test over a retrying caller reads one
 * shape.
 */
export function fakeHttpClient(respond: FakeResponder): HttpClient.HttpClient {
  return HttpClient.make((request, url, signal) => {
    const send = (body: BodyInit | undefined) =>
      Effect.map(
        Effect.tryPromise({
          try: async () =>
            respond(url.toString(), {
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
        // platform's fetch client passes it to `fetch` the same way; the fake
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

/** The same fake as the layer a test hands where production reads the tag. */
export function fakeHttpClientLayer(respond: FakeResponder): Layer.Layer<HttpClient.HttpClient> {
  return Layer.succeed(HttpClient.HttpClient, fakeHttpClient(respond));
}
