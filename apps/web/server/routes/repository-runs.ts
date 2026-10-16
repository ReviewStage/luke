import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { repositoryRunsApp } from "@luke/service/github/repository-runs-app";
import { routeFromHttpRouter } from "../route-effect.js";

/** How a workspace's repositories are set up and run on a Mac: read them (GET), or set one repository's (PUT). */
export default routeFromHttpRouter(repositoryRunsApp({ resolveUserId: resolveHostedUserId }));
