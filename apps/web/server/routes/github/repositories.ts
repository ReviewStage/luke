import { githubRepositoriesApp } from "../../github-repositories-app.js";
import { resolveHostedUserId } from "../../hosted/bearer.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * The repositories the signed-in account reaches through the Luke GitHub App
 * (GET). The logic lives in `server/github-repositories-app.ts`; this file
 * only hands the group to the route adaptor.
 */
export default routeFromHttpRouter(githubRepositoriesApp({ resolveUserId: resolveHostedUserId }));
