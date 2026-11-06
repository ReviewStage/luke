import { workspacesApp } from "@repo/service/accounts/workspaces-app";
import { resolveHostedUserId } from "@repo/service/auth/bearer";
import { routeFromHttpRouter } from "../../route-effect.js";

export default routeFromHttpRouter(workspacesApp({ resolveUserId: resolveHostedUserId }));
