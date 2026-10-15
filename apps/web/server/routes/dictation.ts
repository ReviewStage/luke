import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { dictationApp } from "@luke/service/dictation/dictation-app";
import { routeFromHttpRouter } from "../route-effect.js";

/** A clip dictated into a message box, answered with its words (POST); nothing of either is kept. */
export default routeFromHttpRouter(dictationApp({ resolveUserId: resolveHostedUserId }));
