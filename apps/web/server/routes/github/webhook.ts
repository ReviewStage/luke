import { githubWebhookApp } from "@repo/service/github/github-webhook-app";
import { nativeAgents } from "../../native-agents.js";
import { routeFromHttpRouter } from "../../route-effect.js";

export default routeFromHttpRouter(githubWebhookApp(), nativeAgents);
