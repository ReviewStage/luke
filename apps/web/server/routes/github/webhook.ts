import { githubWebhookApp } from "@luke/service/github/github-webhook-app";
import { nativeAgents } from "../../native-agents.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * The Luke GitHub App's webhook, which GitHub delivers pull request and
 * check events to. The logic lives in `packages/service/src/github/github-webhook-app.ts`; this
 * file only hands the group to the route adaptor.
 */
export default routeFromHttpRouter(githubWebhookApp(), nativeAgents);
