import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { taskSectionsApp } from "@luke/service/tasks/task-sections-app";
import { routeFromHttpRouter } from "../route-effect.js";

/** The sections the account made in its sidebars and the tasks in them: read them (GET), or write one change (PUT). */
export default routeFromHttpRouter(taskSectionsApp({ resolveUserId: resolveHostedUserId }));
