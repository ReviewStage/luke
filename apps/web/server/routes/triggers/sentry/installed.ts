import { sentryInstallApp } from "@repo/service/triggers/sentry/sentry-install-app";
import { routeFromHttpRouter } from "../../../route-effect.js";

export default routeFromHttpRouter(sentryInstallApp());
