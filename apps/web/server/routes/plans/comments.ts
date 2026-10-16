import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { planCommentsApp } from "@luke/service/tasks/plan-comments-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/** A plan's comment threads, read as they change (GET) or started (POST), by the id its path carries. */
export default routeFromHttpRouter(planCommentsApp({ resolveUserId: resolveHostedUserId }));
