import { workspaceSeams } from "@repo/database/models/workspace-seams";
import { auth } from "@repo/service/auth/auth";
import { authApp } from "@repo/service/auth/auth-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * Every auth endpoint, which is Better Auth's own handler behind the group in
 * `@repo/service/auth/auth-app`; this file only hands it the deployment's real service, and the
 * organization plugin's create a sign-up's personal workspace is made through.
 */
export default routeFromHttpRouter(
  authApp((request) => auth.handler(request), workspaceSeams(auth.api)),
);
