import { agentsApp } from "@luke/service/agents/agents-app";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One attachment of an inbox item, an image block's picture, served as its bytes to the item's account (GET). The logic lives in `packages/service/src/agents/agents-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(agentsApp({ resolveUserId: resolveHostedUserId }));
