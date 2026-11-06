import type { Router } from "@orpc/server";
import { type Context, Effect, type Layer } from "effect";
import type { HostedContext } from "../orpc/base.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";

export function hostedAnswer<Services>(
  router: Router<HostedContext>,
  services: Layer.Layer<Services>,
  request: Request,
): Effect.Effect<Response> {
  return Effect.gen(function* () {
    const context = yield* Effect.context<Services>().pipe(Effect.provide(services));
    const webServices = context as Context.Context<WebServices>;
    return yield* Effect.promise(() => hostedFetch(router)(request, webServices));
  });
}
