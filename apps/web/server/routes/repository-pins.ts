import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { repositoryPinsApp } from "@luke/service/github/repository-pins-app";
import { routeFromHttpRouter } from "../route-effect.js";

/** The repositories the account pinned in the sidebar: read them (GET), or pin or unpin one (PUT). */
export default routeFromHttpRouter(repositoryPinsApp({ resolveUserId: resolveHostedUserId }));
