import { agentsApp } from "@repo/service/agents/agents-app";
import { resolveHostedUserId } from "@repo/service/auth/bearer";
import { routeFromHttpRouter } from "../../route-effect.js";

export default routeFromHttpRouter(agentsApp({ resolveUserId: resolveHostedUserId }));
