import { githubInstallApp } from "../../../github-install-app.js";
import { routeFromHttpRouter } from "../../../route-effect.js";

/**
 * The callback a workspace's connect returns through after authorizing the
 * App once. The logic lives in `server/github-install-app.ts`; this file
 * only hands the group to the route adaptor.
 */
export default routeFromHttpRouter(githubInstallApp());
