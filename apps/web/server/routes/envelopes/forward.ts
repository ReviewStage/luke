import { sentryTunnelApp } from "@repo/service/observability/sentry-tunnel-app";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { routeFromHttpRouter } from "../../route-effect.js";

/** The web tab's Sentry envelopes, which the web service rewrites `SENTRY_TUNNEL.PATH` onto (`function-rewrites.ts`), passed on to the deployment's own Sentry project. The logic lives in `packages/service/src/observability/sentry-tunnel-app.ts`. */
export default routeFromHttpRouter(
  sentryTunnelApp().pipe(HttpRouter.provideRequest(FetchHttpClient.layer)),
);
