import { githubInstallApp } from "../../github-install-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * Sends the browser to GitHub to install the Luke GitHub App. The logic lives
 * in `server/github-install-app.ts`, over the `GitHubApp` the web runtime
 * builds; this file only hands the group to the route adaptor.
 */
export default routeFromHttpRouter(githubInstallApp());
