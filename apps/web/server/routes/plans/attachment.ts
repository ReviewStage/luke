import { resolveHostedUserId } from "@repo/service/auth/bearer";
import { tasksApp } from "@repo/service/tasks/tasks-app";
import { routeFromHttpRouter } from "../../route-effect.js";

export default routeFromHttpRouter(tasksApp({ resolveUserId: resolveHostedUserId }));
