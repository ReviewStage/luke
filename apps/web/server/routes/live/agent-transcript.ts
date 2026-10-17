import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { liveApp } from "@luke/service/live/live-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One agent's transcript under `?id=`, or a worker's under `&call=`, sealed for following over Neon Realtime (GET). The logic lives in `packages/service/src/live/live-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(liveApp({ resolveUserId: resolveHostedUserId }));
