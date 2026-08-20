import { Effect, type Layer } from "effect";
import { type Http, HttpLive } from "../../src/services/http";

/** Test boundary: loopback handlers run without a composition-root runtime. */
export const testHttpLive: Layer.Layer<Http> = HttpLive((effect) => {
  void Effect.runPromise(effect);
});
