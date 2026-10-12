import { githubWebhookApp } from "../../github-webhook-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * The Luke GitHub App's webhook, which GitHub delivers pull request and
 * check events to. The logic lives in `server/github-webhook-app.ts`; this
 * file only hands the group to the route adaptor.
 */
export default routeFromHttpRouter(githubWebhookApp());
