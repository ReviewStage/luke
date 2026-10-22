import { sentryInstallApp } from "@luke/service/triggers/sentry/sentry-install-app";
import { routeFromHttpRouter } from "../../../route-effect.js";

/**
 * The Sentry integration's Redirect URL, which Sentry returns the browser to after an install (GET). The logic lives in
 * `packages/service/src/triggers/sentry/sentry-install-app.ts`; this file only hands the route to the adaptor.
 */
export default routeFromHttpRouter(sentryInstallApp());
