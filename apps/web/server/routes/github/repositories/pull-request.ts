import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { githubRepositoriesApp } from "@luke/service/github/github-repositories-app";
import { routeFromHttpRouter } from "../../../route-effect.js";

/**
 * One pull request of a repository a workspace's installation reaches, by
 * the workspace, the repository, and its number, as much of it as a link to
 * it draws (GET). The logic lives in `packages/service/src/github/github-repositories-app.ts`;
 * this file only hands the group to the route adaptor.
 */
export default routeFromHttpRouter(githubRepositoriesApp({ resolveUserId: resolveHostedUserId }));
