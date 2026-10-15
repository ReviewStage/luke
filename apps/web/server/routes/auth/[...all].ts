import { auth } from "@luke/service/auth/auth";
import { authApp } from "@luke/service/auth/auth-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * Every auth endpoint, which is Better Auth's own handler behind the group in
 * `@luke/service/auth/auth-app`; this file only hands it the deployment's real service.
 */
export default routeFromHttpRouter(authApp((request) => auth.handler(request)));
