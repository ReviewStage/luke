import { CLOUD_FAILURE, CloudFailure } from "@sidecar/core/effect-errors";
import { Context, Effect, Layer } from "effect";

export class Http extends Context.Tag("Http")<
  Http,
  {
    readonly request: (url: string, init: RequestInit) => Effect.Effect<Response, CloudFailure>;
  }
>() {}

export const HttpLive: Layer.Layer<Http> = Layer.succeed(Http, {
  request: (url, init) =>
    Effect.tryPromise({
      try: () => fetch(url, init),
      catch: () =>
        new CloudFailure({
          failure: CLOUD_FAILURE.TRANSIENT,
          provider: "http",
        }),
    }),
});
