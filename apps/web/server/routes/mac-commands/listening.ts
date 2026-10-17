import { macCommandsApp } from "@luke/service/agents/mac-commands-app";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { routeFromHttpRouter } from "../../route-effect.js";

/** That a Mac of the account listens for its commands now (POST). The logic lives in `packages/service/src/agents/mac-commands-app.ts`. */
export default routeFromHttpRouter(macCommandsApp({ resolveUserId: resolveHostedUserId }));
