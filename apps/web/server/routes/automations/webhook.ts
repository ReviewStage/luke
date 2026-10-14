import { automationWebhookApp } from "../../automation-webhook-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** An automation's webhook address (POST), admitted by the trigger's own secret rather than an account bearer. The logic lives in `server/automation-webhook-app.ts`. */
export default routeFromHttpRouter(automationWebhookApp());
