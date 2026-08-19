import { CLOUD_FAILURE, CloudFailure } from "@sidecar/core/effect-errors";
import { Effect, Layer } from "effect";
import { Http } from "../src/services/http";

export function httpLayerFromFetch(fetchLike: typeof fetch): Layer.Layer<Http> {
  return Layer.succeed(Http, {
    request: (url, init) =>
      Effect.tryPromise({
        try: () => fetchLike(url, init),
        catch: () =>
          new CloudFailure({
            failure: CLOUD_FAILURE.TRANSIENT,
            provider: "http",
          }),
      }),
    readJson: (response) =>
      Effect.tryPromise({
        try: () => response.json(),
        catch: () =>
          new CloudFailure({
            failure: CLOUD_FAILURE.TRANSIENT,
            provider: "http",
          }),
      }),
  });
}

export function runWithHttp<A, E>(
  effect: Effect.Effect<A, E, Http>,
  fetchLike: typeof fetch,
): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(httpLayerFromFetch(fetchLike))));
}
