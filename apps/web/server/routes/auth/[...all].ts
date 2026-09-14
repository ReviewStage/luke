import { auth } from "../../auth.js";
import { authApp } from "../../auth-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * Every auth endpoint, which is Better Auth's own handler behind the group in
 * `server/auth-app.ts`; this file only hands it the deployment's real service.
 */
export default routeFromHttpRouter(authApp((request) => auth.handler(request)));
