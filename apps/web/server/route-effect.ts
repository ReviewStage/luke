import type { NativeAgentSessions } from "@luke/service/agents/coder-host/runtime-sessions";
import { cookieOriginGuard } from "@luke/service/http/origin-guard";
import { sentryReportedFetch } from "@luke/service/observability/sentry";
import type { Route, WebRoutes } from "@luke/service/route";
import type { WebServices } from "@luke/service/runtime";
import { waitUntil } from "@vercel/functions";
import type { Context, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { webServicesWith } from "./runtime.js";

type WebHandler = (request: Request) => Promise<Response>;

/**
 * A function's route over the one web runtime: the handler `handlerFor`
 * builds from the runtime's services, built once and then held for the
 * instance's life, so a warm invocation reaches the same services the cold
 * one built.
 *
 * `runWeb` is where the edge's services are read, which keeps this file a
 * caller of the edge rather than a second one. A build that failed is not
 * held, because the failure is the layer's — a missing `DATABASE_URL` today —
 * and a held rejection would answer every later invocation from it without
 * trying again.
 *
 * Every request meets the cookie origin guard first, so a state-changing
 * request a browser's cookie carried from a page this deployment does not
 * serve is refused before any route reads the cookie
 * (`packages/service/src/http/origin-guard.ts`).
 *
 * Sentry watches the whole of it (`sentryReportedFetch`): a build that failed
 * is captured as it is thrown to the platform, and what a request queued is
 * sent under Vercel's `waitUntil` after the answer has left.
 */
export function routeFromWebServices(
  handlerFor: (services: Context.Context<WebServices>) => WebHandler,
  beside?: Layer.Layer<NativeAgentSessions, never, WebServices>,
): Route {
  const refuseCrossSite = cookieOriginGuard(process.env);
  let building: Promise<WebHandler> | undefined;
  return {
    fetch: sentryReportedFetch(async (request) => {
      const refusal = refuseCrossSite(request);
      if (refusal !== undefined) return refusal;
      building ??= webServicesWith(beside).then(handlerFor);
      const attempt = building;
      let handler: WebHandler;
      try {
        handler = await attempt;
      } catch (failure) {
        if (building === attempt) building = undefined;
        throw failure;
      }
      return handler(request);
    }, waitUntil),
  };
}

/**
 * A web function's default export, built from the route layer a group
 * registers its paths with. The router the layer builds carries no services
 * of its own: the context `routeFromWebServices` reads is handed to each
 * request the handler answers.
 *
 * The router's own request logger is disabled: a function's request line is
 * already the platform's to record, and a URL Luke wrote to its own output is
 * a place a token in a query could land.
 */
export function routeFromHttpRouter(
  routes: WebRoutes<WebServices>,
  beside?: Layer.Layer<NativeAgentSessions, never, WebServices>,
): Route {
  return routeFromWebServices((context) => {
    const { handler } = HttpRouter.toWebHandler(routes, { disableLogger: true });
    return (incoming: Request) => handler(incoming, context);
  }, beside);
}
