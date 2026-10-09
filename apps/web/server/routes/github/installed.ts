import { githubInstallApp } from "../../github-install-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * The App's Setup URL, which GitHub returns the browser to after an install.
 * The logic lives in `server/github-install-app.ts`; this file only hands the
 * group to the route adaptor.
 */
export default routeFromHttpRouter(githubInstallApp());
