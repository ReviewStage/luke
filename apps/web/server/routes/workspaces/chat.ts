import { chatApp } from "@luke/service/agents/chat-app";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { routeFromHttpRouter } from "../../route-effect.js";

/** A workspace's chat as a person in it reads it past a cursor, held open while nothing moved (GET). The logic lives in `packages/service/src/agents/chat-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(chatApp({ resolveUserId: resolveHostedUserId }));
