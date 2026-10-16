import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { planCommentsApp } from "@luke/service/plans/plan-comments-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One thing done to one comment thread of a plan, by the ids its path carries (POST). */
export default routeFromHttpRouter(planCommentsApp({ resolveUserId: resolveHostedUserId }));
