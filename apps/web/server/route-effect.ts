import type { NativeAgentSessions } from "@repo/service/agents/coder-host/runtime-sessions";
import { cookieOriginGuard } from "@repo/service/http/origin-guard";
import { sentryReportedFetch } from "@repo/service/observability/sentry";
import { type Route, traceIdAnnotated, type WebRoutes } from "@repo/service/route";
import type { WebServices } from "@repo/service/runtime";
import { waitUntil } from "@vercel/functions";
import type { Context, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { webServicesWith } from "./runtime.js";

type WebHandler = (request: Request) => Promise<Response>;

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

export function routeFromHttpRouter(
  routes: WebRoutes<WebServices>,
  beside?: Layer.Layer<NativeAgentSessions, never, WebServices>,
): Route {
  return routeFromWebServices((context) => {
    const { handler } = HttpRouter.toWebHandler(routes, {
      disableLogger: true,
      middleware: traceIdAnnotated,
    });
    return (incoming: Request) => handler(incoming, context);
  }, beside);
}
