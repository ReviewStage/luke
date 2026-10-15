import { macCommandsApp } from "@luke/service/agents/mac-commands-app";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { routeFromHttpRouter } from "../route-effect.js";

/** The shell commands the account's agents queued for its Mac: the waiting ones, held open while none waits (GET), or one's result (POST). */
export default routeFromHttpRouter(macCommandsApp({ resolveUserId: resolveHostedUserId }));
