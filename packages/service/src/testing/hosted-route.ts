/**
 * hosted-route.ts -- one request answered by hosted procedures behind `hostedFetch`, as the web route answers it, over a test's own services.
 *
 * A resource's tests hand in a router of that resource alone
 * (`{ account: accountProcedures(seams) }`) and the layer of the services
 * its procedures yield, the test's clock among them; the answer is the
 * `Response` the handler wrote, its bytes as they left it.
 */

import type { Router } from "@orpc/server";
import { type Context, Effect, type Layer } from "effect";
import type { HostedContext } from "../orpc/base.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";

/** The request answered by the router over the services the layer builds. */
export function hostedAnswer<Services>(
  router: Router<HostedContext>,
  services: Layer.Layer<Services>,
  request: Request,
): Effect.Effect<Response> {
  return Effect.gen(function* () {
    const context = yield* Effect.context<Services>().pipe(Effect.provide(services));
    // SAFETY: a test provides only the services its procedures yield, which is all they read of the web runtime's.
    const webServices = context as Context.Context<WebServices>;
    return yield* Effect.promise(() => hostedFetch(router)(request, webServices));
  });
}
