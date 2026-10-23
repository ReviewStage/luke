import { triggerIngressApp } from "@luke/service/triggers/trigger-ingress-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * Luke's Sentry integration's webhook, which Sentry delivers issue alerts,
 * new issues, and uninstalls to. The logic lives in
 * `packages/service/src/triggers/trigger-ingress-app.ts`; this file only hands the group to
 * the route adaptor.
 */
export default routeFromHttpRouter(triggerIngressApp());
