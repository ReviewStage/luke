import { githubInstallApp } from "@luke/service/github/github-install-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * Sends the browser to GitHub to install the Luke GitHub App. The logic lives
 * in `packages/service/src/github/github-install-app.ts`, over the `GitHubApp` the web runtime
 * builds; this file only hands the group to the route adaptor.
 */
export default routeFromHttpRouter(githubInstallApp());
