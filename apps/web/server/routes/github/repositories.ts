import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { githubRepositoriesApp } from "@luke/service/github/github-repositories-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * The repositories the signed-in account reaches through the Luke GitHub App
 * (GET). The logic lives in `packages/service/src/github/github-repositories-app.ts`; this file
 * only hands the group to the route adaptor.
 */
export default routeFromHttpRouter(githubRepositoriesApp({ resolveUserId: resolveHostedUserId }));
