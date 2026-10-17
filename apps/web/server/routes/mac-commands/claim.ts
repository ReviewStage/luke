import { macCommandsApp } from "@luke/service/agents/mac-commands-app";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One waiting command claimed by its id for the Mac that heard of it over Neon Realtime (POST). The logic lives in `packages/service/src/agents/mac-commands-app.ts`. */
export default routeFromHttpRouter(macCommandsApp({ resolveUserId: resolveHostedUserId }));
