import { automationWebhookApp } from "@luke/service/automations/automation-webhook-app";
import { nativeAgents } from "../../native-agents.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** An automation's webhook address (POST), admitted by the trigger's own secret rather than an account bearer. The logic lives in `packages/service/src/automations/automation-webhook-app.ts`. */
export default routeFromHttpRouter(automationWebhookApp(), nativeAgents);
