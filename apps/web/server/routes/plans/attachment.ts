import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { tasksApp } from "@luke/service/tasks/tasks-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One picture of a plan of the caller's workspaces served as its bytes, by the ids its path carries (GET). */
export default routeFromHttpRouter(tasksApp({ resolveUserId: resolveHostedUserId }));
