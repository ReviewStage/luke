import { Effect, Layer, Stream } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

export type FakeResponder = (url: string, init: RequestInit) => Response | Promise<Response>;

const CONTENT_LENGTH = "content-length";

function sentHeaders(headers: HttpClientRequest.HttpClientRequest["headers"]): Headers {
  const sent = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === CONTENT_LENGTH) continue;
    sent.set(name, value);
  }
  return sent;
}

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
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({ request, cause }),
            }),
        }),
        (response) => HttpClientResponse.fromWeb(request, response),
      );

    switch (request.body._tag) {
      case "Raw":
      case "Uint8Array":
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

export function fakeHttpClientLayer(respond: FakeResponder): Layer.Layer<HttpClient.HttpClient> {
  return Layer.succeed(HttpClient.HttpClient, fakeHttpClient(respond));
}

export const noNetwork: Layer.Layer<HttpClient.HttpClient> = fakeHttpClientLayer(() => {
  throw new Error("this test reaches no network");
});
