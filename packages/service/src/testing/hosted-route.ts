/**
 * hosted-route.ts -- one request answered by hosted procedures behind `hostedFetch`, as the web route answers it, over a test's own services.
 *
 * A resource's tests hand in a router of that resource alone
 * (`{ account: accountProcedures(seams) }`) and the layer of the services
 * its procedures yield, the test's clock among them; the answer is the
 * `Response` the handler wrote, its bytes as they left it.
 *
 * A refusal a procedure answers that its contract does not declare, which
 * the deployment reports as a defect and answers all the same
 * (`orpc/errors.ts`'s `UndeclaredRefusal`), fails the test instead, so a
 * route test that provokes one names the refusal its contract is missing.
 */

import type { Router } from "@orpc/server";
import { Cause, Context, Effect, ErrorReporter, type Layer } from "effect";
import type { HostedContext } from "../orpc/base.js";
import { UndeclaredRefusal } from "../orpc/errors.js";
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
    const undeclared: UndeclaredRefusal[] = [];
    const recorder = ErrorReporter.make(({ cause }) => {
      const defect = Cause.squash(cause);
      if (defect instanceof UndeclaredRefusal) undeclared.push(defect);
    });
    const reporters = Context.get(webServices, ErrorReporter.CurrentErrorReporters);
    const watched = Context.add(
      webServices,
      ErrorReporter.CurrentErrorReporters,
      new Set([...reporters, recorder]),
    );
    const response = yield* Effect.promise(() => hostedFetch(router)(request, watched));
    const [first] = undeclared;
    if (first !== undefined) return yield* Effect.die(first);
    return response;
  });
}
