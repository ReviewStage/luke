import { dictationApp } from "../dictation-app.js";
import { resolveHostedUserId } from "../hosted/bearer.js";
import { routeFromHttpRouter } from "../route-effect.js";

/** A clip dictated into a message box, answered with its words (POST); nothing of either is kept. */
export default routeFromHttpRouter(dictationApp({ resolveUserId: resolveHostedUserId }));
