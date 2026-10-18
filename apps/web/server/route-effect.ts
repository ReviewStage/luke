import { cookieOriginGuard } from "@luke/service/http/origin-guard";
import type { Route, WebRoutes } from "@luke/service/route";
import type { WebServices } from "@luke/service/runtime";
import { Effect } from "effect";
import { HttpRouter } from "effect/http";
import { runWeb } from "./runtime.js";

type WebHandler = (request: Request) => Promise<Response>;

/**
 * A web function's default export, built from the route layer a group
 * registers its paths with. The handler is built from the one web runtime and
 * then held for the instance's life, so a warm invocation reaches the same
 * services the cold one built.
 *
 * `runWeb` is where the edge's services are read, which keeps this file a
 * caller of the edge rather than a second one: the router the layer builds
 * carries no services of its own, and the context read here is handed to each
 * request the handler answers. A build that failed is not held, because the
 * failure is the layer's — a missing `DATABASE_URL` today — and a held
 * rejection would answer every later invocation from it without trying again.
 *
 * The router's own request logger is disabled: a function's request line is
 * already the platform's to record, and a URL Luke wrote to its own output is
 * a place a token in a query could land.
 *
 * Every request meets the cookie origin guard first, so a state-changing
 * request a browser's cookie carried from a page this deployment does not
 * serve is refused before any route reads the cookie
 * (`packages/service/src/http/origin-guard.ts`).
 */
export function routeFromHttpRouter(routes: WebRoutes<WebServices>): Route {
  const refuseCrossSite = cookieOriginGuard(process.env);
  let building: Promise<WebHandler> | undefined;
  return {
    async fetch(request: Request): Promise<Response> {
      const refusal = refuseCrossSite(request);
      if (refusal !== undefined) return refusal;
      building ??= runWeb(Effect.context<WebServices>()).then((context) => {
        const { handler } = HttpRouter.toWebHandler(routes, { disableLogger: true });
        return (incoming: Request) => handler(incoming, context);
      });
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
