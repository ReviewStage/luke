import { defineAgent } from "eve";
import { BRAIN_HOST } from "../../../server/hosted/brain-host/bounds.js";
import { brainModel } from "../../agent.js";
import { host } from "../../host.js";

/**
 * The worker: a subagent the planning model hands slow or separate work to,
 * run by eve as a background task so the planning turn answers without
 * waiting for it. Its findings reach the planning model as a task
 * notification, never the developer directly.
 */
export default defineAgent({
  description:
    "Do one job in the background: research on the public Internet, reading the plan's code folder, or both. Returns at once; a short summary with its sources arrives later.",
  defaultTools: false,
  model: brainModel(host.admitDelegated),
  limits: {
    maxInputTokensPerSession: BRAIN_HOST.WORKER_INPUT_TOKENS,
    maxOutputTokensPerSession: BRAIN_HOST.WORKER_OUTPUT_TOKENS,
  },
});
