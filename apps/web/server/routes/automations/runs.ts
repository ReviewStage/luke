import { automationRunsHandler } from "@repo/service/automations/automation-run-consumer";
import { nativeAgents } from "../../native-agents.js";
import { routeFromWebServices } from "../../route-effect.js";

/**
 * The automation-runs queue's consumer, a function of its own that the
 * queue alone invokes: its trigger is written into its `.vc-config.json`
 * (`server/build-output.ts`), and it has no rewrite and no public path. The
 * logic lives in `packages/service/src/automations/automation-run-consumer.ts`;
 * this file only hands it the runtime's services, the native harnesses
 * beside them, as the maintenance sweep's are.
 */
export default routeFromWebServices(automationRunsHandler, nativeAgents);
