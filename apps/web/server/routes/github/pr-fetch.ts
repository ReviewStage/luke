import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { prFetchApp } from "@luke/service/github/pr-fetch-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * A pull request's head and a contents-read token for its repository, for
 * the Mac that runs it locally (POST). The logic lives in
 * `packages/service/src/github/pr-fetch-app.ts`; this file only hands the
 * group to the route adaptor.
 */
export default routeFromHttpRouter(prFetchApp({ resolveUserId: resolveHostedUserId }));
