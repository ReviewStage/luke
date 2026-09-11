import { HttpApp } from "@effect/platform";
import { Effect, type Scope } from "effect";
import type { Route } from "./route.js";
import { runWeb, type WebServices } from "./runtime.js";

type WebHandler = (request: Request) => Promise<Response>;

/**
 * A web function's default export, built from the `HttpApp` an `HttpApi`
 * group or a single endpoint composes. The handler is built from the one web
 * runtime and then held for the instance's life, so a warm invocation reaches
 * the same services the cold one built.
 *
 * `runWeb` is where the runtime is read, which keeps this file a caller of
 * the edge rather than a second one: the handler `HttpApp` hands back does
 * its own running on that runtime. A build that failed is not held, because
 * the failure is the layer's — a missing `DATABASE_URL` today — and a held
 * rejection would answer every later invocation from it without trying again.
 */
export function routeFromHttpApp(app: HttpApp.Default<never, WebServices | Scope.Scope>): Route {
  let building: Promise<WebHandler> | undefined;
  return {
    async fetch(request: Request): Promise<Response> {
      building ??= runWeb(Effect.runtime<WebServices>()).then((runtime) =>
        HttpApp.toWebHandlerRuntime(runtime)(app),
      );
      const attempt = building;
      let handler: WebHandler;
      try {
        handler = await attempt;
      } catch (failure) {
        if (building === attempt) building = undefined;
        throw failure;
      }
      return handler(request);
    },
  };
}
