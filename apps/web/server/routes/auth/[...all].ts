import { auth } from "../../auth.js";
import { authApp } from "../../auth-app.js";
import { routeFromHttpApp } from "../../route-effect.js";

/**
 * Every auth endpoint, which is Better Auth's own handler behind the group in
 * `server/auth-app.ts`; this file only hands it the deployment's real service.
 */
export default routeFromHttpApp(authApp((request) => auth.handler(request)));
