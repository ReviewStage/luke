import { sentryTunnelApp } from "@repo/service/observability/sentry-tunnel-app";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { routeFromHttpRouter } from "../../route-effect.js";

export default routeFromHttpRouter(
  sentryTunnelApp().pipe(HttpRouter.provideRequest(FetchHttpClient.layer)),
);
