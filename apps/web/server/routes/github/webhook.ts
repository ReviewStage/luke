import { githubWebhookApp } from "../../github-webhook-app.js";
import { deploymentEveOrigin } from "../../hosted/brain-host/eve-origin.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * The Luke GitHub App's webhook, which GitHub delivers pull request, review,
 * and check events to. The logic lives in `server/github-webhook-app.ts`;
 * this file only hands the group the deployment's real seams.
 */
export default routeFromHttpRouter(githubWebhookApp({ eveOrigin: deploymentEveOrigin }));
