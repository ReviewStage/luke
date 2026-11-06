import { automationWebhookApp } from "@repo/service/automations/automation-webhook-app";
import { nativeAgents } from "../../native-agents.js";
import { routeFromHttpRouter } from "../../route-effect.js";

export default routeFromHttpRouter(automationWebhookApp(), nativeAgents);
