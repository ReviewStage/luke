import { CLOUD_FAILURE, CloudFailure } from "@sidecar/core/effect-errors";
import { Effect, Layer } from "effect";
import { type Files, FilesLive } from "../../src/services/files";
import { buildHttpService, Http } from "../../src/services/http";

export function httpLayerFromFetch(fetchLike: typeof fetch): Layer.Layer<Http> {
  return Layer.succeed(Http, {
    ...buildHttpService((effect) => {
      void Effect.runPromise(effect);
    }),
    request: (url, init) =>
      Effect.tryPromise({
        try: () => fetchLike(url, init),
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

export function runWithFiles<A, E>(effect: Effect.Effect<A, E, Files>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(FilesLive)));
}

export function runWithHttpAndFiles<A, E>(
  effect: Effect.Effect<A, E, Http | Files>,
  fetchLike: typeof fetch,
): Promise<A> {
  return Effect.runPromise(
    effect.pipe(Effect.provide(Layer.mergeAll(httpLayerFromFetch(fetchLike), FilesLive))),
  );
}
