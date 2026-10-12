import { resolveHostedUserId } from "../hosted/bearer.js";
import { repositoryPinsApp } from "../repository-pins-app.js";
import { routeFromHttpRouter } from "../route-effect.js";

/** The repositories the account pinned in the sidebar: read them (GET), or pin or unpin one (PUT). */
export default routeFromHttpRouter(repositoryPinsApp({ resolveUserId: resolveHostedUserId }));
